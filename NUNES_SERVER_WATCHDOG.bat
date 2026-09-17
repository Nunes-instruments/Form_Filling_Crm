@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "NUNES_NO_BROWSER=1"

rem SPEED-ONLY: keep Servicing hot independently of the dashboard/data API.
rem Start/check it FIRST so a dashboard recovery can never delay the service form.
start "" /b cmd /d /c "call ""%~dp0tools\EARLY_START_SERVICING.bat""" >nul 2>&1

rem Use the same mutex-protected launcher as the scheduled server. If another
rem startup/build is already active this exits immediately instead of starting a
rem second npm/Next process and locking .next/server-startup.log files.
call "%~dp0START_SERVER_AUTOMATIC.bat" >nul 2>&1
exit /b 0
