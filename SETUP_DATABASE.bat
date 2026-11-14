@echo off
REM ---------------------------------------------------------------------------
REM  SETUP_DATABASE.bat - keep the PINJ accounts in MySQL 8 (run once).
REM  Creates database "pinj" and a limited login "pinj_app" (this PC only),
REM  then copies any accounts PINJ already has. You type the MySQL ROOT
REM  password yourself into mysql.exe - PINJ never sees or keeps it.
REM  Afterwards: STOP_PINJ.bat, then START_PINJ.bat.
REM ---------------------------------------------------------------------------
setlocal
set "APP=%~dp0"
set "VENV=%APP%.venv"
title PINJ - MySQL set-up
if not exist "%VENV%\Scripts\python.exe" (
  echo  Run START_PINJ.bat once first ^(it prepares Python^), then run this again.
  pause
  exit /b 1
)
"%VENV%\Scripts\python.exe" -c "import pymysql, cryptography" >nul 2>&1 || "%VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "%APP%backend\requirements-windows.txt"
"%VENV%\Scripts\python.exe" "%APP%backend\setup_database.py"
echo.
pause
