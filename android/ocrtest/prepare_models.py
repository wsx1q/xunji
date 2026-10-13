"""把 RapidOCR 的模型和字符表复制到 OCR 版 APK 的 assets（app/src/ocr/assets/models）。
用法：..\\..\\ocr\\.venv-rapid\\Scripts\\python prepare_models.py
"""
import os
import shutil

import onnxruntime as ort
import rapidocr

SRC = os.path.join(os.path.dirname(rapidocr.__file__), 'models')
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'src', 'ocr', 'assets', 'models')
MODELS = {
    'v6': ('PP-OCRv6_det_small.onnx', 'PP-OCRv6_rec_small.onnx'),
    'v5': ('ch_PP-OCRv5_det_mobile.onnx', 'ch_PP-OCRv5_rec_mobile.onnx'),
}

os.makedirs(DST, exist_ok=True)
for key, (det, rec) in MODELS.items():
    shutil.copyfile(os.path.join(SRC, det), os.path.join(DST, f'{key}_det.onnx'))
    shutil.copyfile(os.path.join(SRC, rec), os.path.join(DST, f'{key}_rec.onnx'))
    meta = ort.InferenceSession(os.path.join(SRC, rec)).get_modelmeta().custom_metadata_map
    with open(os.path.join(DST, f'{key}_keys.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(meta['character'].splitlines()))
for f in sorted(os.listdir(DST)):
    print(f'{f:20} {os.path.getsize(os.path.join(DST, f)) / 1048576:6.1f} MB')
