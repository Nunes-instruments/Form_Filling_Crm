@echo off
setlocal EnableDelayedExpansion
title Check NUNES Other Device Access
cd /d "%~dp0"
cls
echo ============================================================
echo             CHECK OTHER DEVICE ACCESS
echo ============================================================
set "PORT="
for %%Q in (8795) do (
  if not defined PORT (
    powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 1 http://127.0.0.1:%%Q/api/health;if($r.ok -eq $true -and [string]$r.version -eq '6.5.0'){exit 0}}catch{};exit 1" >nul 2>&1
    if not errorlevel 1 set "PORT=%%Q"
  )
)
if not defined PORT (
  echo [NOT READY] NUNES V6.5.0 is not running.
  echo Run SETUP_THIS_PC_AS_SERVER.bat first.
  pause
  exit /b 1
)
set "LISTEN_OK="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /R /C:"0.0.0.0:!PORT! .*LISTENING" /C:"\[::\]:!PORT! .*LISTENING"') do set "LISTEN_OK=YES"
if not defined LISTEN_OK (
  echo [PROBLEM] The dashboard is not listening for other devices.
  echo Restart it with START_NUNES_COMPANY.bat.
  pause
  exit /b 1
)
set "LANIP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\get-lan-ip.ps1"`) do if not defined LANIP set "LANIP=%%I"
echo [READY] Server is listening for office devices.
echo.
echo This PC     : http://127.0.0.1:!PORT!
echo Other device: http://!LANIP!:!PORT!
echo PC-name link: http://%COMPUTERNAME%:!PORT!
echo.
echo Test the Other device link from a phone connected to the same Wi-Fi.
pause
