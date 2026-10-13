"""对比 Java OcrEngine 输出与电脑端 RapidOCR：python compare.py <java输出目录> [v5|v6]"""
import glob
import json
import os
import sys

OCR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'ocr')
sys.path.insert(0, OCR)
import cv2
import rapidocr
from rapidocr import RapidOCR

from bill_parser import parse_bill

out_dir, ver = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'v6')
models = os.path.join(os.path.dirname(rapidocr.__file__), 'models')
names = {'v6': ('PP-OCRv6_det_small.onnx', 'PP-OCRv6_rec_small.onnx'),
         'v5': ('ch_PP-OCRv5_det_mobile.onnx', 'ch_PP-OCRv5_rec_mobile.onnx')}[ver]
ocr = RapidOCR(params={'Global.use_cls': False, 'Global.max_side_len': 2400, 'Global.log_level': 'error',
                       'Det.model_path': os.path.join(models, names[0]), 'Rec.model_path': os.path.join(models, names[1])})


def summary(lines, w, h):
    r = parse_bill(lines, w, h)
    return r['platform']['key'], [(o['kind'], o['amount']) for o in r['orders']]


for f in sorted(glob.glob(os.path.join(out_dir, '*.json'))):
    j = json.load(open(f, encoding='utf-8'))
    img = cv2.imread(os.path.join(OCR, 'samples', os.path.basename(f)[:-5]))
    r = ocr(img)
    py = []
    for box, t, s in zip(r.boxes, r.txts, r.scores):
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        py.append({'text': t, 'score': float(s), 'box': [min(xs), min(ys), max(xs), max(ys)]})
    jt, pt = [l['text'] for l in j['lines']], [l['text'] for l in py]
    same = len(set(jt) & set(pt))
    js, ps = summary(j['lines'], j['width'], j['height']), summary(py, img.shape[1], img.shape[0])
    print(f"{os.path.basename(f)[:-5]:20} Java {len(jt)} 行 / Python {len(pt)} 行，文字完全相同 {same} 行  解析{'一致' if js == ps else '不一致'}")
    print('    Java  ', js)
    if js != ps:
        print('    Python', ps)
    diff_j = [t for t in jt if t not in pt][:8]
    diff_p = [t for t in pt if t not in jt][:8]
    if diff_j or diff_p:
        print('    仅Java:', diff_j)
        print('    仅Py  :', diff_p)
