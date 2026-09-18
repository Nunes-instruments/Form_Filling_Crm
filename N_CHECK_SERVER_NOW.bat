@echo off
setlocal EnableExtensions
cd /d "%~dp0"
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
title NUNES - Server Status
cls
echo ============================================================
echo             NUNES MAIN SERVER STATUS V6.5.15
echo ============================================================
echo Current folder: %NUNES_ROOT%
echo.
echo [1] Port 8795
netstat -ano | findstr ":8795"
echo.
echo [2] Dashboard health
powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:8795/api/health';$r|ConvertTo-Json -Compress}catch{Write-Host ('NOT READY: '+$_.Exception.Message) -ForegroundColor Red}"
echo.
echo [3] Prepared root / resident / tasks
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\test-main-server-installation.ps1" -Root "%NUNES_ROOT%"
echo.
echo [4] Saved master root
powershell -NoProfile -Command "$p=Join-Path $env:LOCALAPPDATA 'NUNES Operations\workspace-root.txt';if(Test-Path $p){Get-Content $p}else{Write-Host 'workspace-root.txt missing'}"
echo.
echo [5] Recent launcher/startup logs
powershell -NoProfile -Command "$d=Join-Path $env:LOCALAPPDATA 'NUNES Operations';foreach($p in @((Join-Path $d 'desktop-launcher.log'),(Join-Path '%NUNES_ROOT%' 'server-startup.log'),(Join-Path $d 'dashboard-stderr.log'))){if(Test-Path $p){Write-Host ('--- '+$p+' ---');Get-Content $p -Tail 15}}"
echo.
pause
