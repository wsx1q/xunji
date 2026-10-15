import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from local_ocr import LocalOcr
from native import NativeBridge

class FakeModels(LocalOcr):
    def __init__(self):
        super().__init__();self.builds=[]

    def _build(self,profile,progress):
        self.builds.append(profile)
        for stage in ['loading','warming']:
            for completed in range(3):progress(stage,completed,2)
        return object()

class OcrCacheTests(unittest.TestCase):
    def test_single_profile_migration_release_and_reload(self):
        engine=FakeModels()
        self.addCleanup(engine.release)
        for profile in ['balanced','accurate','fast']:
            engine.recognize('',{'profile':profile})
        self.assertEqual(engine.builds,['balanced'])
        self.assertEqual(list(engine.engines),['balanced'])
        engine.release()
        self.assertIsNone(engine.engine)
        self.assertIsNone(engine.rec_session)
        self.assertFalse(engine.engines)
        engine.recognize('')
        self.assertEqual(engine.builds,['balanced','balanced'])

    def test_idle_release_and_timer_reset(self):
        import threading
        engine=FakeModels()
        self.addCleanup(engine.release)
        released=threading.Event()
        engine.on_release=released.set
        engine.idle_seconds=0.1
        engine.recognize('')
        stale=engine.idle_timer
        engine.recognize('')
        stale.function()
        self.assertIsNotNone(engine.engine)
        self.assertTrue(released.wait(5))
        self.assertIsNone(engine.engine)
        engine.recognize('')
        self.assertEqual(engine.builds,['balanced','balanced'])

    def test_failure_still_expires(self):
        import threading
        engine=FakeModels()
        self.addCleanup(engine.release)
        released=threading.Event()
        engine.on_release=released.set
        engine.idle_seconds=0.1
        with self.assertRaises(Exception):engine.recognize('not base64')
        self.assertTrue(released.wait(5))
        self.assertIsNone(engine.engine)

    def test_native_page_leave_retains_models_and_progress_has_request_id(self):
        with tempfile.TemporaryDirectory(prefix='xunji-ocr-cache-') as directory:
            bridge=NativeBridge(Path(directory));bridge.ocr=FakeModels()
            try:
                bridge.ocrLocal('warm-one','','{"profile":"balanced"}')
                bridge.ocr_worker.submit(lambda:None).result(timeout=10)
                first=bridge.pollEvents()
                progress=[json.loads(e['args'][1]) for e in first if e['name']=='onOcrProgress']
                self.assertTrue(all(e['args'][0]=='warm-one' for e in first))
                self.assertIn({'stage':'loading','completed':1,'total':2},progress)
                bridge.ocrLocalRelease()
                bridge.ocrLocal('warm-two','','{"profile":"balanced"}')
                bridge.ocr_worker.submit(lambda:None).result(timeout=10)
                second=bridge.pollEvents()
                self.assertEqual(bridge.ocr.builds,['balanced'])
                self.assertFalse(any(json.loads(e['args'][1])['stage']=='loading' for e in second if e['name']=='onOcrProgress'))
                result=next(json.loads(e['args'][1]) for e in second if e['name']=='onOcrLocal')
                self.assertEqual(result['profiles'],['balanced']);self.assertTrue(result['cached'])
            finally:
                bridge.ocr.release();bridge.ocr_worker.shutdown(wait=True);bridge.workers.shutdown(wait=True)

if __name__=='__main__':unittest.main()
