@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cls
rem Keep private OAuth credentials outside GitHub/source control.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-local-google-secret.ps1" -Root "%~dp0." -Quiet
if errorlevel 1 goto :FAIL
echo ============================================================
echo       B - MAKE THIS PC THE NUNES MAIN SERVER
echo ============================================================
echo Main dashboard port: 8785  ^(8765 is NOT used^)
echo Servicing: 5055   WhatsApp: 5056   Purchasing: 8770
echo.
rem If an older NUNES dashboard is still on 8765 on THIS PC, stop it only when
rem its own health endpoint identifies it as NUNES. Never touch another project.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=8765;try{$h=Invoke-RestMethod -TimeoutSec 1 ('http://127.0.0.1:'+ $p +'/api/health');if([string]$h.product -eq 'NUNES Company Platform'){$line=netstat -ano -p tcp|Select-String (':'+$p+'\s+.*LISTENING')|Select-Object -First 1;if($line){$id=[int](($line.ToString().Trim()-split '\s+')[-1]);if($id -gt 0){taskkill /PID $id /T /F|Out-Null}}}}catch{}"
echo [1/3] Importing old server data if transfer data is present...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\import-main-server-data.ps1" -Root "%~dp0."
if errorlevel 1 goto :FAIL
echo [2/3] Installing this PC as the always-on main server...
call "%~dp0SETUP_THIS_PC_AS_SERVER.bat"
if errorlevel 1 goto :FAIL
echo [3/3] Opening Mail / WhatsApp connection page on THIS main server...
start "" "http://127.0.0.1:5055/settings"
start "" "http://127.0.0.1:8785"
echo.
echo ============================================================
echo READY - THIS PC IS NOW THE NUNES MAIN SERVER
echo Dashboard: http://127.0.0.1:8785
echo Connections: http://127.0.0.1:5055/settings
echo ============================================================
pause
exit /b 0
:FAIL
echo.
echo ERROR: Main-server setup did not complete.
echo Existing/old data was not intentionally deleted.
pause
exit /b 1
