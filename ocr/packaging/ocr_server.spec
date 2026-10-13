# 由 build_exe.bat 调用，不要直接在 ocr 目录下运行
import os

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

SRC = os.path.abspath(os.path.join(SPECPATH, '..'))
KEEP_MODELS = ('PP-OCRv6_det_small.onnx', 'PP-OCRv6_rec_small.onnx')
datas = [d for d in collect_data_files('rapidocr')
         if not d[0].endswith('.onnx') or d[0].endswith(KEEP_MODELS)]
datas += collect_data_files('openvino')
datas += [(os.path.join(SRC, 'index.html'), '.')]
binaries = collect_dynamic_libs('openvino') + collect_dynamic_libs('onnxruntime')
hiddenimports = (collect_submodules('uvicorn') + collect_submodules('rapidocr.inference_engine')
                 + ['openvino', 'onnxruntime'])

a = Analysis(
    [os.path.join(SRC, 'server.py')],
    pathex=[SRC],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=['torch', 'paddle', 'paddlex', 'tensorrt', 'MNN', 'tkinter', 'matplotlib', 'IPython'],
)

DROP = ('npu', 'gpu', 'tensorflow', 'pytorch', 'paddle', 'gguf', 'jax', 'videoio_ffmpeg', 'cache.json')


def keep(entry):
    name = entry[0].replace('\\', '/').lower()
    base = name.rsplit('/', 1)[-1]
    if base.endswith('.lib'):
        return False
    return not (('openvino' in name or 'cv2' in name) and any(k in base for k in DROP))


a.binaries = [b for b in a.binaries if keep(b)]
a.datas = [d for d in a.datas if keep(d)]
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas,
    name='洵记OCR',
    console=True,
    upx=False,
)
