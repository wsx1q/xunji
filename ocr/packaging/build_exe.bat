@echo off
rem Build the OCR exe. First run creates an isolated build env in .venv
rem Needs Python 3.10: uses the "py -3.10" launcher if present, otherwise "python" on PATH
cd /d %~dp0
set PYTHONIOENCODING=utf-8
chcp 65001 >nul

if not exist .venv\Scripts\python.exe (
    echo Creating build env...
    py -3.10 -m venv .venv 2>nul || python -m venv .venv || goto :fail
    .venv\Scripts\python -m pip install -q -r requirements.txt || goto :fail
)
.venv\Scripts\python build.py || goto :fail
pause
exit /b 0

:fail
echo BUILD FAILED
pause
exit /b 1
