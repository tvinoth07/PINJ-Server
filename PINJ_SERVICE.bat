@echo off
REM ---------------------------------------------------------------------------
REM  PINJ_SERVICE.bat - keeps PINJ running ALL THE TIME on this PC.
REM
REM    PINJ_SERVICE.bat install   (as administrator) start PINJ at every power-on,
REM                               before anyone signs in, and restart it within
REM                               5 seconds if it ever stops. Starts it now too.
REM    PINJ_SERVICE.bat stop      (as administrator) stop it for maintenance
REM    PINJ_SERVICE.bat start     (as administrator) start it again
REM    PINJ_SERVICE.bat status    is it installed / running?
REM    PINJ_SERVICE.bat remove    (as administrator) back to manual START_PINJ.bat
REM
REM  It runs in the background as a Windows task (no window that can be closed
REM  by mistake). See the live activity and type commands with PINJ_MONITOR.bat.
REM  Errors go to logs\server\service.log; activity to logs\server\pinj_activity_*.log
REM ---------------------------------------------------------------------------
setlocal
set "APP=%~dp0"
set "APP=%APP:~0,-1%"
set "VENV=%APP%\.venv"
set "PORT=8080"
set "TASK=PINJ Server"
set "STOPFLAG=%APP%\data\service.stop"
REM test overrides (never needed in normal use)
if defined PINJ_SERVICE_PORT set "PORT=%PINJ_SERVICE_PORT%"
if defined PINJ_SERVICE_VENV set "VENV=%PINJ_SERVICE_VENV%"

if /i "%~1"=="run"     goto :run
if /i "%~1"=="install" goto :install
if /i "%~1"=="stop"    goto :stop
if /i "%~1"=="start"   goto :start
if /i "%~1"=="status"  goto :status
if /i "%~1"=="remove"  goto :remove
echo.
echo  Usage: PINJ_SERVICE.bat install ^| stop ^| start ^| status ^| remove
echo.
pause
exit /b 1

REM -- the loop the Windows task runs -----------------------------------------
:run
set "PINJ_PORT=%PORT%"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
if not exist "%APP%\logs\server" mkdir "%APP%\logs\server"
set "SLOG=%APP%\logs\server\service.log"
cd /d "%APP%\backend"
:again
if exist "%STOPFLAG%" exit /b 0
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  REM someone started PINJ by hand (START_PINJ.bat) - wait, then check again
  powershell -NoProfile -Command "Start-Sleep 15"
  goto :again
)
echo [%date% %time%] PINJ starting>> "%SLOG%"
"%VENV%\Scripts\python.exe" -m uvicorn hub:app --host 0.0.0.0 --port %PORT% --no-access-log >nul 2>> "%SLOG%"
echo [%date% %time%] PINJ stopped (exit code %errorlevel%) - restarting in 5 s unless stopped on purpose>> "%SLOG%"
powershell -NoProfile -Command "Start-Sleep 5"
goto :again

REM -- install --------------------------------------------------------------
:install
call :needadmin || exit /b 1
if not exist "%VENV%\Scripts\python.exe" (
  echo  PINJ is not prepared on this PC yet - run INSTALL_SERVER.bat first.
  pause
  exit /b 1
)
if exist "%STOPFLAG%" del "%STOPFLAG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP%\backend\service_task.ps1" -App "%APP%" -TaskName "%TASK%" -Port %PORT% || goto :fail
call :stopmanual
schtasks /Run /TN "%TASK%" >nul
echo.
echo  PINJ now starts at every power-on and restarts itself if it stops.
echo  It is starting now (about 10 seconds). Open http://localhost:%PORT%
echo  Live activity and commands: PINJ_MONITOR.bat
echo.
pause
exit /b 0

REM -- stop / start / status / remove -----------------------------------------
:stop
call :needadmin || exit /b 1
if not exist "%APP%\data" mkdir "%APP%\data"
echo stopped on purpose > "%STOPFLAG%"
schtasks /End /TN "%TASK%" >nul 2>&1
call :stopmanual
echo.
echo  PINJ is stopped and stays stopped until:  PINJ_SERVICE.bat start
echo  (or until this PC is restarted - then it starts again by itself).
echo.
pause
exit /b 0

:start
call :needadmin || exit /b 1
if exist "%STOPFLAG%" del "%STOPFLAG%"
schtasks /Run /TN "%TASK%" >nul 2>&1 || (echo  The PINJ service is not installed - run: PINJ_SERVICE.bat install & pause & exit /b 1)
echo.
echo  PINJ is starting (about 10 seconds): http://localhost:%PORT%
echo.
pause
exit /b 0

:status
schtasks /Query /TN "%TASK%" >nul 2>&1 && (echo  Service : installed - PINJ starts at power-on) || echo  Service : not installed - PINJ runs only when START_PINJ.bat is open
if exist "%STOPFLAG%" echo  Note    : stopped on purpose - run  PINJ_SERVICE.bat start
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { ' Server  : RUNNING on port %PORT%' } else { ' Server  : not running' }"
echo.
pause
exit /b 0

:remove
call :needadmin || exit /b 1
echo stopped on purpose > "%STOPFLAG%"
schtasks /End /TN "%TASK%" >nul 2>&1
schtasks /Delete /TN "%TASK%" /F >nul 2>&1
call :stopmanual
del "%STOPFLAG%" >nul 2>&1
echo.
echo  The PINJ service is removed. Start PINJ by hand with START_PINJ.bat from now on.
echo.
pause
exit /b 0

REM -- helpers --------------------------------------------------------------
:stopmanual
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
exit /b 0

:needadmin
net session >nul 2>&1 && exit /b 0
echo.
echo  This needs administrator rights. Open Command Prompt with "Run as administrator",
echo  go to the PINJ folder and run the same command again, e.g.:  PINJ_SERVICE.bat stop
echo.
pause
exit /b 1

:fail
echo.
echo  Could not create the Windows task - see the message above.
pause
exit /b 1
