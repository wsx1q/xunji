@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_paddle.ps1"
echo.
echo Done. Results are in paddle_result.txt - you can close this window.
pause
