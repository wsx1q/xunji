"""由 build_exe.bat 在打包环境里调用：PyInstaller 打包后复制到 项目根目录/dist/洵记OCR/"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = '洵记OCR.exe'
OUT_DIR = os.path.abspath(os.path.join(HERE, '..', '..', 'dist', '洵记OCR'))

subprocess.run([sys.executable, '-m', 'PyInstaller', 'ocr_server.spec', '--noconfirm', '--log-level', 'WARN',
                '--workpath', 'build', '--distpath', os.path.join('build', 'dist')], cwd=HERE, check=True)
os.makedirs(OUT_DIR, exist_ok=True)
target = os.path.join(OUT_DIR, NAME)
try:
    shutil.copy2(os.path.join(HERE, 'build', 'dist', NAME), target)
except PermissionError:
    sys.exit(f'无法覆盖 {target}：请先关闭正在运行的 洵记OCR 窗口再打包')
print(f'\n已生成 {target}（{os.path.getsize(target) / 1048576:.1f} MB）')
