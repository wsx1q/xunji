"""v5 识别模型静态 INT8 量化（QDQ，权重按通道 int8、激活 uint8），并和原模型逐行对比。
用法：.venv-rapid\\Scripts\\python quant_static.py   输出在 ocrtest\\q_static\\"""
import difflib
import glob
import json
import math
import os
import time

import cv2
import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import (CalibrationDataReader, CalibrationMethod, QuantFormat, QuantType,
                                      quantize_static)

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', 'app', 'src', 'ocr', 'assets', 'models')
OUT = os.path.join(HERE, 'q_static')
os.makedirs(OUT, exist_ok=True)
FP32 = os.path.join(MODELS, 'v5_rec.onnx')
keys = open(os.path.join(MODELS, 'v5_keys.txt'), encoding='utf-8').read().split('\n')
chars = [''] + keys + [' ']


def prep(crop, min_w=160, fixed_w=0):
    """与 OcrEngine 一致：高 48，按比例缩放，宽补到 8 的倍数（最小 recMinW）。
    fixed_w>0 时统一补/压到这个宽度（直方图校准要求每次输入形状相同）"""
    h, w = crop.shape[:2]
    r = w / h
    W = fixed_w or int(math.ceil(48 * max(r, min_w / 48) / 8) * 8)
    rw = min(W, int(math.ceil(48 * r)))
    x = (cv2.resize(crop, (rw, 48)).astype(np.float32) / 255.0 - 0.5) / 0.5
    pad = np.zeros((48, W, 3), np.float32)
    pad[:, :rw] = x
    return pad.transpose(2, 0, 1)[None]


def decode(o):
    b = o.argmax(1)
    s, p = '', -1
    for v in b:
        if v != 0 and v != p:
            s += chars[v]
        p = v
    return s


# 1. 取所有文字行的截图块（用 v5 检测736 的框）
crops = []
seen = set()
for line in open(os.path.join(HERE, 'imgs.txt'), encoding='utf-8'):
    path = line.strip()
    if not path:
        continue
    name = os.path.basename(path)
    size = os.path.getsize(path)
    if size in seen:  # 同一张图的重复上传只取一次
        continue
    seen.add(size)
    j = json.load(open(os.path.join(HERE, 'bx_v5_736', name + '.json'), encoding='utf-8'))
    img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    for l in j['lines']:
        x1, y1, x2, y2 = [int(v) for v in l['box']]
        c = img[y1:y2, x1:x2]
        if c.size and c.shape[0] >= 4 and c.shape[1] >= 4:
            crops.append(c)
print(f'{len(seen)} 张不重复截图，{len(crops)} 个文字行')

rng = np.random.default_rng(0)
calib_idx = rng.choice(len(crops), size=min(300, len(crops)), replace=False)


class Reader(CalibrationDataReader):
    def __init__(self, name, fixed_w=0):
        self.name = name
        self.fixed_w = fixed_w
        self.it = iter(int(i) for i in calib_idx)

    def get_next(self):
        i = next(self.it, None)
        return None if i is None else {self.name: prep(crops[i], fixed_w=self.fixed_w)}


in_name = ort.InferenceSession(FP32, providers=['CPUExecutionProvider']).get_inputs()[0].name

# 2. 量化（两种校准方法）
variants = {}
# 第二轮：只量化卷积（前半段骨干网络），矩阵乘（后半段注意力结构，对 int8 敏感）保留 FP32
import sys
ALL = {
    'minmax': (CalibrationMethod.MinMax, {}, 0, ['Conv', 'MatMul', 'Gemm']),
    'pct': (CalibrationMethod.Percentile, {'CalibPercentile': 99.99}, 320, ['Conv', 'MatMul', 'Gemm']),
    'conv_minmax': (CalibrationMethod.MinMax, {}, 0, ['Conv']),
    'conv_pct': (CalibrationMethod.Percentile, {'CalibPercentile': 99.99}, 320, ['Conv']),
}
for tag in (sys.argv[1:] or ['conv_minmax', 'conv_pct']):
    method, extra, fw, ops = ALL[tag]
    dst = os.path.join(OUT, f'v5_rec_qdq_{tag}.onnx')
    t = time.time()
    try:
        quantize_static(FP32, dst, Reader(in_name, fw), quant_format=QuantFormat.QDQ,
                        activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8, per_channel=True,
                        op_types_to_quantize=ops, calibrate_method=method,
                        extra_options={'ActivationSymmetric': False, 'WeightSymmetric': True, **extra})
    except Exception as e:
        print(f'量化 {tag} 失败：{type(e).__name__}: {e}')
        continue
    print(f'量化 {tag}: {os.path.getsize(FP32) / 1048576:.1f} MB -> {os.path.getsize(dst) / 1048576:.1f} MB，用时 {time.time() - t:.0f}s')
    variants[tag] = dst

# 3. 逐行对比
def run_all(model):
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    s = ort.InferenceSession(model, so, providers=['CPUExecutionProvider'])
    out, t0 = [], time.time()
    for c in crops:
        out.append(decode(s.run(None, {in_name: prep(c)})[0][0]))
    return out, time.time() - t0

base, tb = run_all(FP32)
print(f'原模型 FP32：{len(crops)} 行，电脑 CPU 用时 {tb:.1f}s')
for tag, path in variants.items():
    q, tq = run_all(path)
    exact = sum(a == b for a, b in zip(base, q))
    sim = np.mean([difflib.SequenceMatcher(None, a, b).ratio() for a, b in zip(base, q)])
    print(f'RESULT {tag}: 与原模型完全相同 {exact}/{len(crops)} ({exact / len(crops):.1%})，字符相似度 {sim:.2%}，电脑 CPU 用时 {tq:.1f}s（x86 上的 int8 速度不代表手机）')
    diffs = [(a, b) for a, b in zip(base, q) if a != b][:12]
    for a, b in diffs:
        print(f'    原: {a}\n    量: {b}')
