@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0phone_ort.ps1"
echo.
echo Done. Results are in phone_ort_result.txt - you can close this window.
pause
