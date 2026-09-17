@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 exit /b 1
if not exist logs mkdir logs
set "NEXT_TELEMETRY_DISABLED=1"
if "%PORT%"=="" set "PORT=5055"

rem The always-on Servicing task can run before the main NUNES launcher modifies PATH.
rem Prefer system Node when present; otherwise use the portable Node already installed
rem by NUNES in LocalAppData. This avoids waiting for the dashboard bootstrap first.
set "NODE_EXE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE (
  for /f "delims=" %%N in ('dir /b /s /a-d "%LOCALAPPDATA%\NunesCompanyOperations\runtime\node\node.exe" 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
)
if not defined NODE_EXE (
  >> "logs\server.log" echo [%date% %time%] Node.js runtime not ready yet; main NUNES launcher will retry Servicing.
  popd
  exit /b 2
)

"!NODE_EXE!" "node_modules\next\dist\bin\next" start -H 0.0.0.0 -p %PORT% >> "logs\server.log" 2>&1
set "RC=!ERRORLEVEL!"
popd
exit /b !RC!
