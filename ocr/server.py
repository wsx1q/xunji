"""局域网 OCR 账单识别服务（RapidOCR + OpenVINO，CPU）。

启动：  python server.py [--port 8866] [--host 0.0.0.0]   或双击打包好的 洵记OCR.exe
配置：  同目录 ocr_config.ini（首次运行自动生成），命令行参数优先
测试页：浏览器打开 http://<电脑IP>:<端口>/
接口：  POST /ocr  multipart 字段 file（图片），可选请求头 X-Token
"""
import argparse
import base64
import configparser
import json
import os
import socket
import sys
import threading
import time

import cv2
import numpy as np

FROZEN = getattr(sys, 'frozen', False)
APP_DIR = os.path.dirname(sys.executable) if FROZEN else os.path.dirname(os.path.abspath(__file__))
RES_DIR = getattr(sys, '_MEIPASS', APP_DIR)
CONFIG_PATH = os.path.join(APP_DIR, 'ocr_config.ini')
DEFAULT_CONFIG = """[server]
; 监听地址：0.0.0.0 表示允许局域网内其他设备访问
host = 0.0.0.0
; 端口：手机 App 里填写的地址要和这里一致，例如 http://192.168.1.10:8866
port = 8866
; 访问口令（可选）：填了之后请求需带 X-Token 请求头
token =
; 是否把上传的截图和识别结果保存到 uploads 目录（1 保存 / 0 不保存），方便排查识别问题
save_uploads = 1

[ocr]
; 推理引擎：openvino（更快）或 onnxruntime
engine = openvino
; 图片最长边超过该值会先缩小
max_side = 2400
"""


def load_config():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            f.write(DEFAULT_CONFIG)
    cp = configparser.ConfigParser()
    cp.read_string(DEFAULT_CONFIG)
    try:
        cp.read(CONFIG_PATH, encoding='utf-8-sig')
        cp.getint('server', 'port')
    except (configparser.Error, ValueError) as e:
        print(f'配置文件 {CONFIG_PATH} 格式有误，已改用默认配置：{e}', flush=True)
        cp = configparser.ConfigParser()
        cp.read_string(DEFAULT_CONFIG)
    return cp


CFG = load_config()
TOKEN = os.environ.get('OCR_TOKEN', CFG.get('server', 'token').strip())
SAVE_UPLOADS = os.environ.get('OCR_SAVE_UPLOADS', CFG.get('server', 'save_uploads')).strip() == '1'
MAX_SIDE = CFG.getint('ocr', 'max_side')
UPLOAD_DIR = os.path.join(APP_DIR, 'uploads')

import uvicorn
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from starlette.concurrency import run_in_threadpool

from bill_parser import parse_bill

app = FastAPI(title='洵记 OCR')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

_engine = None
_engine_name = ''
_lock = threading.Lock()


def _build(engine_type):
    import rapidocr
    from rapidocr import EngineType, RapidOCR
    models = os.path.join(os.path.dirname(rapidocr.__file__), 'models')
    et = EngineType(engine_type)
    return RapidOCR(params={
        'Global.use_cls': False, 'Global.max_side_len': MAX_SIDE, 'Global.log_level': 'error',
        'Det.engine_type': et, 'Rec.engine_type': et,
        'Det.model_path': os.path.join(models, 'PP-OCRv6_det_small.onnx'),
        'Rec.model_path': os.path.join(models, 'PP-OCRv6_rec_small.onnx'),
    })


def engine():
    global _engine, _engine_name
    if _engine is None:
        want = CFG.get('ocr', 'engine').strip() or 'openvino'
        for name in dict.fromkeys([want, 'onnxruntime']):
            try:
                eng = _build(name)
                eng(np.full((64, 256, 3), 255, np.uint8))
                _engine, _engine_name = eng, name
                break
            except Exception as e:
                print(f'推理引擎 {name} 不可用：{e}', flush=True)
        if _engine is None:
            raise RuntimeError('没有可用的推理引擎')
    return _engine


def _ocr_one(img):
    with _lock:
        r = engine()(img)
    lines = []
    if r.boxes is not None:
        for box, t, s in zip(r.boxes, r.txts, r.scores):
            xs, ys = [p[0] for p in box], [p[1] for p in box]
            lines.append({'text': t, 'score': round(float(s), 3),
                          'box': [round(float(v), 1) for v in (min(xs), min(ys), max(xs), max(ys))]})
    return lines


def run_ocr(img):
    """长截图（高 > 2.6 倍宽，如淘宝自带长截图）整张缩到 max_side 以内字就糊了：
    按原分辨率切成高 = 2 倍宽、相邻重叠 1/4 宽的段逐段识别，每段只保留中心落在自己负责范围内的行"""
    h, w = img.shape[:2]
    if h <= w * 2.6:
        return _ocr_one(img), w, h
    seg, ov = w * 2, max(160, w // 4)
    step = seg - ov
    lines, y0 = [], 0
    while True:
        y1 = min(h, y0 + seg)
        lo = -1 if y0 == 0 else y0 + ov / 2
        hi = float('inf') if y1 >= h else y1 - ov / 2
        for l in _ocr_one(img[y0:y1]):
            b = l['box']
            cy = y0 + (b[1] + b[3]) / 2
            if lo <= cy < hi:
                l['box'] = [b[0], round(b[1] + y0, 1), b[2], round(b[3] + y0, 1)]
                lines.append(l)
        if y1 >= h:
            break
        y0 += step
    lines.sort(key=lambda l: l['box'][1])
    return lines, w, h


def decode_image(data: bytes):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, '无法解析图片')
    return img


def check_token(x_token):
    if TOKEN and x_token != TOKEN:
        raise HTTPException(401, 'token 不正确')


@app.get('/health')
def health():
    return {'ok': True, 'engine': _engine_name, 'loaded': _engine is not None}


@app.post('/ocr')
async def ocr(request: Request, file: UploadFile = File(None), x_token: str = Header(None)):
    check_token(x_token)
    if file is not None:
        data = await file.read()
    else:
        try:
            raw = (await request.json()).get('image', '')
            data = base64.b64decode(raw.split(',', 1)[-1])
        except (ValueError, AttributeError):
            raise HTTPException(400, '请求里没有图片')
    # 识别要几百毫秒到几秒，放到线程池里跑，不堵住事件循环（期间 /health 等请求照常响应）
    return await run_in_threadpool(process, data)


def process(data: bytes):
    img = decode_image(data)
    t0 = time.time()
    lines, w, h = run_ocr(img)
    ocr_ms = int((time.time() - t0) * 1000)
    result = parse_bill(lines, w, h)
    result.update({'width': w, 'height': h, 'ocr_ms': ocr_ms, 'lines': lines})
    if SAVE_UPLOADS:
        save_upload(data, result)
    else:
        log(result)
    return result


def log(result, name=''):
    print(f"[{time.strftime('%H:%M:%S')}] {result['platform']['name']} · {len(result['orders'])} 单 · "
          f"{len(result['lines'])} 行 · {result['ocr_ms']}ms" + (f' → uploads/{name}.jpg' if name else ''), flush=True)


def save_upload(data, result):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    name = time.strftime('%Y%m%d_%H%M%S') + f"_{result['platform']['key']}"
    with open(os.path.join(UPLOAD_DIR, name + '.jpg'), 'wb') as f:
        f.write(data)
    with open(os.path.join(UPLOAD_DIR, name + '.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    files = sorted(os.listdir(UPLOAD_DIR))
    for old in files[:-60]:
        os.remove(os.path.join(UPLOAD_DIR, old))
    log(result, name)


@app.get('/', response_class=HTMLResponse)
def index():
    with open(os.path.join(RES_DIR, 'index.html'), encoding='utf-8') as f:
        return f.read()


def lan_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.'):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips)


def port_free(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def fail(msg):
    print(msg, flush=True)
    if FROZEN:
        input('按回车键退出…')
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default=CFG.get('server', 'host').strip() or '0.0.0.0')
    ap.add_argument('--port', type=int, default=CFG.getint('server', 'port'))
    args = ap.parse_args()
    if not port_free(args.host, args.port):
        fail(f'端口 {args.port} 已被占用。请关闭占用它的程序，或修改 {CONFIG_PATH} 里的 port 后重新运行。')
    print('正在加载 OCR 模型…', flush=True)
    t = time.time()
    try:
        engine()
    except Exception as e:
        fail(f'模型加载失败：{e}')
    print(f'模型已加载（{_engine_name}），用时 {time.time() - t:.1f}s', flush=True)
    print(f'配置文件：{CONFIG_PATH}', flush=True)
    for ip in lan_ips():
        print(f'  局域网访问: http://{ip}:{args.port}/', flush=True)
    print('手机 App「识别账单导入」里填上面的地址即可。关闭此窗口即停止服务。', flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level='warning', log_config=None)


if __name__ == '__main__':
    main()
