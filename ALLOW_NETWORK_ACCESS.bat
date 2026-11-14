@echo off
REM ---------------------------------------------------------------------------
REM  ALLOW_NETWORK_ACCESS.bat - run ONCE, as administrator
REM  (right-click > Run as administrator).
REM  Adds a Windows Firewall rule so other PCs on this network can open PINJ
REM  on TCP port 8080. Private and Domain networks only - never Public.
REM ---------------------------------------------------------------------------
net session >nul 2>&1 || (
  echo.
  echo  Please right-click ALLOW_NETWORK_ACCESS.bat and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="PINJ server (TCP 8080)" >nul 2>&1
netsh advfirewall firewall add rule name="PINJ server (TCP 8080)" dir=in action=allow protocol=TCP localport=8080 profile=private,domain
echo.
echo  Done - other PCs on this network can now open PINJ on port 8080.
echo  If this PC's network is set to "Public", switch it to "Private" in
echo  Windows Settings ^> Network ^& internet ^> (your Wi-Fi) ^> Network profile type.
echo.
pause
