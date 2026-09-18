@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title NUNES - CHECK WHATSAPP FAST V6.6.6
cls
echo ============================================================
echo   NUNES V6.6.6 - WHATSAPP FAST STATUS TEST
 echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$sw=[Diagnostics.Stopwatch]::StartNew(); try{$w=Invoke-RestMethod -TimeoutSec 2 ('http://127.0.0.1:5056/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); $sw.Stop(); Write-Host ('Runtime version : '+$w.version) -ForegroundColor Cyan; Write-Host ('State           : '+$w.state) -ForegroundColor Cyan; Write-Host ('Health response : '+$sw.ElapsedMilliseconds+' ms') -ForegroundColor Cyan; if([string]$w.version -ne '3.3.0'){exit 2}; exit 0}catch{Write-Host ('WhatsApp resident not ready: '+$_.Exception.Message) -ForegroundColor Red; exit 1}"
if errorlevel 1 (
  echo.
  echo Run L_APPLY_WHATSAPP_INSTANT_V6_6_6.bat on the MAIN SERVER first.
) else (
  echo.
  echo [OK] WhatsApp fast resident is active.
)
echo.
pause
