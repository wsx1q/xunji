import base64
import collections
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'desktop'))
sys.path.insert(0, str(ROOT / 'desktop'))
from local_ocr import LocalOcr
from bill_parser import parse_bill

expected = {
    'pdd_orders.jpg': ('pdd', [('expense', .8), ('refund', .8), ('expense', 35.89)]),
    'douyin_orders.jpg': ('douyin', [('expense', 79.9), ('expense', 99.9)]),
    'taobao_orders.jpg': ('taobao', [('refund', 18.77), ('refund', 11.8)]),
    'jd_orders.jpg': ('jd', [('expense', 32.77), ('expense', 29.23), ('expense', 79.)]),
}
engine = LocalOcr()
for profile in ['balanced']:
    for name, want in expected.items():
        result = engine.recognize(base64.b64encode((ROOT / 'desktop/tests/samples' / name).read_bytes()).decode(), {'profile':profile})
        parsed = parse_bill(result['lines'], result['width'], result['height'])
        got = (parsed['platform']['key'], [(o['kind'], o['amount']) for o in parsed['orders']])
        assert got == want, (profile, name, got, want)
        print('PASS:', profile, name, result['total_ms'], 'ms', got, flush=True)

# Lower-resolution screenshots and a stitched long screenshot exercise detection
# scaling, segment overlap deduplication and original-coordinate restoration.
import cv2
import numpy as np
for name, want in expected.items():
    image=cv2.imread(str(ROOT/'desktop/tests/samples'/name))
    h,w=image.shape[:2]
    image=cv2.resize(image,(max(1,round(w*.7)),max(1,round(h*.7))))
    raw=cv2.imencode('.png',image)[1].tobytes()
    result=engine.recognize(base64.b64encode(raw).decode())
    parsed=parse_bill(result['lines'],result['width'],result['height'])
    got=(parsed['platform']['key'],[(o['kind'],o['amount']) for o in parsed['orders']])
    assert got==want,('scaled',name,got,want)
    print('PASS: scaled',name,flush=True)
image=cv2.imread(str(ROOT/'desktop/tests/samples/pdd_orders.jpg'))
image=np.concatenate([image,image],axis=0)
raw=cv2.imencode('.png',image)[1].tobytes()
result=engine.recognize(base64.b64encode(raw).decode())
assert (result['width'],result['height'])==(image.shape[1],image.shape[0])
assert all(0<=line['box'][1]<=line['box'][3]<=image.shape[0] for line in result['lines'])
parsed=parse_bill(result['lines'],result['width'],result['height'])
got=collections.Counter((o['kind'],o['amount']) for o in parsed['orders'])
assert got==collections.Counter(expected['pdd_orders.jpg'][1]*2),('long image',got)
print('PASS: long screenshot coordinates, order totals and overlap deduplication',flush=True)
