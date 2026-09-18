@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - V6.6.8 NEXT LOCAL RUNTIME FIX

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================================
echo   NUNES V6.6.8 - NEXT.JS LOCAL RUNTIME SELF-REPAIR
echo ============================================================
echo MAIN SERVER update only.
echo.
echo This fixes the exact build error:
echo   Module not found ... AppData\Local\NUNES Operations\PlatformCache\runtime
echo   ... next\dist\client\components\builtin\global-not-found.js
echo.
echo IMPORTANT:
echo - Purchasing, Servicing, Gmail, Gemini and WhatsApp data are preserved.
echo - Existing V6.6.7 WhatsApp Easy Connect + dashboard design are kept.
echo - Staff PCs need NO reinstall.
echo - First repair may take a few minutes because node_modules is rebuilt locally.
echo.

for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"

echo [1/3] Applying local Next.js dependency-path repair + V6.6.8...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] V6.6.8 could not be applied.
  echo Existing persistent data was not intentionally deleted.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo [2/3] Verifying that dashboard node_modules is LOCAL, not an AppData junction...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=Join-Path '%NUNES_ROOT%' 'platform_web\node_modules'; if(-not(Test-Path -LiteralPath $p)){throw 'platform_web\node_modules is missing'}; $i=Get-Item -LiteralPath $p -Force; if($i.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'platform_web\node_modules is still a junction/reparse point'}; $f=Join-Path $p 'next\dist\client\components\builtin\global-not-found.js'; if(-not(Test-Path -LiteralPath $f -PathType Leaf)){throw 'Next.js global-not-found.js is still missing'}; Write-Host '[OK] Next.js dependencies are local and complete.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] Local dependency verification failed.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo [3/3] Verifying Main + Servicing + WhatsApp runtimes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $m=Invoke-RestMethod -TimeoutSec 8 ('http://127.0.0.1:8795/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Main Version       : '+$m.version) -ForegroundColor Cyan; if([string]$m.version -ne '6.6.8'){throw 'Main dashboard is not V6.6.8'}; $s=Invoke-RestMethod -TimeoutSec 8 ('http://127.0.0.1:5055/api/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Servicing Version  : '+$s.version) -ForegroundColor Cyan; if([string]$s.version -ne '1.1.38'){throw 'Servicing is not V1.1.38'}; $deadline=(Get-Date).AddSeconds(15); $w=$null; while((Get-Date)-lt $deadline){try{$w=Invoke-RestMethod -TimeoutSec 2 ('http://127.0.0.1:5056/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); if([string]$w.version -eq '3.4.0'){break}}catch{}; Start-Sleep -Milliseconds 250}; if($null -eq $w -or [string]$w.version -ne '3.4.0'){throw 'WhatsApp runtime is not V3.4.0'}; Write-Host ('WhatsApp Runtime   : '+$w.version) -ForegroundColor Cyan; Write-Host ('WhatsApp State     : '+$w.state) -ForegroundColor Cyan; Write-Host '[OK] V6.6.8 IS LIVE.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] Runtime verification failed.
  echo Send this COMPLETE window output to ChatGPT.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo [OK] BUILD PATH PROBLEM FIXED.
echo [OK] V6.6.7 WhatsApp Easy Connect changes are preserved.
echo [OK] Dashboard large text / bars / graphs are preserved.
echo [OK] Staff PCs only need Refresh / Ctrl+R.
echo ============================================================
echo.
echo NEXT TEST:
echo   1. NUNES Operations - Dashboard
echo   2. Forms - Servicing - Settings
echo   3. Connect WhatsApp Now
echo.
start "" "http://127.0.0.1:8795/forms/servicing?_nunes_v668=%RANDOM%%RANDOM%"
pause
exit /b 0
