@echo off
setlocal
pushd "%~dp0"
title Allow ServiceFlow on Office Network
net session >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permission...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  popd
  exit /b
)
netsh advfirewall firewall delete rule name="ServiceFlow Job Cards 5055" >nul 2>&1
netsh advfirewall firewall add rule name="ServiceFlow Job Cards 5055" dir=in action=allow protocol=TCP localport=5055 profile=private
if errorlevel 1 (
  echo Failed to add firewall rule.
) else (
  echo Office-network access enabled for TCP port 5055 on Private networks.
  echo Start the app, then open OFFICE_URL.txt on the server PC.
)
pause
popd
