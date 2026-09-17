@echo off
setlocal EnableExtensions
rem V6.4.1: always-ready Servicing warm-up. All extracted V6.4.1+ packages
rem point to the same persistent ServiceData directory, so a compatible running
rem ServiceFlow can be reused instead of restarted.
set "ROOT=%~dp0.."
for %%D in ("%ROOT%") do set "ROOT=%%~fD"
set "APP_DIR=%ROOT%\apps\service_operations"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\prepare-service-data.ps1" -WorkspaceRoot "%ROOT%" -CurrentData "%APP_DIR%\data" >nul 2>&1
set "NUNES_EMBEDDED=1"
set "PORT=5055"
set "NEXT_TELEMETRY_DISABLED=1"
call "%APP_DIR%\START_EMBEDDED_FAST.bat"
exit /b %ERRORLEVEL%
