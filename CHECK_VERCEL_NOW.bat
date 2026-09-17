@echo off
setlocal
title Check NUNES Vercel
set "SITE=https://nunes-operations-workspace.vercel.app"
echo Checking %SITE%
echo.
powershell -NoProfile -Command "try{$h=Invoke-RestMethod -TimeoutSec 8 '%SITE%/api/health'; $h|ConvertTo-Json -Depth 5}catch{Write-Host ('HEALTH ERROR: '+$_.Exception.Message) -ForegroundColor Red}"
echo.
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 '%SITE%/api/data/revision'; Write-Host ('DATA API HTTP '+[int]$r.StatusCode) -ForegroundColor Green; Write-Host $r.Content}catch{if($_.Exception.Response){Write-Host ('DATA API HTTP '+[int]$_.Exception.Response.StatusCode.value__) -ForegroundColor Yellow}else{Write-Host ('DATA ERROR: '+$_.Exception.Message) -ForegroundColor Yellow}}"
echo.
pause
