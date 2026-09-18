@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - GitHub Auto Update Status
cls
echo ============================================================
echo             NUNES GITHUB AUTO UPDATE STATUS
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=Get-ScheduledTask -TaskName 'NUNES GitHub Auto Update' -ErrorAction SilentlyContinue;if($t){Write-Host ('Task: '+$t.State) -ForegroundColor Green}else{Write-Host 'Task: NOT INSTALLED' -ForegroundColor Red};$s=Join-Path $env:LOCALAPPDATA 'NUNES Operations\github-auto-update-status.json';if(Test-Path $s){Write-Host '';Write-Host 'Last check:' -ForegroundColor Cyan;Get-Content -LiteralPath $s}else{Write-Host '';Write-Host 'No watcher status yet.' -ForegroundColor Yellow};$l=Join-Path $env:LOCALAPPDATA 'NUNES Operations\github-auto-update.log';if(Test-Path $l){Write-Host '';Write-Host 'Recent log:' -ForegroundColor Cyan;Get-Content -LiteralPath $l -Tail 12}"
echo.
pause
