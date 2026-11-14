@echo off
REM PINJ_MONITOR.bat - one panel per user (3 per row) from the PINJ activity log. Read-only; close any time.
REM "PINJ_MONITOR.bat all" also shows browser polls when the server runs verbose.
setlocal
set "APP=%~dp0"
title PINJ monitor
if not exist "%APP%.venv\Scripts\python.exe" (
  echo  Run START_PINJ.bat once first.
  pause
  exit /b 1
)
"%APP%.venv\Scripts\python.exe" -c "import rich" >nul 2>&1 || "%APP%.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q rich==15.0.0
"%APP%.venv\Scripts\python.exe" -X utf8 "%APP%backend\monitor.py" %*
