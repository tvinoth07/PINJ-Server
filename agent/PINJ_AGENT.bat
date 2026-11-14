@echo off
REM ---------------------------------------------------------------------------
REM  PINJ_AGENT.bat - connects the radio modem on THIS PC to your PINJ bench.
REM  Keep this window open while you test. Close it to release the modem.
REM  Needs Python 3.9 or newer (https://www.python.org/downloads/).
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title PINJ Modem Agent
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY goto :nopython
%PY% -X utf8 "%~dp0pinj_agent.py"
echo.
pause
exit /b 0

:nopython
echo.
echo  Python 3.9 or newer is needed on this PC:  https://www.python.org/downloads/
echo  (during install tick "Add python.exe to PATH"), then run PINJ_AGENT.bat again.
pause
exit /b 1
