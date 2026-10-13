"""PaddleSlim 路线（Paddle 自带的离线量化 PTQ，PaddleSlim 的 quant_post_static 就是调用它）：
PP-OCRv5_mobile_rec FP32(.pdmodel) -> INT8，并在电脑上和 ONNX 版逐行、逐张对比准确率。

用法（run_paddle.ps1 会自动调用）：
  python paddle_ptq.py quant  <fp32目录> <输出根目录>
  python paddle_ptq.py eval   <输出根目录>
"""
import difflib
import json
import math
import os
import sys
import time
import traceback

os.environ.setdefault('FLAGS_enable_pir_api', '0')  # PTQ 和 Paddle Lite 都只认旧格式 .pdmodel

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OCRTEST = os.path.dirname(HERE)
MODELS = os.path.join(OCRTEST, '..', 'app', 'src', 'ocr', 'assets', 'models')
keys = open(os.path.join(MODELS, 'v5_keys.txt'), encoding='utf-8').read().split('\n')
while keys and keys[-1] == '':
    keys.pop()
CHARS = [''] + keys + [' ']


def prep(crop, min_w=160, fixed_w=0):
    """与 OcrEngine 一致：高 48，按比例缩放，宽补到 8 的倍数（最小 min_w）"""
    h, w = crop.shape[:2]
    r = w / h
    W = fixed_w or int(math.ceil(48 * max(r, min_w / 48) / 8) * 8)
    rw = min(W, int(math.ceil(48 * r)))
    x = (cv2.resize(crop, (rw, 48)).astype(np.float32) / 255.0 - 0.5) / 0.5
    pad = np.zeros((48, W, 3), np.float32)
    pad[:, :rw] = x
    return np.ascontiguousarray(pad.transpose(2, 0, 1)[None])


def decode(o):
    b = o.argmax(1)
    s, p = '', -1
    for v in b:
        if v != 0 and v != p and v < len(CHARS):
            s += CHARS[v]
        p = v
    return s


def load_images():
    """imgs.txt 里 34 张图；同一张图重复上传的按文件大小去重，只识别一次"""
    imgs, uniq = [], {}
    for line in open(os.path.join(OCRTEST, 'imgs.txt'), encoding='utf-8'):
        path = line.strip()
        if not path:
            continue
        name = os.path.basename(path)
        size = os.path.getsize(path)
        j = json.load(open(os.path.join(OCRTEST, 'bx_v5_736', name + '.json'), encoding='utf-8'))
        imgs.append((name, size, j))
        if size not in uniq:
            img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
            crops = []
            for l in j['lines']:
                x1, y1, x2, y2 = [int(v) for v in l['box']]
                c = img[max(0, y1):y2, max(0, x1):x2]
                crops.append(c if c.size and c.shape[0] >= 4 and c.shape[1] >= 4 else None)
            uniq[size] = crops
    return imgs, uniq


def all_crops(uniq):
    return [c for crops in uniq.values() for c in crops if c is not None]


# ---------------------------------------------------------------- 量化
def quant(fp32_dir, out_root):
    import paddle
    paddle.enable_static()
    from paddle.static.quantization import PostTrainingQuantization

    imgs, uniq = load_images()
    crops = all_crops(uniq)
    rng = np.random.default_rng(0)
    idx = [int(i) for i in rng.choice(len(crops), size=min(300, len(crops)), replace=False)]
    print(f'{len(uniq)} 张不重复截图，{len(crops)} 个文字行，取 {len(idx)} 行做校准')

    # Paddle 3.0 的 PTQ 只收 data_loader：一个生成器函数，每次产出 {输入名: 数组}
    exe0 = paddle.static.Executor(paddle.CPUPlace())
    _, feeds, _ = paddle.static.load_inference_model(os.path.join(fp32_dir, 'inference'), exe0)
    feed_name = feeds[0]

    def gen():
        for k, i in enumerate(idx, 1):
            if k % 100 == 0:
                print(f'    校准 {k}/{len(idx)}', flush=True)
            yield {feed_name: prep(crops[i], fixed_w=320)}

    conv = ['conv2d', 'depthwise_conv2d']
    variants = {
        # 名字: (量化的算子, 校准算法, 额外参数, onnx_format)
        'conv_hist': (conv, 'hist', {'hist_percent': 0.9999}, True),
        'conv_avg': (conv, 'avg', {}, True),
        'conv_mse': (conv, 'mse', {}, True),
        'all_hist': (conv + ['matmul_v2', 'matmul', 'mul'], 'hist', {'hist_percent': 0.9999}, True),
        'conv_hist_old': (conv, 'hist', {'hist_percent': 0.9999}, False),  # 旧版 fake_quant 格式，给 Paddle Lite 兜底
    }
    only = sys.argv[4:]
    todo = [t for t in variants if not only or t in only]
    for n, tag in enumerate(todo, 1):
        ops, algo, extra, onnx_fmt = variants[tag]
        print(f'[{n}/{len(todo)}] 量化 {tag}（{algo}）开始...', flush=True)
        dst = os.path.join(out_root, 'pd_int8_' + tag)
        t = time.time()
        try:
            exe = paddle.static.Executor(paddle.CPUPlace())
            ptq = PostTrainingQuantization(
                executor=exe, model_dir=fp32_dir, model_filename='inference.pdmodel',
                params_filename='inference.pdiparams', data_loader=gen, batch_nums=len(idx),
                algo=algo, quantizable_op_type=ops, weight_quantize_type='channel_wise_abs_max',
                onnx_format=onnx_fmt, is_full_quantize=False, **extra)
            ptq.quantize()
            ptq.save_quantized_model(dst, model_filename='inference.pdmodel', params_filename='inference.pdiparams')
            size = os.path.getsize(os.path.join(dst, 'inference.pdiparams')) / 1048576
            print(f'量化 {tag}: 完成，参数文件 {size:.1f} MB，用时 {time.time() - t:.0f}s')
        except Exception as e:
            print(f'量化 {tag} 失败：{type(e).__name__}: {e}')
            traceback.print_exc(limit=3)


# ---------------------------------------------------------------- 评估
class PaddleRec:
    def __init__(self, d):
        import paddle
        paddle.enable_static()
        self.exe = paddle.static.Executor(paddle.CPUPlace())
        self.scope = paddle.static.Scope()
        with paddle.static.scope_guard(self.scope):
            self.prog, self.feeds, self.fetch = paddle.static.load_inference_model(
                os.path.join(d, 'inference'), self.exe)
        self.paddle = paddle

    def __call__(self, x):
        with self.paddle.static.scope_guard(self.scope):
            return self.exe.run(self.prog, feed={self.feeds[0]: x}, fetch_list=self.fetch)[0][0]


class OnnxRec:
    def __init__(self, path):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        self.s = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
        self.name = self.s.get_inputs()[0].name

    def __call__(self, x):
        return self.s.run(None, {self.name: x})[0][0]


def evaluate(out_root):
    imgs, uniq = load_images()
    models = [('onnx_fp32', lambda: OnnxRec(os.path.join(MODELS, 'v5_rec.onnx'))),
              ('onnx_int8', lambda: OnnxRec(os.path.join(MODELS, 'v5q_rec.onnx')))]
    for name in sorted(os.listdir(out_root)):
        d = os.path.join(out_root, name)
        if name.startswith('pd_') and 'det' not in name and os.path.isfile(os.path.join(d, 'inference.pdmodel')):
            models.append((name, lambda d=d: PaddleRec(d)))

    texts = {}
    for tag, make in models:
        try:
            m = make()
        except Exception as e:
            print(f'{tag}: 加载失败 {type(e).__name__}: {e}')
            continue
        res, t0, n = {}, time.time(), 0
        total = sum(c is not None for cs in uniq.values() for c in cs)
        print(f'[{tag}] 识别 {total} 行...', flush=True)
        try:
            for size, crops in uniq.items():
                out = []
                for c in crops:
                    if c is None:
                        out.append('')
                        continue
                    out.append(decode(m(prep(c))))
                    n += 1
                    if n % 200 == 0:
                        print(f'    {tag}: {n}/{total}', flush=True)
                res[size] = out
        except Exception as e:
            print(f'{tag}: 识别失败 {type(e).__name__}: {e}')
            traceback.print_exc(limit=3)
            continue
        print(f'{tag}: {n} 行，电脑 CPU 用时 {time.time() - t0:.1f}s')
        texts[tag] = res
        # 写成和 OcrTest 一样的 json，交给 diff.py 比解析结果
        od = os.path.join(OCRTEST, 'bx_py_' + tag)
        os.makedirs(od, exist_ok=True)
        for name, size, j in imgs:
            lines = [dict(l, text=t) for l, t in zip(j['lines'], res[size]) if t]
            json.dump({'width': j['width'], 'height': j['height'], 'lines': lines},
                      open(os.path.join(od, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)

    for ref in ('onnx_fp32', 'pd_fp32'):
        if ref not in texts:
            continue
        base = [t for s in uniq for t in texts[ref][s]]
        for tag, res in texts.items():
            if tag == ref:
                continue
            q = [t for s in uniq for t in res[s]]
            exact = sum(a == b for a, b in zip(base, q))
            sim = np.mean([difflib.SequenceMatcher(None, a, b).ratio() for a, b in zip(base, q)])
            print(f'RESULT {tag} 对比 {ref}: 逐行完全相同 {exact}/{len(base)} ({exact / len(base):.1%})，字符相似度 {sim:.2%}')
            if ref == 'pd_fp32' and tag.startswith('pd_int8'):
                for a, b in [(a, b) for a, b in zip(base, q) if a != b][:6]:
                    print(f'    原: {a}\n    量: {b}')


if __name__ == '__main__':
    if sys.argv[1] == 'quant':
        quant(sys.argv[2], sys.argv[3])
    else:
        evaluate(sys.argv[2])
