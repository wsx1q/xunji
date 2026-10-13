"""把 samples/ 里的截图发给运行中的 OCR 服务（源码或 exe 都行）并打印结果。用法：python tools\\post_test.py [端口]"""
import glob
import json
import os
import sys
import time
import urllib.request
import uuid

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
port = sys.argv[1] if len(sys.argv) > 1 else '8866'
for f in sorted(glob.glob(os.path.join(SRC, 'samples', '*.jpg'))):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n').encode() \
        + open(f, 'rb').read() + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(f'http://127.0.0.1:{port}/ocr', body, {'Content-Type': f'multipart/form-data; boundary={b}'})
    t = time.time()
    try:
        r = json.load(urllib.request.urlopen(req, timeout=60))
        print(f"{os.path.basename(f):20} {r['platform']['name']} 识别{r['ocr_ms']}ms 往返{int((time.time() - t) * 1000)}ms",
              [(o['kind'], o['amount']) for o in r['orders']])
    except Exception as e:
        print(os.path.basename(f), '失败', e)
