@echo off
REM ---------------------------------------------------------------------------
REM  MOVE_TO_NEW_PC.bat - run on THIS PC to copy PINJ to a pen drive (or any folder)
REM  for another PC.  Usage:  MOVE_TO_NEW_PC.bat  [destination folder, e.g. E:\PINJ]
REM
REM  Copies : the program, the built pages (frontend\dist), git history, logs,
REM           everyone's My Files, the accounts (exported to data\pinj_users.sqlite)
REM           and the PINJ LIBRARY input files (into library\).
REM  Leaves : .venv and node_modules (made fresh on the new PC), the bench folders,
REM           and backend\pinj_db.json (this PC's MySQL password - it would not work there).
REM  Nothing on this PC is changed. Then run INSTALL_SERVER.bat on the new PC.
REM ---------------------------------------------------------------------------
setlocal
set "APP=%~dp0"
set "APP=%APP:~0,-1%"
set "VENV=%APP%\.venv"
title PINJ - copy to a new PC

set "DEST=%~1"
if "%DEST%"=="" set /p "DEST= Copy PINJ to which folder? (for example E:\PINJ): "
if "%DEST%"=="" exit /b 1
if exist "%DEST%\backend\hub.py" (
  echo.
  echo  %DEST% already holds a PINJ copy. Choose an empty folder.
  pause
  exit /b 1
)
if not exist "%VENV%\Scripts\python.exe" (
  echo  Run START_PINJ.bat once on this PC first, then run this again.
  pause
  exit /b 1
)

echo.
echo  Copying PINJ to %DEST% ...
robocopy "%APP%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XD "%APP%\.venv" "%APP%\frontend\node_modules" "%APP%\data" __pycache__ /XF pinj_db.json *.pyc
if errorlevel 8 goto :copyfail
if exist "%APP%\data\user_files" robocopy "%APP%\data\user_files" "%DEST%\data\user_files" /E /NFL /NDL /NJH /NJS /NP
if exist "%APP%\data\console_settings.json" copy /y "%APP%\data\console_settings.json" "%DEST%\data\" >nul

echo  Exporting the accounts and copying the PINJ LIBRARY files ...
cd /d "%APP%\backend"
"%VENV%\Scripts\python.exe" move_helper.py export "%DEST%" || goto :exportfail

echo.
echo  ==============================================================
echo    Done. PINJ is copied to %DEST%
echo.
echo    On the new PC:
echo     1. Copy the folder to a fixed place, e.g. C:\PINJ
echo     2. Right-click INSTALL_SERVER.bat - Run as administrator
echo  ==============================================================
echo.
pause
exit /b 0

:copyfail
echo.
echo  Copying failed - check that the pen drive is plugged in and has space.
pause
exit /b 1

:exportfail
echo.
echo  The program files were copied, but exporting the accounts or the library failed (see above).
pause
exit /b 1
