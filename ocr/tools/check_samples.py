"""用服务同款引擎识别 samples/ 里的截图，核对平台和金额并统计耗时。改规则或换模型后跑一遍。"""
import os
import sys
import time

import cv2

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SRC)
import server
from bill_parser import parse_bill

EXPECT = {
    'pdd_orders.jpg': ('pdd', [('expense', 0.8), ('refund', 0.8), ('expense', 35.89)]),
    'douyin_orders.jpg': ('douyin', [('expense', 79.9), ('expense', 99.9)]),
    'taobao_orders.jpg': ('taobao', [('refund', 18.77), ('refund', 11.8)]),
    'jd_orders.jpg': ('jd', [('expense', 32.77), ('expense', 29.23), ('expense', 79.0)]),
}

t = time.time()
server.engine()
print(f'引擎 {server._engine_name}，加载 {time.time() - t:.1f}s')
bad = 0
for name, want in EXPECT.items():
    img = cv2.imread(os.path.join(SRC, 'samples', name))
    t = time.time()
    lines, w, h = server.run_ocr(img)
    ms = int((time.time() - t) * 1000)
    r = parse_bill(lines, w, h)
    got = (r['platform']['key'], [(o['kind'], o['amount']) for o in r['orders']])
    bad += got != want
    print(f"{'✓' if got == want else '✗'} {name:20} {ms:5}ms  {got}" + ('' if got == want else f'\n    期望 {want}'))
print('全部通过' if not bad else f'{bad} 张不符合预期')
sys.exit(1 if bad else 0)
