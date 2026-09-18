@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - REPAIR CACHE + FORCE LATEST V6.6.2

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================================
echo   NUNES V6.6.2 - REPAIR DASHBOARD CACHE + FORCE LATEST
echo ============================================================
echo Fixes the V6.6.1 error:
echo   Module not found ... Next.js ... builtin/global-not-found.js
echo.
echo Existing Purchasing and Servicing DATA are NOT deleted.
echo Only broken generated dashboard dependency/build caches are repaired.
echo.

for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
del /q "%LOCALAPPDATA%\NUNES Operations\client-server-url.txt" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] V6.6.2 could not be applied. Persistent data was not intentionally deleted.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo [VERIFY] Checking live versions...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $m=Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:8795/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Main Version      : '+$m.version) -ForegroundColor Cyan; Write-Host ('Main Update ID    : '+$m.update_id) -ForegroundColor Cyan; if([string]$m.version -ne '6.6.2'){throw 'Main dashboard is not V6.6.2'}; try{$s=Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:5055/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Servicing Version : '+$s.version) -ForegroundColor Cyan; if([string]$s.version -ne '1.1.36'){Write-Host '[WARNING] Servicing did not report 1.1.36 yet.' -ForegroundColor Yellow}}catch{Write-Host '[WARNING] Servicing health is not ready yet. Main dashboard update is still valid.' -ForegroundColor Yellow}; Write-Host '[OK] MAIN V6.6.2 IS LIVE.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] Verification did not see Main V6.6.2.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create-desktop-shortcut.ps1" -Root "%NUNES_ROOT%" >nul 2>&1

echo.
echo [OK] Broken Next.js cache self-repair is now installed.
echo [OK] Desktop shortcut repaired.
echo [OK] Staff PCs need NO ZIP and NO reinstall.
echo [OK] Staff only Refresh / Ctrl+R after this main-server update.
echo.
start "" "http://127.0.0.1:8795/?_nunes_v662=%RANDOM%%RANDOM%"
pause
exit /b 0
