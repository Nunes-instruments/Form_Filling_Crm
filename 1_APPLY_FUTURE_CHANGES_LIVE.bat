@echo off
setlocal EnableExtensions
cd /d "%~dp0"
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permission...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
  exit /b
)
title NUNES - Apply Future Changes Live V6.5.15
cls
echo ============================================================
echo       NUNES - APPLY THIS FOLDER LIVE V6.5.15
echo ============================================================
echo Master folder: %NUNES_ROOT%
echo Main dashboard: http://127.0.0.1:8795
echo Staff/Owner   : http://100.97.196.17:8795
echo.
echo This updates the MAIN SERVER only. Staff/Owner PCs need no ZIP.
echo Persistent Purchasing/Servicing data and local tokens are preserved.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-fixed-main-port.ps1" -Port 8795
if errorlevel 1 goto :FAIL
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 goto :FAIL
echo.
echo ============================================================
echo DONE - LIVE UPDATE APPLIED ON PORT 8795
echo ============================================================
echo Staff/Owner pages will refresh automatically when the rollout detector is loaded.
echo Closed PCs get the latest version next time they open NUNES Operations.
start "" "http://127.0.0.1:8795"
pause
exit /b 0
:FAIL
echo.
echo [ERROR] Live update did not complete. Existing persistent data was not intentionally deleted.
echo Run 2_CHECK_SERVER_8795.bat and review the shown logs.
pause
exit /b 1
