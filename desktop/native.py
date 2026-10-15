"""Synchronous compatibility bridge plus coalesced background saves for the shared UI."""
import base64
import ctypes
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from _version import VERSION
from storage import SecureStore, atomic_write, dumps
from local_ocr import LocalOcr
from kbf import read_kbf


def process_age_ms():
    """Include Python imports and, for a frozen app, the matching one-file loader's extraction time."""
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    candidates = [os.getpid()]
    if getattr(sys, 'frozen', False):
        candidates.insert(0, os.getppid())
    for pid in candidates:
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            continue
        try:
            if pid != os.getpid():
                buffer, length = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
                if not kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)) or Path(buffer.value).resolve() != Path(sys.executable).resolve():
                    continue
            times = [wintypes.FILETIME() for _ in range(4)]
            if kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)):
                created = ((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime) / 10000000 - 11644473600
                return max(0, round((time.time() - created) * 1000))
        finally:
            kernel.CloseHandle(handle)
    return None


JSON_METHODS = {'dbOpen', 'dbUnlock', 'dbCreate', 'dbInfo', 'dbUseDir', 'dbUseDefault',
                'dbSaveStatus', 'startupInfo', 'listBackups', 'restoreBackup', 'decryptBackup',
                'forceBackup', 'autoBackup', 'bioAvailable', 'readKbf'}
ERROR_STRING_METHODS = {'dbSave', 'dbCommit', 'dbSetPassword', 'dbClearPassword'}
METHODS = JSON_METHODS | ERROR_STRING_METHODS | {
    'appVersion', 'testTools', 'dbChunk', 'dbChunkDrop', 'dbPart', 'dbWait', 'dbHasPassword',
    'dbCheckPassword', 'dbPickDir', 'bioAuth', 'saveFile', 'exportBackup', 'takeSharedFile',
    'ocrLocalAvailable', 'ocrLocal', 'ocrLocalRelease', 'openDataFolder', 'pollEvents'}


class NativeBridge:
    def __init__(self, directory, test_tools=True):
        self.store = SecureStore(Path(directory))
        self.window = None
        self.test_tools = test_tools
        self.started = time.monotonic()
        self.parts = {}
        self.condition = threading.Condition()
        self.pending = None
        self.saving = False
        self.error = ''
        self.save_thread = threading.Thread(target=self._save_loop, daemon=True)
        self.save_thread.start()
        self.workers = ThreadPoolExecutor(max_workers=2, thread_name_prefix='xunji-native')
        self.ocr_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix='xunji-ocr')
        self.ocr = LocalOcr(on_release=lambda: self.emit('onOcrReleased'))
        self.hello = None
        self.events = []
        self.event_lock = threading.Lock()

    def dispatch(self, method, args):
        if method not in METHODS or not isinstance(args, list):
            raise ValueError('不支持的桌面操作')
        try:
            result = getattr(self, method)(*args)
            return dumps(result) if method in JSON_METHODS else result
        except Exception as exc:
            if method in JSON_METHODS:
                return dumps({'ok': False, 'err': str(exc)})
            if method in ERROR_STRING_METHODS:
                return str(exc)
            raise

    def emit(self, name, *args):
        if self.window:
            try:
                self.window.evaluate_js(f'window[{dumps(name)}] && window[{dumps(name)}]({",".join(dumps(a) for a in args)})')
            except Exception:
                pass  # Window may already have been closed.
        else:
            with self.event_lock:
                self.events.append({'name': name, 'args': args})

    def pollEvents(self):
        with self.event_lock:
            events, self.events = self.events, []
            return events

    def _save_loop(self):
        while True:
            with self.condition:
                while self.pending is None:
                    self.condition.wait()
                meta, parts = self.pending
                self.pending, self.saving = None, True
            error = ''
            try:
                self.store.save_parts(meta, parts)
            except Exception as exc:
                error = str(exc)
            # Do not retain the previous ledger snapshot while waiting for another save.
            del meta, parts
            with self.condition:
                self.error, self.saving = error, False
                self.condition.notify_all()
            if error:
                self.workers.submit(self.emit, 'onSaveError', error)

    def dbWait(self):
        with self.condition:
            while self.saving or self.pending is not None:
                self.condition.wait()

    def _ready(self):
        self.dbWait()
        if self.error:
            raise ValueError('上次保存失败：' + self.error)

    def appVersion(self):
        return VERSION + '-desktop'

    def testTools(self):
        return self.test_tools

    def startupInfo(self):
        elapsed = process_age_ms()
        return {'cold': True, 'elapsedMs': elapsed if elapsed is not None else round((time.monotonic() - self.started) * 1000)}

    def dbSaveStatus(self):
        with self.condition:
            return {'saving': self.saving or self.pending is not None, 'error': self.error}

    def dbPart(self, year, text):
        with self.condition:
            self.parts[str(year)] = text

    def dbCommit(self, meta, years):
        keys = years.split(',') if years else []
        with self.condition:
            if any(year not in self.parts for year in keys):
                return 'missing'
            self.parts = {key: self.parts[key] for key in keys}
            self.pending = (meta, tuple(self.parts[key] for key in keys))
            self.condition.notify_all()
        return ''

    def dbOpen(self):
        self._ready()
        self.parts.clear()
        return self.store.open()

    def dbUnlock(self, password):
        self._ready()
        return self.store.unlock(password)

    def dbCreate(self):
        self.dbWait()
        self.error = ''
        self.parts.clear()
        return self.store.create()

    def dbChunk(self, index):
        return self.store.chunk(index)

    def dbChunkDrop(self):
        self.store.staged = []

    def dbSave(self, text):
        self.dbWait()
        self.store.save(text)
        self.error = ''
        return ''

    def dbHasPassword(self):
        return self.store.has_password()

    def dbCheckPassword(self, password):
        return self.store.check_password(password)

    def dbSetPassword(self, old, password, text):
        self._ready()
        self.store.set_password(old, password, text)
        return ''

    def dbClearPassword(self, old, text):
        self._ready()
        self.store.clear_password(old, text)
        return ''

    def dbInfo(self):
        return self.store.info()

    def dbPickDir(self):
        def choose():
            import webview
            result = self.window.create_file_dialog(webview.FileDialog.FOLDER)
            if result:
                self.emit('onDbDirPicked', dumps(self.store.select_directory(result[0])))
        self.workers.submit(choose)

    def dbUseDir(self, mode, text):
        self._ready()
        result = self.store.use_directory(mode, text)
        self.parts.clear()
        return result

    def dbUseDefault(self, text):
        self._ready()
        result = self.store.use_default(text)
        self.parts.clear()
        return result

    def listBackups(self):
        return self.store.list_backups()

    def forceBackup(self):
        self._ready()
        return self.store.backup(force=True)

    def autoBackup(self, days):
        self._ready()
        return self.store.backup(days=int(days))

    def restoreBackup(self, name):
        self._ready()
        self.parts.clear()
        return self.store.restore(name)

    def decryptBackup(self, text, password=''):
        return self.store.decrypt_backup(text, password)

    def _export(self, name, content, binary=False):
        import webview
        filename = Path(name).name
        result = self.window.create_file_dialog(webview.FileDialog.SAVE, save_filename=filename)
        if not result:
            return '已取消导出'
        path = Path(result if isinstance(result, str) else result[0])
        atomic_write(path, content if binary else content.encode('utf-8'))
        return '已保存到 ' + str(path)

    def saveFile(self, name, text):
        return self._export(name, text)

    def exportBackup(self, name, text):
        self._ready()
        if not self.store.has_password():
            raise ValueError('请先设置数据库密码')
        with self.store.lock:
            raw = self.store.envelope(text)
        return self._export(name, raw, True)

    def readKbf(self, data):
        return read_kbf(base64.b64decode(data, validate=True))

    def ocrLocalAvailable(self):
        return True

    def ocrLocal(self, request_id, data, options='{}'):
        config = json.loads(options)
        if not isinstance(config, dict):
            raise ValueError('OCR 配置格式不正确')
        def recognize():
            try:
                result = self.ocr.recognize(data, config,
                    lambda stage, completed, total: self.emit('onOcrProgress', request_id,
                        dumps({'stage': stage, 'completed': completed, 'total': total})))
            except Exception as exc:
                result = {'ok': False, 'err': str(exc)}
            self.emit('onOcrLocal', request_id, dumps(result))
        self.ocr_worker.submit(recognize)

    def ocrLocalRelease(self):
        # Every completed OCR request schedules native idle expiry, even on this page.
        # Navigation does not interrupt a running batch or extend its cache lifetime.
        pass

    def bioAvailable(self):
        if self.hello is None:
            from hello import availability
            self.hello = availability()
        return self.hello

    def bioAuth(self, message):
        def authenticate():
            from hello import verify
            try:
                hwnd = int(self.window.native.Handle.ToInt64())
                ok, error = verify(hwnd, message)
            except Exception as exc:
                ok, error = False, str(exc)
            self.emit('onBioResult', ok, error)
        self.workers.submit(authenticate)

    def takeSharedFile(self):
        return ''

    def openDataFolder(self):
        import os
        os.startfile(str(self.store.path.parent))
