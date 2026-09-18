@echo off
setlocal EnableExtensions
set "NUNES_NO_BROWSER=1"
rem V2.4 STABILITY: the watchdog must never run the heavy/version-sensitive startup
rem while the prepared resident is healthy. The resident launcher only starts a
rem missing service and returns immediately when 8795 + the Data API are healthy.
start "" /b cmd /d /c "call ""%~dp0tools\EARLY_START_SERVICING.bat""" >nul 2>&1
set "RESIDENT=%LOCALAPPDATA%\NUNES Operations\CompanyResident\start-company-resident.ps1"
if exist "%RESIDENT%" (
  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%RESIDENT%" >nul 2>&1
  exit /b %errorlevel%
)
call "%~dp0START_SERVER_AUTOMATIC.bat" >nul 2>&1
exit /b %errorlevel%