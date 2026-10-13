"""对比两次 OcrTest 输出（基准 vs 实验）：python diff.py <基准目录> <实验目录>"""
import glob
import json
import os
import sys

OCR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'ocr')
sys.path.insert(0, OCR)
from bill_parser import parse_bill


def load(f):
    d = json.load(open(f, encoding='utf-8'))
    r = parse_bill(d['lines'], d['width'], d['height'])
    keys = ('kind', 'amount') if os.environ.get('LOOSE') else ('kind', 'amount', 'shop', 'title')
    orders = [tuple(o.get(k) for k in keys) for o in r['orders']]
    return [l['text'] for l in d['lines']], (r['platform']['key'], orders)


base, exp = sys.argv[1], sys.argv[2]
same_parse = same_text = total_text = 0
files = sorted(glob.glob(os.path.join(base, '*.json')))
for f in files:
    name = os.path.basename(f)
    bt, bp = load(f)
    et, ep = load(os.path.join(exp, name))
    common = len(set(bt) & set(et))
    same_text += common
    total_text += len(bt)
    if bp == ep:
        same_parse += 1
    else:
        print(f'{name}: 解析不同')
        print('   基准', bp)
        print('   实验', ep)
        print('   仅基准', [t for t in bt if t not in et][:10])
        print('   仅实验', [t for t in et if t not in bt][:10])
print(f'解析一致 {same_parse}/{len(files)}，文字行一致 {same_text}/{total_text} ({same_text / max(1, total_text):.1%})')
