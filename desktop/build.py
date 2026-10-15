"""Build a standalone Windows executable including the shared UI and offline OCR models."""
import argparse
import datetime
import shutil
import subprocess
import sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--alias', action='store_true', help='另外更新 dist/洵记电脑版.exe 固定名称副本')
options = parser.parse_args()
version = datetime.datetime.now().strftime('%Y%m%d.%H%M')
(HERE / '_version.py').write_text(f"VERSION = '{version}'\n", encoding='utf-8')
dist = ROOT / 'dist'
dist.mkdir(exist_ok=True)
subprocess.run([sys.executable, str(HERE / 'prepare_models.py')], check=True)
icon = HERE / 'app.ico'
with Image.open(HERE / 'app.png') as image:
    image.save(icon, sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--windowed', '--onefile', '--name', 'xunji-desktop',
        '--icon', str(icon), '--add-data', f'{icon};desktop',
        '--add-data', f'{HERE / "app.png"};desktop',
        *[arg for name in ('PP-OCRv6_det_tiny.onnx', 'v6_rec_indexed.onnx')
          for arg in ('--add-data', f'{HERE / "build/models" / name};desktop/models')],
        '--specpath', str(HERE / 'build'), '--workpath', str(HERE / 'build' / 'work'),
        '--distpath', str(HERE / 'build' / 'output'), '--log-level', 'WARN',
        '--add-data', f'{ROOT / "web"};web', '--add-data', f'{HERE / "style.css"};desktop',
        '--add-data', f'{HERE / "ui.js"};desktop', '--add-data', f'{HERE / "bridge.js"};desktop',
        '--collect-all', 'rapidocr', '--collect-all', 'onnxruntime', '--collect-all', 'winrt',
        '--hidden-import', '_version', '--hidden-import', 'webview.platforms.edgechromium',
        '--hidden-import', 'winrt.windows.security.credentials.ui', '--hidden-import', 'winrt.windows.foundation',
        '--exclude-module', 'torch', '--exclude-module', 'tensorflow', '--exclude-module', 'matplotlib',
        '--exclude-module', 'scipy', '--exclude-module', 'onnx', str(HERE / 'app.py')]
# Generate the normal spec first, then filter only known unused/duplicate assets.
from PyInstaller.building.makespec import main as make_spec
spec_args = args[3:]
# Work/dist/log options belong to the build command, not makespec.
for option in ('--workpath', '--distpath', '--log-level'):
    i = spec_args.index(option)
    del spec_args[i:i+2]
spec_args.remove('--noconfirm')
from PyInstaller.__main__ import generate_parser
namespace = vars(generate_parser().parse_args(spec_args))
spec = Path(make_spec(namespace.pop('filenames'), **namespace))
text = spec.read_text('utf-8')
filters = """
# Only the recommended tiny detector and indexed recognizer are used.
a.datas = [entry for entry in a.datas if entry[0].replace(chr(92), '/').split('/')[-1] not in {
    'PP-OCRv6_det_small.onnx', 'PP-OCRv6_rec_small.onnx', 'ch_ppocr_mobile_v2.0_cls_mobile.onnx'}]
# Screenshots use image decoding only; OpenCV's optional video backend is unused.
a.binaries = [entry for entry in a.binaries if not entry[0].replace(chr(92), '/').split('/')[-1].startswith('opencv_videoio_ffmpeg')]
"""
text = text.replace('pyz = PYZ(a.pure)', filters + '\npyz = PYZ(a.pure)')
spec.write_text(text, 'utf-8')
subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--log-level', 'WARN',
                '--workpath', str(HERE/'build/work'), '--distpath', str(HERE/'build/output'), str(spec)], cwd=ROOT, check=True)
source = HERE / 'build' / 'output' / 'xunji-desktop.exe'
target = dist / f'xunji-desktop-{version}.exe'
shutil.copy2(source, target)
if options.alias:
    shutil.copy2(source, dist / '洵记电脑版.exe')
subprocess.run(['powershell', '-NoProfile', '-File', str(ROOT / 'tools/prune_dist.ps1'), '-Keep', '2'], check=True)
print(f'BUILD_OK {target} ({target.stat().st_size / 1048576:.1f} MB)', flush=True)
