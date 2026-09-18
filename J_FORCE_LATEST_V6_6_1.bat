@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - FORCE LATEST V6.6.1

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================================
echo     NUNES V6.6.1 - FORCE LATEST MAIN + SERVICING RUNTIME
echo ============================================================
echo This repairs the exact problem where the Desktop icon could keep
echo opening an older cached Servicing build after source code changed.
echo Existing Purchasing and Servicing data are NOT deleted.
echo.

for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"

rem This PC is the main server. Remove any accidental client-only pointer.
del /q "%LOCALAPPDATA%\NUNES Operations\client-server-url.txt" >nul 2>&1

rem Apply the complete current source. This backs up persistent data first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] V6.6.1 could not be applied. Data was not intentionally deleted.
  pause
  exit /b 1
)

echo.
echo [VERIFY] Checking exact live versions...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $m=Invoke-RestMethod -TimeoutSec 4 ('http://127.0.0.1:8795/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); $s=Invoke-RestMethod -TimeoutSec 4 ('http://127.0.0.1:5055/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Main Version      : '+$m.version) -ForegroundColor Cyan; Write-Host ('Main Update ID    : '+$m.update_id) -ForegroundColor Cyan; Write-Host ('Servicing Version : '+$s.version) -ForegroundColor Cyan; Write-Host ('Service Signature : '+$s.source_signature) -ForegroundColor DarkCyan; if([string]$m.version -ne '6.6.1'){throw 'Main dashboard is not V6.6.1'}; if([string]$s.version -ne '1.1.36'){throw 'Servicing is not V1.1.36'}; Write-Host '[OK] EXACT LATEST VERSION IS LIVE.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] The verification did not see the new version.
  echo Send this complete window output to ChatGPT.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create-desktop-shortcut.ps1" -Root "%NUNES_ROOT%" >nul

echo.
echo [OK] Desktop shortcut repaired.
echo [OK] Staff PCs need NO ZIP and NO reinstall.
echo [OK] Staff only Refresh / Ctrl+R after this main-server update.
echo.
start "" "http://127.0.0.1:8795/?_nunes_v661=%RANDOM%%RANDOM%"
pause
exit /b 0
