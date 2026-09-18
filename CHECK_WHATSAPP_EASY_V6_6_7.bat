@echo off
setlocal
cd /d "%~dp0"
title NUNES - CHECK WHATSAPP EASY CONNECT V6.6.7
cls
echo ============================================================
echo   NUNES V6.6.7 - WHATSAPP STATUS
 echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $h=Invoke-RestMethod -TimeoutSec 3 ('http://127.0.0.1:5056/health?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); $s=Invoke-RestMethod -TimeoutSec 3 ('http://127.0.0.1:5056/status?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Runtime : '+$h.version); Write-Host ('State   : '+$s.state); Write-Host ('Ready   : '+$s.ready); Write-Host ('Browser : '+$s.loginBrowserOpen); if($s.connectedNumber){Write-Host ('Number  : +'+$s.connectedNumber)}; if($s.lastError){Write-Host ('Detail  : '+$s.lastError) -ForegroundColor Yellow}"
if errorlevel 1 (
  echo.
  echo [ERROR] WhatsApp resident is not responding on 5056.
  echo Run M_APPLY_WHATSAPP_DASHBOARD_V6_6_7.bat as Administrator.
)
echo.
pause
