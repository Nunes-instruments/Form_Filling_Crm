@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "NUNES_NO_BROWSER=1"

rem V6.5.0 FILE-IN-USE FIX:
rem All server starts go through one named Windows mutex. This prevents the
rem scheduled server, watchdog, desktop recovery, or a double-click from running
rem the build/start sequence at the same time.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run-server-once.ps1" -Root "%~dp0."
exit /b %errorlevel%
