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

title NUNES - Repair, Rebind and Fast Start V6.5.15
cls
echo ============================================================
echo    NUNES - REPAIR + STABLE FAST START MAIN SERVER V6.5.15
echo ============================================================
echo Master folder: %NUNES_ROOT%
echo.
echo This file is for FIRST SETUP, after moving/replacing the master folder,
echo or when the Desktop shortcut cannot restore the server.
echo Daily use remains: Desktop - NUNES Operations
echo.

echo [PORT] Confirming fixed main port 8795 is safe to use...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-fixed-main-port.ps1" -Port 8795
if errorlevel 1 goto :FAIL
echo.

echo [1/5] Checking whether THIS exact folder is already prepared...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\test-main-server-installation.ps1" -Root "%NUNES_ROOT%" -Quiet
if errorlevel 1 goto :FULL_REPAIR

echo [OK] Resident/tasks are already bound to this folder.
echo [2/5] Restoring the prepared server without rebuild...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-main-server-ready.ps1" -Root "%NUNES_ROOT%" -TimeoutSeconds 20
if errorlevel 1 goto :FULL_REPAIR

goto :VERIFY

:FULL_REPAIR
echo.
echo [REPAIR] This folder is new, moved, or its prepared runtime is stale.
echo [REPAIR] Rebinding server/tasks/shortcut to THIS exact folder now.
echo [REPAIR] Existing Purchasing, Servicing, Gmail and WhatsApp data are preserved.
echo [REPAIR] The first repair may take several minutes if a build must be prepared.
echo.

echo [2/5] Preserving Google/Gmail credential location...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-local-google-secret.ps1" -Root "%NUNES_ROOT%" -Quiet
if errorlevel 1 goto :FAIL

echo [3/5] Preparing always-on dashboard, Servicing, WhatsApp, firewall and tasks...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configure-office-server.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 goto :FAIL

echo [4/5] Starting the newly prepared main server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-main-server-ready.ps1" -Root "%NUNES_ROOT%" -TimeoutSeconds 90
if errorlevel 1 goto :FAIL

:VERIFY
echo [5/5] Final health check...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\test-main-server-installation.ps1" -Root "%NUNES_ROOT%" -RequireHealth
if errorlevel 1 goto :FAIL

echo.
echo ============================================================
echo DONE - NUNES MAIN SERVER IS READY AND BOUND TO THIS FOLDER
echo ============================================================
echo Main dashboard : http://127.0.0.1:8795
echo Staff/Owner    : http://100.97.196.17:8795
echo Servicing      : http://127.0.0.1:5055
echo WhatsApp       : http://127.0.0.1:5056
echo Port 8765      : NOT USED
echo.
echo NEXT DAILY USE: double-click Desktop - NUNES Operations
echo.
start "" "http://127.0.0.1:8795"
pause
exit /b 0

:FAIL
echo.
echo ============================================================
echo ERROR - MAIN SERVER REPAIR DID NOT COMPLETE
echo ============================================================
echo Existing company data was NOT intentionally deleted.
echo.
echo Run N_CHECK_SERVER_NOW.bat for exact status and recent logs.
echo Desktop launcher log:
echo   %%LOCALAPPDATA%%\NUNES Operations\desktop-launcher.log
echo Startup log:
echo   %NUNES_ROOT%\server-startup.log
echo.
pause
exit /b 1
