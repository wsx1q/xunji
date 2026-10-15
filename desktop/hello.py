"""Windows Hello verification using the desktop HWND interop API."""
import asyncio
import ctypes
import time
import uuid


def availability():
    try:
        import winrt.windows.foundation  # noqa: F401 -- generic async projection
        from winrt.windows.security.credentials.ui import UserConsentVerifier
        async def check():
            return int(await UserConsentVerifier.check_availability_async())
        code = asyncio.run(check())
        return {'ok': code == 0, 'reason': {0: '', 1: '此电脑没有可用的 Windows Hello 设备',
                2: '请先在 Windows 设置中配置 Windows Hello', 3: 'Windows Hello 被系统策略禁用',
                4: 'Windows Hello 正忙，请稍后重试'}.get(code, 'Windows Hello 暂不可用')}
    except Exception:
        return {'ok': False, 'reason': '此电脑未配置可用的 Windows Hello，仍可使用账本密码解锁'}


class Guid(ctypes.Structure):
    _fields_ = [('bytes', ctypes.c_ubyte * 16)]

    def __init__(self, value):
        super().__init__((ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(str(value)).bytes_le))


def _call(pointer, slot, restype, types, *args):
    table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    method = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *types)(table[slot])
    return method(pointer, *args)


def verify(hwnd, message):
    if not hwnd:
        return False, '无法获取应用窗口，请改用密码解锁'
    runtime = ctypes.WinDLL('combase')
    runtime.RoInitialize.argtypes, runtime.RoInitialize.restype = [ctypes.c_uint], ctypes.c_long
    initialized = runtime.RoInitialize(1) >= 0
    factory, operation, info = ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_void_p()
    strings = []
    try:
        def string(value):
            handle = ctypes.c_void_p()
            runtime.WindowsCreateString.argtypes = [ctypes.c_wchar_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p)]
            if runtime.WindowsCreateString(value, len(value), ctypes.byref(handle)) < 0:
                raise OSError('无法创建 Windows 字符串')
            strings.append(handle)
            return handle
        runtime.RoGetActivationFactory.argtypes = [ctypes.c_void_p, ctypes.POINTER(Guid), ctypes.POINTER(ctypes.c_void_p)]
        iid = Guid('39e050c3-4e74-441a-8dc0-b81104df949c')
        if runtime.RoGetActivationFactory(string('Windows.Security.Credentials.UI.UserConsentVerifier'), ctypes.byref(iid), ctypes.byref(factory)) < 0:
            raise OSError('此系统不支持桌面 Windows Hello 验证')
        signature = 'pinterface({9fc2b0bb-e446-44e2-aa61-9cab8f636af2};enum(Windows.Security.Credentials.UI.UserConsentVerificationResult;i4))'
        async_iid = Guid(uuid.uuid5(uuid.UUID('11f47ad5-7b73-42c0-abae-878b1e16adee'), signature))
        result = _call(factory, 3, ctypes.c_long,
                       [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(Guid), ctypes.POINTER(ctypes.c_void_p)],
                       hwnd, string(message), ctypes.byref(async_iid), ctypes.byref(operation))
        if result < 0:
            raise OSError('无法打开 Windows Hello，请改用密码')
        info_iid = Guid('00000036-0000-0000-c000-000000000046')
        if _call(operation, 0, ctypes.c_long, [ctypes.POINTER(Guid), ctypes.POINTER(ctypes.c_void_p)], ctypes.byref(info_iid), ctypes.byref(info)) < 0:
            raise OSError('无法读取验证状态')
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            status = ctypes.c_int()
            if _call(info, 7, ctypes.c_long, [ctypes.POINTER(ctypes.c_int)], ctypes.byref(status)) < 0:
                break
            if status.value == 1:
                answer = ctypes.c_int()
                hr = _call(operation, 8, ctypes.c_long, [ctypes.POINTER(ctypes.c_int)], ctypes.byref(answer))
                return hr >= 0 and answer.value == 0, '' if hr >= 0 and answer.value == 0 else '未通过 Windows Hello 验证，可继续使用密码'
            if status.value in (2, 3):
                break
            time.sleep(.1)
        _call(info, 9, ctypes.c_long, [])
        return False, '验证已取消或超时'
    except Exception as exc:
        return False, str(exc)
    finally:
        for pointer in (info, operation, factory):
            if pointer.value:
                _call(pointer, 2, ctypes.c_ulong, [])
        runtime.WindowsDeleteString.argtypes = [ctypes.c_void_p]
        for handle in strings:
            runtime.WindowsDeleteString(handle)
        if initialized:
            runtime.RoUninitialize()
