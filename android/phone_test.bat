@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0phone_test.ps1"
echo.
echo 完成，可以关闭窗口
pause
