@echo off
REM STOP_PINJ.bat - stops the PINJ server (port 8080) started by START_PINJ.bat.
REM When PINJ runs as the always-on service (PINJ_SERVICE.bat), use PINJ_SERVICE.bat stop instead.
REM Does not touch the WSL PINJ (ports 8000/7000).
setlocal
set "PORT=8080"
schtasks /Query /TN "PINJ Server" >nul 2>&1 && (
  echo.
  echo  PINJ runs as the always-on service on this PC, so it would start again by itself.
  echo  To stop it for maintenance, open Command Prompt as administrator, go to the PINJ folder and run:
  echo      PINJ_SERVICE.bat stop
  echo.
  pause
  exit /b 0
)
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if (-not $c) { Write-Host ' PINJ is not running.'; exit 0 }; $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host ' PINJ server stopped.'"
"%SystemRoot%\System32\timeout.exe" /t 3 >nul
