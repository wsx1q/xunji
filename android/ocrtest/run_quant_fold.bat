@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_quant_fold.ps1"
echo.
echo Done - you can close this window.
pause
