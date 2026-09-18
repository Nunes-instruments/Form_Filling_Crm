@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Fix Staff Tailscale Access
cls

echo ============================================================
echo       NUNES STAFF ACCESS - TAILSCALE FIREWALL FIX
echo ============================================================
echo Run this ONLY on the MAIN SERVER PC.
echo This does not change forms, data, Gmail, WhatsApp or port 8765.
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permission...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "PORTS=5055 5056 8770 8795"
echo [1/3] Updating Windows Firewall for LAN + Tailscale...
for %%P in (%PORTS%) do (
  netsh advfirewall firewall delete rule name="NUNES Operations TCP %%P" >nul 2>&1
  netsh advfirewall firewall add rule name="NUNES Operations TCP %%P" dir=in action=allow protocol=TCP localport=%%P profile=any remoteip=localsubnet,100.64.0.0/10 >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Could not create firewall rule for TCP %%P.
    echo Please keep this window open and send a screenshot.
    pause
    exit /b 1
  )
)

echo [2/3] Checking NUNES dashboard on this server...
powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 5 'http://127.0.0.1:8795/api/health';if($r.ok -eq $true -and [string]$r.product -eq 'NUNES Company Platform'){exit 0}}catch{};exit 1" >nul 2>&1
if errorlevel 1 (
  echo [WARNING] Firewall is fixed, but dashboard is not currently answering on 8795.
  echo Start NUNES on this MAIN SERVER PC, then run this file once more.
  pause
  exit /b 2
)

echo [3/3] Ready.
echo.
echo MAIN SERVER: http://100.97.196.17:8795
echo.
echo Now go to the STAFF PC and run:
echo   3_CONNECT_THIS_PC_TO_SHARED_SERVER.bat
echo Enter:
echo   http://100.97.196.17:8795
echo.
echo IMPORTANT: The STAFF PC must be connected to the same Tailscale network.
pause
exit /b 0
