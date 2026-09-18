@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if /I "%~1"=="server" goto SERVER
if /I "%~1"=="owner" goto OWNER
if /I "%~1"=="staff" goto STAFF
if /I "%~1"=="check" goto CHECK

cls
echo ============================================================
echo       NUNES V6.6.0 - ALL IN ONE GITHUB SETUP
echo ============================================================
echo.
echo ONE GitHub source: Nunes-instruments/Form_Filling_Crm / main
echo Main dashboard: 8795   ^(8765 is NEVER used by NUNES^)
echo.
echo Choose THIS computer role:
echo.
echo [1] MAIN SERVER PC  - GitHub source + live server + auto pull
echo [2] OWNER PC        - Desktop icon only, opens main server
echo [3] STAFF PC        - Desktop icon only, opens main server
echo [4] CHECK MAIN SERVER / GITHUB AUTO UPDATE
echo [0] EXIT
echo.
choice /C 12340 /N /M "Select: "
if errorlevel 5 exit /b 0
if errorlevel 4 goto CHECK
if errorlevel 3 goto STAFF
if errorlevel 2 goto OWNER
if errorlevel 1 goto SERVER

:SERVER
fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permission for MAIN SERVER setup...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList 'server' -Verb RunAs"
  exit /b
)
cls
echo ============================================================
echo       MAIN SERVER - GITHUB SINGLE SOURCE SETUP
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-github-main-server.ps1" -Root "%~dp0."
if errorlevel 1 goto FAIL

echo.
echo Do you want to PUSH this current V6.6.0 source to GitHub main now?
echo This may open GitHub sign-in the first time.
choice /C YN /N /M "Push now? [Y/N]: "
if errorlevel 2 goto DONE
call "%~dp01_PUSH_GITHUB_AND_GO_LIVE.bat"
if errorlevel 1 goto FAIL
goto DONE

:OWNER
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-shared-client.ps1" -Role OWNER -ServerUrl "http://100.97.196.17:8795"
if errorlevel 1 goto FAIL
goto DONE

:STAFF
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-shared-client.ps1" -Role STAFF -ServerUrl "http://100.97.196.17:8795"
if errorlevel 1 goto FAIL
goto DONE

:CHECK
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-github-single-source.ps1" -Root "%~dp0."
echo.
pause
exit /b 0

:DONE
echo.
echo ============================================================
echo DONE
echo ============================================================
echo.
pause
exit /b 0

:FAIL
echo.
echo ============================================================
echo SETUP STOPPED - see the error above.
echo Existing NUNES company data was not intentionally deleted.
echo ============================================================
echo.
pause
exit /b 1
