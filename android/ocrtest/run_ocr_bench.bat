@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_ocr_bench.ps1"
echo.
echo 测试完成，可以关闭窗口
pause
