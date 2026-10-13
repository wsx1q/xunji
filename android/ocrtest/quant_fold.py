"""把「已并入仿射/偏置」的 v5 识别模型 (q_fold/v5x_fp32.onnx) 做静态 INT8 量化，设置和现在的 v5q 完全一样：
只量化卷积、权重按通道 int8、激活 uint8、百分位 99.99 校准、校准输入统一宽 320、300 行校准数据。
用法：.venv-rapid\\Scripts\\python quant_fold.py      输出 q_fold\\v5x_q.onnx
"""
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
OUT = os.path.join(HERE, 'q_fold')
FP32 = os.path.join(OUT, 'v5x_fp32.onnx')
DST = os.path.join(OUT, 'v5x_q.onnx')


def prep(crop, min_w=160, fixed_w=0):
    h, w = crop.shape[:2]
    r = w / h
    W = fixed_w or int(math.ceil(48 * max(r, min_w / 48) / 8) * 8)
    rw = min(W, int(math.ceil(48 * r)))
    x = (cv2.resize(crop, (rw, 48)).astype(np.float32) / 255.0 - 0.5) / 0.5
    pad = np.zeros((48, W, 3), np.float32)
    pad[:, :rw] = x
    return pad.transpose(2, 0, 1)[None]


crops, seen = [], set()
for line in open(os.path.join(HERE, 'imgs.txt'), encoding='utf-8'):
    path = line.strip()
    if not path:
        continue
    size = os.path.getsize(path)
    if size in seen:
        continue
    seen.add(size)
    j = json.load(open(os.path.join(HERE, 'bx_v5_736', os.path.basename(path) + '.json'), encoding='utf-8'))
    img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    for l in j['lines']:
        x1, y1, x2, y2 = [int(v) for v in l['box']]
        c = img[y1:y2, x1:x2]
        if c.size and c.shape[0] >= 4 and c.shape[1] >= 4:
            crops.append(c)
print(f'{len(seen)} 张不重复截图，{len(crops)} 个文字行')
rng = np.random.default_rng(0)
calib_idx = rng.choice(len(crops), size=min(300, len(crops)), replace=False)
in_name = ort.InferenceSession(FP32, providers=['CPUExecutionProvider']).get_inputs()[0].name


class Reader(CalibrationDataReader):
    def __init__(self):
        self.it = iter(int(i) for i in calib_idx)

    def get_next(self):
        i = next(self.it, None)
        return None if i is None else {in_name: prep(crops[i], fixed_w=320)}


t = time.time()
quantize_static(FP32, DST, Reader(), quant_format=QuantFormat.QDQ,
                activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8, per_channel=True,
                op_types_to_quantize=['Conv'], calibrate_method=CalibrationMethod.Percentile,
                extra_options={'ActivationSymmetric': False, 'WeightSymmetric': True, 'CalibPercentile': 99.99})
print(f'量化完成：{os.path.getsize(FP32) / 1048576:.1f} MB -> {os.path.getsize(DST) / 1048576:.1f} MB，用时 {time.time() - t:.0f}s')
print('RESULT OK', DST)
