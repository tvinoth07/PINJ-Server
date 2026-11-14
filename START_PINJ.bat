@echo off
REM ---------------------------------------------------------------------------
REM  START_PINJ.bat - runs PINJ on this PC as a server for the whole network.
REM  Other PCs open  http://<this-PC-IP>:8080  in Edge or Chrome. No WSL needed.
REM
REM  First run (internet needed once): creates .venv, installs the Python
REM  packages, and builds the pages if frontend\dist is missing.
REM  Close this window, or run STOP_PINJ.bat, to stop the server.
REM  Uses the installed python.exe (signed), so Smart App Control allows it.
REM  Port 8080 keeps this PINJ apart from the WSL PINJ on 8000/7000.
REM ---------------------------------------------------------------------------
setlocal
set "APP=%~dp0"
set "VENV=%APP%.venv"
set "PORT=8080"
set "PINJ_PORT=%PORT%"
REM  "START_PINJ.bat verbose" also shows every request (polls included) and every bench message.
set "PINJ_VERBOSE="
if /i "%~1"=="verbose" set "PINJ_VERBOSE=1"
title PINJ server - port %PORT%

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 }" || goto :already

if not exist "%VENV%\Scripts\python.exe" (
  echo  PINJ first run - creating the Python environment ...
  py -3 -m venv "%VENV%" 2>nul || python -m venv "%VENV%" || goto :nopython
)
"%VENV%\Scripts\python.exe" -c "import fastapi, uvicorn, serial, openpyxl, pymysql, httpx, cryptography, rich" >nul 2>&1 || (
  echo  Installing the Python packages ^(internet needed once^) ...
  "%VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "%APP%backend\requirements-windows.txt" || goto :pipfail
)

if not exist "%APP%frontend\dist\index.html" (
  echo  Building the PINJ pages ^(once^) ...
  where npm >nul 2>&1 || goto :nonode
  pushd "%APP%frontend"
  call npm install --no-audit --no-fund || (popd & goto :buildfail)
  call npm run build || (popd & goto :buildfail)
  popd
)

for /f "usebackq delims=" %%i in (`call "%VENV%\Scripts\python.exe" "%APP%backend\pinj_address.py"`) do set "LANIP=%%i"

echo.
echo  ==============================================================
echo    PINJ server on port %PORT%
echo.
echo    This PC:    http://localhost:%PORT%
echo    Other PCs:  http://%LANIP%:%PORT%
echo.
echo    Close this window to stop PINJ.
echo    Below: live activity of every user (also saved in logs\server\).
echo  ==============================================================
echo.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process 'http://localhost:%PORT%'"
cd /d "%APP%backend"
"%VENV%\Scripts\python.exe" -m uvicorn hub:app --host 0.0.0.0 --port %PORT% --no-access-log
echo.
echo  PINJ server stopped.
pause
exit /b 0

:already
echo.
echo  PINJ is already running on port %PORT% - opening it.
start "" "http://localhost:%PORT%"
"%SystemRoot%\System32\timeout.exe" /t 3 >nul
exit /b 0

:nopython
echo.
echo  Python 3.10 or newer is needed:  https://www.python.org/downloads/
echo  (during install tick "Add python.exe to PATH"), then run this again.
pause
exit /b 1

:pipfail
echo.
echo  Could not install the Python packages - check the internet connection, then run this again.
pause
exit /b 1

:nonode
echo.
echo  The PINJ pages are not built yet and Node.js is not installed.
echo  Install Node.js LTS from https://nodejs.org/ once, then run this again.
pause
exit /b 1

:buildfail
echo.
echo  Building the PINJ pages failed - see the messages above.
pause
exit /b 1
