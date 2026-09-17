@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "PORT="
for %%Q in (8785 8786 8787 8788 8789 8790 8791 8792 8793 8794 8795) do (
  if not defined PORT (
    powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 1 http://127.0.0.1:%%Q/api/health;if($r.ok -eq $true -and [string]$r.product -eq 'NUNES Company Platform'){exit 0}}catch{};exit 1" >nul 2>&1
    if not errorlevel 1 set "PORT=%%Q"
  )
)
if not defined PORT (
  echo NUNES server is not running. Starting it now...
  start "NUNES Server" /min "%~dp0START_SERVER_AUTOMATIC.bat"
  timeout /t 8 /nobreak >nul
  call "%~f0"
  exit /b
)
start "" "http://127.0.0.1:!PORT!"
if exist "%~dp0OPEN_ON_OTHER_DEVICES.txt" start "" notepad.exe "%~dp0OPEN_ON_OTHER_DEVICES.txt"
