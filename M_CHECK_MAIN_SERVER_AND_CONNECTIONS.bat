@echo off
setlocal
cls
echo ============================================================
echo       NUNES - MAIN SERVER + CONNECTIONS CHECK V6.5.10
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "$checks=@(@('Dashboard','http://127.0.0.1:8795/api/health'),@('Servicing','http://127.0.0.1:5055/api/health'),@('WhatsApp','http://127.0.0.1:5056/status?init=1')); foreach($c in $checks){$sw=[Diagnostics.Stopwatch]::StartNew();try{$null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $c[1];$sw.Stop();Write-Host ('[OK] '+$c[0]+' - '+$sw.ElapsedMilliseconds+' ms') -ForegroundColor Green}catch{$sw.Stop();Write-Host ('[FAIL] '+$c[0]+' - not responding') -ForegroundColor Red}}"
echo.
echo Port 8795 listener:
netstat -ano | findstr :8795
echo.
echo Scheduled tasks:
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach($n in @('NUNES Company Server','NUNES Company Keepalive','NUNES Servicing Warm','NUNES Servicing Keepalive','NUNES WhatsApp Resident','NUNES WhatsApp Keepalive')){try{$t=Get-ScheduledTask -TaskName $n -ErrorAction Stop; Write-Host ($n+': '+$t.State)}catch{Write-Host ($n+': MISSING') -ForegroundColor Yellow}}"
echo.
pause
