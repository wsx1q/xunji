@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_apk.ps1" -Emu
pause
