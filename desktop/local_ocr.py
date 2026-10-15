"""Offline OCR; bundled models and long-screenshot segmentation, no server required."""
import base64
import gc
import os
import sys
import threading
import time
from pathlib import Path


class LocalOcr:
    def __init__(self, idle_seconds=180, on_release=None):
        self.engine = None
        self.profile = None
        self.engines = {}
        self.idle_seconds = idle_seconds
        self.on_release = on_release
        self.idle_timer = None
        self.generation = 0
        self.rec_session = None
        # Reserve CPU capacity for the desktop UI; never create a pool per core.
        self.threads = min(4, max(1, (os.cpu_count() or 2) // 2))
        self.lock = threading.Lock()

    def _cancel_idle(self):
        self.generation += 1
        if self.idle_timer:
            self.idle_timer.cancel()
            self.idle_timer = None

    def _release_locked(self):
        self._cancel_idle()
        self.engine = None
        self.profile = None
        self.engines.clear()
        self.rec_session = None
        gc.collect()
        if self.on_release:
            self.on_release()

    def release(self):
        with self.lock:
            self._release_locked()

    def _schedule_idle(self):
        self._cancel_idle()
        generation = self.generation
        def expire():
            with self.lock:
                if generation == self.generation:
                    self._release_locked()
        self.idle_timer = threading.Timer(self.idle_seconds, expire)
        self.idle_timer.daemon = True
        self.idle_timer.start()

    def _build(self, profile, progress):
        progress('loading', 0, 2)
        import cv2
        import numpy as np
        import onnxruntime as ort
        import rapidocr
        from rapidocr import RapidOCR, EngineType
        from omegaconf import flag_override
        from fast_rec import attach_indexed_recognizer

        cv2.setNumThreads(1)
        models = Path(sys._MEIPASS) / 'desktop/models' if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent/'build/models'
        det = models/'PP-OCRv6_det_tiny.onnx'
        rec = models/'v6_rec_indexed.onnx'
        engine = RapidOCR(params={
            'Global.use_cls': False, 'Global.max_side_len': 2400, 'Global.log_level': 'error',
            'Det.engine_type': EngineType.ONNXRUNTIME, 'Rec.engine_type': EngineType.ONNXRUNTIME,
            'Det.model_path': str(det), 'Rec.model_path': str(rec),
            # Cap detection pixels while retaining original-resolution text crops.
            'Det.limit_type': 'max', 'Det.limit_side_len': 1280,
            'Rec.rec_batch_num': 4, 'Rec.rec_img_shape': [3, 48, 160],
        })
        for index, (section, model) in enumerate([(engine.cfg.Det, det), (engine.cfg.Rec, rec)]):
            options = ort.SessionOptions()
            options.intra_op_num_threads = self.threads
            options.inter_op_num_threads = 1
            options.enable_cpu_mem_arena = False
            options.enable_mem_pattern = False
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            options.add_session_config_entry('session.intra_op.allow_spinning', '0')
            options.add_session_config_entry('session.inter_op.allow_spinning', '0')
            options.log_severity_level = 4
            if index == 1 and self.rec_session is not None:
                session = self.rec_session
            else:
                session = ort.InferenceSession(str(model), options, providers=['CPUExecutionProvider'])
                if index == 1:
                    self.rec_session = session
            with flag_override(section, 'allow_objects', True):
                section.session = session
            progress('loading', index + 1, 2)
        attach_indexed_recognizer(engine)
        # Preload both stages: a blank detection image alone never loads recognition.
        progress('warming', 0, 2)
        engine(np.full((640, 1280, 3), 255, np.uint8))
        progress('warming', 1, 2)
        engine.recognize_txt([np.full((48, 160, 3), 255, np.uint8)])
        progress('warming', 2, 2)
        return engine

    def recognize(self, data, options=None, progress=None):
        with self.lock:
            self._cancel_idle()
            try:
                return self._recognize(data, options, progress)
            finally:
                self._schedule_idle()

    def _recognize(self, data, options, progress):
        progress = progress or (lambda *_: None)
        progress('queued', 0, 0)
        start, load_ms = time.perf_counter(), 0
        progress('initializing', 0, 0)
        import cv2
        import numpy as np
        # Migrate all legacy profile requests to the single recommended model.
        profile = 'balanced'
        if profile not in self.engines:
            self.engine = self._build(profile, progress)
            self.engines[profile] = self.engine
            load_ms = round((time.perf_counter() - start) * 1000)
        self.engine = self.engines[profile]
        self.profile = profile
        progress('ready', 1, 1)
        if not data:
            return {'ok': True, 'lines': [], 'width': 0, 'height': 0,
                    'profiles': list(self.engines), 'load_ms': load_ms, 'cached': not load_ms}
        progress('preparing', 0, 1)
        raw = base64.b64decode(data.split(',', 1)[-1], validate=True)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError('无法读取该图片')
        h, w = img.shape[:2]
        if w * h > 120000000:
            raise ValueError('图片过大，请分段截图后重试')
        segments = [(0, h, -1, float('inf'))]
        if h > w * 2.6:
            segments, y = [], 0
            overlap, segment = max(160, w // 4), max(w * 2, 320)
            while True:
                end = min(h, y + segment)
                segments.append((y, end, -1 if y == 0 else y + overlap / 2,
                                 float('inf') if end == h else end - overlap / 2))
                if end == h:
                    break
                y += segment - overlap
        lines, det_time, rec_time = [], 0.0, 0.0
        progress('recognizing', 0, len(segments))
        for index, (y, end, lo, hi) in enumerate(segments):
            result = self.engine(img[y:end])
            elapsed = result.elapse_list
            det_time += float(elapsed[0] or 0) if len(elapsed) > 0 else 0
            rec_time += float(elapsed[2] or 0) if len(elapsed) > 2 else 0
            progress('recognizing', index + 1, len(segments))
            if result.boxes is None:
                continue
            for box, text, score in zip(result.boxes, result.txts, result.scores):
                xs, ys = [float(p[0]) for p in box], [float(p[1]) for p in box]
                cy = y + (min(ys) + max(ys)) / 2
                if lo <= cy < hi:
                    lines.append({'text': text, 'score': round(float(score), 3),
                                  'box': [min(xs), min(ys) + y, max(xs), max(ys) + y]})
        lines.sort(key=lambda item: item['box'][1])
        total = round((time.perf_counter() - start) * 1000)
        return {'ok': True, 'lines': lines, 'width': w, 'height': h,
                'profiles': list(self.engines),
                'model': {'balanced':'PP-OCRv6 均衡','accurate':'PP-OCRv6 精细'}[profile], 'threads': self.threads,
                'total_ms': total, 'det_ms': round(det_time * 1000), 'rec_ms': round(rec_time * 1000),
                'load_ms': load_ms, 'cached': not load_ms}
