@echo off
setlocal
cls
echo ============================================================
echo              NUNES WHATSAPP STATUS CHECK
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; try{$s=Invoke-RestMethod -TimeoutSec 3 'http://127.0.0.1:5056/status?init=1'; Write-Host ('State            : '+$s.state); Write-Host ('Ready            : '+$s.ready); Write-Host ('Login mode       : '+$s.loginMode); Write-Host ('Login window open: '+$s.loginBrowserOpen); Write-Host ('Connected number : '+$s.connectedNumber); Write-Host ('Runtime          : '+$s.engine+' '+$s.version); Write-Host ('Last error       : '+$s.lastError)}catch{Write-Host 'WhatsApp resident is not responding.' -ForegroundColor Red; Write-Host $_.Exception.Message}"
echo.
pause
