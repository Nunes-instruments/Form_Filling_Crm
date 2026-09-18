@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cls
echo ============================================================
echo       REPAIR SERVICING FORM + CONNECTIONS ONLY
echo ============================================================
echo Existing NUNES business data will be kept.
echo Dashboard: 8795   Servicing: 5055   WhatsApp: 5056
echo Port 8765 is not used by this NUNES setup.
echo.
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configure-office-server.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 goto :FAIL
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8795/forms/servicing"
start "" "http://127.0.0.1:5055/settings"
echo.
echo ============================================================
echo REPAIR COMPLETE
ECHO Servicing form and Connections page are opening now.
echo ============================================================
pause
exit /b 0
:FAIL
echo.
echo ERROR: Repair did not complete.
echo Existing business data was not intentionally deleted.
pause
exit /b 1
