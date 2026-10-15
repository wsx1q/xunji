"""Desktop encrypted storage. The xjdb envelope is shared with Android SecureStore."""
from __future__ import annotations

import base64
import ctypes
import gzip
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import threading
import time
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class _Blob(ctypes.Structure):
    _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(data: bytes, protect: bool) -> bytes:
    """Bind locally cached data keys to the signed-in Windows account, never plaintext."""
    raw = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, dest = _Blob(len(data), raw), _Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    fn = crypt.CryptProtectData if protect else crypt.CryptUnprotectData
    fn.argtypes = [ctypes.POINTER(_Blob), ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(_Blob)]
    fn.restype = ctypes.c_bool
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(dest)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(dest.data, dest.size)
    finally:
        local_free = ctypes.WinDLL('kernel32').LocalFree
        local_free.argtypes, local_free.restype = [ctypes.c_void_p], ctypes.c_void_p
        local_free(dest.data)


def seal(key: bytes, plain: bytes) -> str:
    iv = secrets.token_bytes(12)
    return base64.b64encode(iv + AESGCM(key).encrypt(iv, plain, None)).decode('ascii')


def unseal(key: bytes, blob: str) -> bytes:
    raw = base64.b64decode(blob, validate=True)
    return AESGCM(key).decrypt(raw[:12], raw[12:], None)


def unwrap(kdf: dict, password: str) -> bytes:
    iterations = int(kdf['iter'])
    if not 10000 <= iterations <= 2000000:
        raise ValueError('不支持的密码迭代参数')
    kek = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), base64.b64decode(kdf['salt']), iterations, 32)
    return unseal(kek, kdf['wk'])


class SecureStore:
    def __init__(self, home: Path):
        self.home = Path(home).resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.prefs_path = self.home / 'preferences.json'
        self.lock = threading.RLock()
        self.prefs = json.loads(self.prefs_path.read_text('utf-8')) if self.prefs_path.exists() else {}
        self.dek = None
        self.kdf = None
        self.locked_env = None
        self.pending_dir = None
        self.staged = []
        self.dirty = False

    @property
    def path(self):
        return Path(self.prefs.get('directory') or self.home) / 'xunji.db'

    @property
    def backup_dir(self):
        result = self.home / 'backups'
        result.mkdir(exist_ok=True)
        return result

    def _prefs_save(self):
        atomic_write(self.prefs_path, dumps(self.prefs).encode('utf-8'))

    def _remember(self, key):
        name = hashlib.sha256(str(self.path).casefold().encode()).hexdigest()
        self.prefs.setdefault('keys', {})[name] = base64.b64encode(dpapi(key, True)).decode()
        self._prefs_save()

    def _keys(self):
        if self.dek:
            yield self.dek
        for value in self.prefs.get('keys', {}).values():
            try:
                yield dpapi(base64.b64decode(value), False)
            except Exception:
                continue

    @staticmethod
    def _env(text):
        env = json.loads(text)
        if env.get('fmt') != 'xjdb' or env.get('alg') != 'AES-256-GCM' or env.get('v') != 1:
            raise ValueError('不是有效的洵记数据库文件')
        return env

    def _read_env(self, env, password=''):
        for key in self._keys():
            try:
                return key, gzip.decompress(unseal(key, env['data'])).decode('utf-8')
            except Exception:
                pass
        if not env.get('kdf'):
            raise ValueError('该数据库没有设置密码，只能在创建它的设备上打开')
        if not password:
            return None, None
        try:
            key = unwrap(env['kdf'], password)
        except Exception as exc:
            raise ValueError('密码错误或备份已损坏') from exc
        return key, gzip.decompress(unseal(key, env['data'])).decode('utf-8')

    def stage(self, plain):
        self.staged = [plain[i:i + 1048576] for i in range(0, len(plain), 1048576)]
        return {'ok': True, 'chunks': len(self.staged)}

    def chunk(self, i):
        return self.staged[int(i)] if 0 <= int(i) < len(self.staged) else ''

    def open(self):
        with self.lock:
            self.locked_env = None
            if not self.path.exists():
                if self.prefs.get('directory'):
                    raise ValueError('所选文件夹中找不到 xunji.db')
                self.dek, self.kdf = secrets.token_bytes(32), None
                self._remember(self.dek)
                return {'ok': True, 'data': None}
            env = self._env(self.path.read_text('utf-8-sig'))
            key, plain = self._read_env(env)
            if key is None:
                self.locked_env = env
                return {'ok': False, 'need': 'password'}
            self.dek, self.kdf = key, env.get('kdf')
            return self.stage(plain)

    def unlock(self, password):
        with self.lock:
            if self.locked_env is None:
                raise ValueError('没有需要解锁的数据库')
            key, plain = self._read_env(self.locked_env, password)
            if key is None:
                raise ValueError('请输入密码')
            self.dek, self.kdf = key, self.locked_env.get('kdf')
            self.locked_env = None
            self._remember(key)
            return self.stage(plain)

    def create(self):
        with self.lock:
            self.dek, self.kdf, self.locked_env = secrets.token_bytes(32), None, None
            self._remember(self.dek)
            return {'ok': True, 'data': None}

    def envelope(self, text):
        if self.dek is None:
            raise ValueError('数据库未解锁')
        env = {'fmt': 'xjdb', 'v': 1, 'alg': 'AES-256-GCM'}
        if self.kdf:
            env['kdf'] = self.kdf
        env['data'] = seal(self.dek, gzip.compress(text.encode('utf-8'), compresslevel=6))
        return dumps(env).encode('utf-8')

    def save(self, text):
        with self.lock:
            atomic_write(self.path, self.envelope(text))
            self.dirty = True

    def save_parts(self, meta, parts):
        # Keep the Android column-oriented representation. Do not decode 200k objects in Python.
        text = meta[:-1] + (',' if len(meta) > 2 else '') + '"txns":[' + ','.join(parts) + ']}'
        self.save(text)

    def has_password(self):
        return self.kdf is not None

    def check_password(self, password):
        try:
            return self.kdf is not None and hmac.compare_digest(unwrap(self.kdf, password), self.dek)
        except Exception:
            return False

    def set_password(self, old, password, text):
        with self.lock:
            if len(password) < 6:
                raise ValueError('密码至少 6 位')
            if self.kdf and not self.check_password(old):
                raise ValueError('当前密码错误')
            salt = secrets.token_bytes(16)
            kek = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 120000, 32)
            previous = self.kdf
            self.kdf = {'alg': 'PBKDF2-HMAC-SHA256', 'salt': base64.b64encode(salt).decode(),
                        'iter': 120000, 'wk': seal(kek, self.dek)}
            try:
                self.save(text)
            except Exception:
                self.kdf = previous
                raise

    def clear_password(self, old, text):
        with self.lock:
            if self.prefs.get('directory'):
                raise ValueError('数据库在自定义目录中，请先改回默认位置')
            if self.kdf and not self.check_password(old):
                raise ValueError('当前密码错误')
            previous, self.kdf = self.kdf, None
            try:
                self.save(text)
            except Exception:
                self.kdf = previous
                raise

    def decrypt_backup(self, text, password):
        with self.lock:
            key, plain = self._read_env(self._env(text), password)
            return self.stage(plain) if key else {'ok': False, 'need': 'password'}

    def backup(self, force=False, days=1):
        with self.lock:
            now = time.time()
            if not force and (not self.dirty or (days > 0 and now - self.prefs.get('backup_at', 0) < days * 86400)):
                return {'ok': True, 'skipped': True}
            name = 'xunji_' + time.strftime('%Y%m%d_%H%M%S') + f'_{time.time_ns() % 1000000:06d}.db'
            atomic_write(self.backup_dir / name, self.path.read_bytes())
            files = sorted(self.backup_dir.glob('xunji_*.db'), key=lambda p: p.stat().st_mtime_ns, reverse=True)
            for file in files[5:]:
                file.unlink()
            self.prefs['backup_at'], self.dirty = now, False
            self._prefs_save()
            return {'ok': True, 'name': name}

    def list_backups(self):
        files = sorted(self.backup_dir.glob('xunji_*.db'), key=lambda p: p.stat().st_mtime_ns, reverse=True)
        return {'ok': True, 'items': [{'name': p.name, 'time': int(p.stat().st_mtime * 1000), 'size': p.stat().st_size} for p in files]}

    def restore(self, name):
        if Path(name).name != name or '..' in name or not name.startswith('xunji_'):
            raise ValueError('无效的备份名')
        with self.lock:
            raw = (self.backup_dir / name).read_bytes()
            env = self._env(raw.decode('utf-8'))
            key, plain = self._read_env(env)
            # Validate before replacement. Password-protected foreign backups can be unlocked next.
            atomic_write(self.path, raw)
            if key is None:
                self.locked_env = env
                return {'ok': False, 'need': 'password'}
            self.dek, self.kdf, self.dirty = key, env.get('kdf'), False
            self._remember(key)
            return self.stage(plain)

    def select_directory(self, directory):
        self.pending_dir = Path(directory).resolve()
        return {'ok': True, 'exists': (self.pending_dir / 'xunji.db').is_file(), 'label': str(self.pending_dir)}

    def use_directory(self, mode, text):
        with self.lock:
            target = self.pending_dir
            if target is None:
                raise ValueError('请先选择目录')
            if mode == 'write':
                atomic_write(target / 'xunji.db', self.envelope(text))
            elif mode != 'open' or not (target / 'xunji.db').is_file():
                raise ValueError('该目录中没有数据库文件')
            self.prefs['directory'] = str(target)
            self.pending_dir = None
            if mode == 'write':
                self._remember(self.dek)
            self._prefs_save()
            return {'ok': True, 'label': str(target)}

    def use_default(self, text):
        with self.lock:
            if text:
                atomic_write(self.home / 'xunji.db', self.envelope(text))
            self.prefs.pop('directory', None)
            if text:
                self._remember(self.dek)
            self._prefs_save()
            return {'ok': True}

    def info(self):
        return {'label': str(self.path.parent), 'custom': bool(self.prefs.get('directory')), 'file': 'xunji.db',
                'path': str(self.path), 'defaultPath': str(self.home / 'xunji.db'), 'hasPwd': self.has_password(),
                'backupPath': str(self.backup_dir), 'exportPath': '导出时选择保存位置'}
