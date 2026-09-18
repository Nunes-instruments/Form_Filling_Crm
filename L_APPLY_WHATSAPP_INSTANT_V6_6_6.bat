@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - WHATSAPP INSTANT OPEN V6.6.6

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================================
echo   NUNES V6.6.6 - WHATSAPP INSTANT OPEN / FAST REDIRECT
echo ============================================================
echo This updates the MAIN SERVER only.
echo Existing Purchasing, Servicing, Gmail, Gemini and WhatsApp data are preserved.
echo Staff PCs need NO reinstall.
echo.

for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] V6.6.6 could not be applied. Existing persistent data was not intentionally deleted.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo [VERIFY] Checking live Main + Servicing + WhatsApp runtimes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $m=Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:8795/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Main Version       : '+$m.version) -ForegroundColor Cyan; if([string]$m.version -ne '6.6.6'){throw 'Main dashboard is not V6.6.6'}; $s=Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:5055/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Servicing Version  : '+$s.version) -ForegroundColor Cyan; if([string]$s.version -ne '1.1.37'){throw 'Servicing is not V1.1.37'}; $w=Invoke-RestMethod -TimeoutSec 3 ('http://127.0.0.1:5056/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('WhatsApp Runtime   : '+$w.version) -ForegroundColor Cyan; Write-Host ('WhatsApp State     : '+$w.state) -ForegroundColor Cyan; if([string]$w.version -ne '3.3.0'){throw 'WhatsApp runtime is not 3.3.0'}; Write-Host '[OK] WHATSAPP FAST OPEN ENGINE IS LIVE.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] Verification did not see the V6.6.6 WhatsApp fast runtime.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo [OK] WhatsApp button now acknowledges immediately.
echo [OK] Cold resident start is retried automatically in background.
echo [OK] Login / reconnect status refreshes much faster.
echo [OK] Staff PCs only need Refresh / Ctrl+R.
echo.
start "" "http://127.0.0.1:8795/forms/servicing?_nunes_v666=%RANDOM%%RANDOM%"
pause
exit /b 0
