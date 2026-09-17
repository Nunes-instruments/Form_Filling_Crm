@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permission once for office-network access...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  popd
  exit /b
)
echo ============================================================
echo        NUNES - ENABLE OTHER DEVICES
 echo ============================================================
echo.
echo Adding Windows Firewall rules on Private networks...
for %%P in (8785 8786 8787 8788 8789 8790 8791 8792 8793 8794 8795 8770 5055 5056) do (
  netsh advfirewall firewall delete rule name="NUNES Company Port %%P" >nul 2>&1
  netsh advfirewall firewall add rule name="NUNES Company Port %%P" dir=in action=allow protocol=TCP localport=%%P profile=private >nul 2>&1
)
set "LANIP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\tools\get-lan-ip.ps1"`) do if not defined LANIP set "LANIP=%%I"
echo.
echo Enabled. Keep the Windows network profile set to Private.
echo Server IP: !LANIP!
echo.
echo Start NUNES, then use the exact URL written in OPEN_ON_OTHER_DEVICES.txt.
echo Phones, tablets, laptops and other PCs only need a browser.
pause
popd
