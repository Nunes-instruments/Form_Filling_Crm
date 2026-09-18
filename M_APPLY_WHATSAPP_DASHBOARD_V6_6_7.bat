@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - V6.6.7 WHATSAPP EASY CONNECT + DASHBOARD

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================================
echo   NUNES V6.6.7 - WHATSAPP EASY CONNECT + SIMPLE DASHBOARD
echo ============================================================
echo MAIN SERVER update only.
echo Existing Purchasing, Servicing, Gmail, Gemini and WhatsApp data are preserved.
echo Staff PCs need NO reinstall.
echo.

for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] V6.6.7 could not be applied.
  echo Existing persistent data was not intentionally deleted.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo [VERIFY] Checking Main + Servicing + WhatsApp runtimes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $m=Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:8795/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Main Version       : '+$m.version) -ForegroundColor Cyan; if([string]$m.version -ne '6.6.7'){throw 'Main dashboard is not V6.6.7'}; $s=Invoke-RestMethod -TimeoutSec 5 ('http://127.0.0.1:5055/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Servicing Version  : '+$s.version) -ForegroundColor Cyan; if([string]$s.version -ne '1.1.38'){throw 'Servicing is not V1.1.38'}; $deadline=(Get-Date).AddSeconds(12); $w=$null; while((Get-Date)-lt $deadline){try{$w=Invoke-RestMethod -TimeoutSec 2 ('http://127.0.0.1:5056/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); if([string]$w.version -eq '3.4.0'){break}}catch{}; Start-Sleep -Milliseconds 250}; if($null -eq $w -or [string]$w.version -ne '3.4.0'){throw 'WhatsApp runtime is not V3.4.0'}; Write-Host ('WhatsApp Runtime   : '+$w.version) -ForegroundColor Cyan; Write-Host ('WhatsApp State     : '+$w.state) -ForegroundColor Cyan; Write-Host '[OK] V6.6.7 IS LIVE.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] Verification failed.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo [OK] WhatsApp Connect button now switches away from a slow hidden restore immediately.
echo [OK] Saved-session restore no longer blocks the visible login window for a long time.
echo [OK] WhatsApp status text is simpler: Connecting / Opening / Connected.
echo [OK] Dashboard keeps the same data and functions, with larger text and clearer bars/graphs.
echo [OK] Staff PCs only need Refresh / Ctrl+R after the server update.
echo.
echo NEXT: Open Servicing - Settings - Connect WhatsApp Now.
echo.
start "" "http://127.0.0.1:8795/forms/servicing?_nunes_v667=%RANDOM%%RANDOM%"
pause
exit /b 0
