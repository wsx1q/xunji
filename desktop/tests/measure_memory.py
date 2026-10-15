"""Measure the native OCR process working set and private commit on Windows."""
import base64
import ctypes
from ctypes import wintypes
import gc
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'desktop'))
from local_ocr import LocalOcr

class Counters(ctypes.Structure):
    _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
        (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
        'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
        'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage', 'PrivateUsage')]

rows = []
def sample(stage):
    gc.collect()
    time.sleep(.5)
    counters = Counters(); counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    get = ctypes.WinDLL('psapi', use_last_error=True).GetProcessMemoryInfo
    get.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if not get(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    row = dict(stage=stage, working_set_mib=round(counters.WorkingSetSize/1048576,1),
               private_commit_mib=round(counters.PrivateUsage/1048576,1))
    rows.append(row); print(json.dumps(row), flush=True)

engine = LocalOcr()
sample('before_ocr')
engine.recognize('')
sample('balanced_warm')
data = base64.b64encode((ROOT/'desktop/tests/samples/pdd_orders.jpg').read_bytes()).decode()
engine.recognize(data)
sample('balanced_after_screenshot')
engine.recognize('', {'profile':'accurate'})
assert list(engine.engines) == ['balanced']
sample('legacy_profile_uses_recommended')
engine.release()
sample('released')
engine.recognize(data)
sample('reload_after_release')
engine.release()
sample('released_again')
(ROOT/'desktop/build/memory-measurement.json').write_text(json.dumps(rows, indent=2), 'utf-8')
