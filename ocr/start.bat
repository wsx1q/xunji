@echo off
chcp 65001 >nul
cd /d %~dp0
set PYTHONIOENCODING=utf-8
.venv-rapid\Scripts\python server.py %*
pause
