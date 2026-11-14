@echo off
REM STOP_PINJ.bat - stops the PINJ server (port 8080) started by START_PINJ.bat.
REM Does not touch the WSL PINJ (ports 8000/7000).
setlocal
set "PORT=8080"
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if (-not $c) { Write-Host ' PINJ is not running.'; exit 0 }; $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host ' PINJ server stopped.'"
"%SystemRoot%\System32\timeout.exe" /t 3 >nul
