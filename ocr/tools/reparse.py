"""用 uploads/ 里保存的识别文字重新跑规则（不重新 OCR），调规则时用。"""
import glob
import json
import os
import sys

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SRC)
from bill_parser import parse_bill

seen = set()
for f in sorted(glob.glob(os.path.join(SRC, 'uploads', '*.json'))):
    d = json.load(open(f, encoding='utf-8'))
    key = ''.join(l['text'] for l in d['lines'])
    if key in seen:
        continue
    seen.add(key)
    r = parse_bill(d['lines'], d['width'], d['height'])
    print(f"===== {os.path.basename(f)} → {r['platform']['name']} {r['platform']['scores']}")
    for o in r['orders']:
        print(f"  {o['kind']:8} {o['status']:10} ¥{o['amount']:<8} [{o['confidence']}] {o['shop']} | {o['title'][:28]}")
    if r['incomplete']:
        print(f"  （{len(r['incomplete'])} 张不完整卡片已忽略）")
    print('  合计', r['summary'])
