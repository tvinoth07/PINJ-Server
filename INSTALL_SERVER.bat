@echo off
REM ---------------------------------------------------------------------------
REM  INSTALL_SERVER.bat - run ONCE on the PC that will be the PINJ server.
REM  Right-click > Run as administrator.  Internet is needed once (Python packages).
REM
REM    1. checks Python 3.10+ (offers to install Python 3.12 with winget)
REM    2. makes the Python environment (.venv) and installs the packages
REM    3. checks the built pages (frontend\dist) - builds them if Node.js is there
REM    4. opens TCP 8080 in Windows Firewall (Private / Domain networks)
REM    5. points the PINJ LIBRARY at the library\ folder copied with PINJ
REM    6. keeps the PC awake on mains power (asks)
REM    7. accounts in MySQL, if MySQL is installed (asks)
REM    8. ALWAYS ON: PINJ starts at every power-on and restarts itself (asks)
REM ---------------------------------------------------------------------------
setlocal
set "APP=%~dp0"
set "APP=%APP:~0,-1%"
set "VENV=%APP%\.venv"
set "PORT=8080"
title PINJ - install on this PC
cd /d "%APP%"

net session >nul 2>&1 || (
  echo.
  echo  Please right-click INSTALL_SERVER.bat and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
echo.
echo  ==============================================================
echo    PINJ server - installation on %COMPUTERNAME%
echo    Folder: %APP%
echo  ==============================================================

REM -- 1. Python -------------------------------------------------------------
echo.
echo  [1/8] Python
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=py -3"
if not defined PY (
  for %%P in ("%ProgramFiles%\Python314\python.exe" "%ProgramFiles%\Python313\python.exe" "%ProgramFiles%\Python312\python.exe" "%ProgramFiles%\Python311\python.exe" "%ProgramFiles%\Python310\python.exe") do (
    if not defined PY if exist %%P set "PY=%%~P"
  )
)
if not defined PY (
  echo        Python 3.10 or newer is not installed.
  where winget >nul 2>&1 || goto :nopython
  choice /c YN /m "       Install Python 3.12 now (from Microsoft winget)"
  if errorlevel 2 goto :nopython
  winget install -e --id Python.Python.3.12 --scope machine --accept-package-agreements --accept-source-agreements
  if exist "%ProgramFiles%\Python312\python.exe" set "PY=%ProgramFiles%\Python312\python.exe"
)
if not defined PY goto :nopython
echo        using: %PY%

REM -- 2. environment + packages ---------------------------------------------
echo.
echo  [2/8] Python environment and packages
if not exist "%VENV%\Scripts\python.exe" (
  if "%PY%"=="py -3" (py -3 -m venv "%VENV%") else ("%PY%" -m venv "%VENV%")
)
if not exist "%VENV%\Scripts\python.exe" goto :venvfail
"%VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "%APP%\backend\requirements-windows.txt" || goto :pipfail
echo        packages installed

REM -- 3. pages --------------------------------------------------------------
echo.
echo  [3/8] Web pages
if exist "%APP%\frontend\dist\index.html" (
  echo        built pages found
) else (
  where npm >nul 2>&1 || goto :nonode
  pushd "%APP%\frontend"
  call npm install --no-audit --no-fund || (popd & goto :buildfail)
  call npm run build || (popd & goto :buildfail)
  popd
)

REM -- 4. firewall -----------------------------------------------------------
echo.
echo  [4/8] Firewall
netsh advfirewall firewall delete rule name="PINJ server (TCP %PORT%)" >nul 2>&1
netsh advfirewall firewall add rule name="PINJ server (TCP %PORT%)" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain >nul
echo        TCP %PORT% open for Private and Domain networks

REM -- 5. library ------------------------------------------------------------
echo.
echo  [5/8] PINJ LIBRARY input files
"%VENV%\Scripts\python.exe" "%APP%\backend\move_helper.py" setlib

REM -- 6. power --------------------------------------------------------------
echo.
echo  [6/8] Power
choice /c YN /m "       Keep this PC awake on mains power (never sleep / hibernate)"
if not errorlevel 2 (
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  echo        sleep and hibernate turned off on mains power
)

REM -- 7. MySQL --------------------------------------------------------------
echo.
echo  [7/8] Accounts database
set "MYSQL="
for /d %%D in ("%ProgramFiles%\MySQL\MySQL Server*") do if exist "%%D\bin\mysql.exe" set "MYSQL=%%D\bin\mysql.exe"
if exist "%APP%\backend\pinj_db.json" (
  echo        MySQL is already set up for PINJ
) else if defined MYSQL (
  echo        MySQL found: %MYSQL%
  choice /c YN /m "       Keep the PINJ accounts in MySQL (you will type the MySQL root password)"
  if not errorlevel 2 "%VENV%\Scripts\python.exe" "%APP%\backend\setup_database.py"
) else (
  echo        MySQL is not installed - PINJ keeps the accounts in data\pinj_users.sqlite
  echo        ^(fine; to move them into MySQL later, install MySQL 8 and run SETUP_DATABASE.bat^)
)

REM -- 8. always on ----------------------------------------------------------
echo.
echo  [8/8] Always on
choice /c YN /m "       Start PINJ at every power-on and restart it automatically if it stops"
if not errorlevel 2 (
  call "%APP%\PINJ_SERVICE.bat" install
) else (
  echo        Not installed - start PINJ by hand with START_PINJ.bat
)

for /f "usebackq delims=" %%i in (`call "%VENV%\Scripts\python.exe" "%APP%\backend\pinj_address.py"`) do set "LANIP=%%i"
echo.
echo  ==============================================================
echo    PINJ is installed on %COMPUTERNAME%.
echo.
echo    This PC:    http://localhost:%PORT%
echo    Other PCs:  http://%LANIP%:%PORT%   or  http://%COMPUTERNAME%:%PORT%
echo.
echo    Live activity and commands:  PINJ_MONITOR.bat
echo    Stop / start for maintenance (as administrator):
echo        PINJ_SERVICE.bat stop      PINJ_SERVICE.bat start
echo.
echo    Ask IT for a fixed IP address for this PC, and set its network
echo    profile to Private (Settings ^> Network ^& internet).
echo  ==============================================================
echo.
pause
exit /b 0

:nopython
echo.
echo  Install Python 3.12 from https://www.python.org/downloads/windows/
echo  (tick "Add python.exe to PATH"), then run INSTALL_SERVER.bat again.
pause
exit /b 1

:venvfail
echo.
echo  Could not create the Python environment in %VENV%.
pause
exit /b 1

:pipfail
echo.
echo  Could not install the Python packages - check the internet connection and run this again.
pause
exit /b 1

:nonode
echo.
echo  The web pages are not built (frontend\dist is missing) and Node.js is not installed.
echo  Copy PINJ with MOVE_TO_NEW_PC.bat (it brings the built pages), or install Node.js LTS
echo  from https://nodejs.org/ and run this again.
pause
exit /b 1

:buildfail
echo.
echo  Building the web pages failed - see the messages above.
pause
exit /b 1
