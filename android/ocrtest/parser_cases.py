"""生成 JS 解析器对照用例：用 Python 解析器跑一遍，结果写到 parser_cases.json，再用 parser_test.html 对比 JS 结果。
用例来源：ocr/uploads/*.json（电脑 OCR 服务保存的识别结果）、命令行给的目录（默认 res*）下的 *.json；
都没有时直接用电脑端引擎识别 ocr/samples/*.jpg（需要 ocr/.venv-rapid 环境）。
用法：..\\..\\ocr\\.venv-rapid\\Scripts\\python parser_cases.py [结果目录...]
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OCR = os.path.join(HERE, '..', '..', 'ocr')
sys.path.insert(0, OCR)
from bill_parser import parse_bill


def ocr_samples():
    import cv2
    import server
    for f in sorted(glob.glob(os.path.join(OCR, 'samples', '*.jpg'))):
        lines, w, h = server.run_ocr(cv2.imread(f))
        yield os.path.relpath(f, HERE), {'lines': lines, 'width': w, 'height': h}


def saved_results():
    files = glob.glob(os.path.join(OCR, 'uploads', '*.json'))
    for d in sys.argv[1:] or ['res*']:
        files += glob.glob(os.path.join(HERE, d, '*.json'))
    for f in sorted(files):
        yield os.path.relpath(f, HERE), json.load(open(f, encoding='utf-8'))


cases = [{'name': name, 'lines': d['lines'], 'width': d['width'], 'height': d['height'],
          'expect': parse_bill(d['lines'], d['width'], d['height'])} for name, d in saved_results()]
if not cases:
    print('没有保存的识别结果，改为识别 ocr/samples 里的截图…')
    cases = [{'name': name, **d, 'expect': parse_bill(d['lines'], d['width'], d['height'])} for name, d in ocr_samples()]
json.dump(cases, open(os.path.join(HERE, 'parser_cases.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(len(cases), 'cases')
