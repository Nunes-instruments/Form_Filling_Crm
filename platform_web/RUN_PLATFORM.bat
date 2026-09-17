@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if not defined NUNES_PORT set "NUNES_PORT=8785"
if not defined NUNES_HOST set "NUNES_HOST=0.0.0.0"

rem Next.js is configured with output:'standalone'. In this mode the supported
rem local production runtime is the generated .next\standalone\server.js, not
rem `next start`. PORT/HOSTNAME are the variables read by the standalone server.
set "PORT=%NUNES_PORT%"
set "HOSTNAME=%NUNES_HOST%"
set "SERVERJS=%~dp0.next\standalone\server.js"
set "STATE_DIR=%LOCALAPPDATA%\NUNES Operations"
if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>&1
set "RUNTIME_LOG=%STATE_DIR%\dashboard-runtime.log"

if not exist "%SERVERJS%" (
  >"%RUNTIME_LOG%" echo [%date% %time%] ERROR: Standalone server is missing: %SERVERJS%
  exit /b 21
)

rem The standalone server does not copy .next\static automatically. The
rem preparation step normally creates this junction, but repair it here too so
rem an already-cached build from an earlier V6.5.0 package starts immediately.
if exist "%~dp0.next\static" (
  if not exist "%~dp0.next\standalone\.next" mkdir "%~dp0.next\standalone\.next" >nul 2>&1
  if not exist "%~dp0.next\standalone\.next\static" (
    cmd /d /c mklink /J "%~dp0.next\standalone\.next\static" "%~dp0.next\static" >nul 2>&1
  )
)

>"%RUNTIME_LOG%" echo [%date% %time%] Starting NUNES standalone dashboard on %HOSTNAME%:%PORT%
where node.exe >>"%RUNTIME_LOG%" 2>&1
node.exe "%SERVERJS%" >>"%RUNTIME_LOG%" 2>&1
set "RC=!ERRORLEVEL!"
>>"%RUNTIME_LOG%" echo [%date% %time%] Dashboard process exited with code !RC!.
exit /b !RC!
