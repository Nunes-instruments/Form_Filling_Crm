@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem NUNES V6.3.8 - always-ready Servicing launcher used by the company platform.
rem Goal: when the verified production build already exists, start Next.js with
rem almost no setup overhead. Falls back to the original reliable launcher only
rem when the one-time runtime/build preparation is genuinely required.

pushd "%~dp0" >nul 2>&1
if errorlevel 1 exit /b 1
set "NUNES_EMBEDDED=1"
set "NEXT_TELEMETRY_DISABLED=1"
if "%PORT%"=="" set "PORT=5055"
set "APP_URL=http://127.0.0.1:%PORT%"
if not exist "data" mkdir "data" >nul 2>&1

rem 1) Fastest offline test: if nothing listens on 5055, skip HTTP/PowerShell
rem probing completely and launch immediately. Only validate an existing listener.
set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do if not defined PORT_PID set "PORT_PID=%%P"
set "INSTANCE_STATE=OFFLINE"
if defined PORT_PID (
  set "EXPECTED_VERSION=1.1.32"
  if exist "VERSION.txt" set /p EXPECTED_VERSION=<"VERSION.txt"
  for /f %%S in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; try{$r=Invoke-RestMethod -TimeoutSec 0.6 '%APP_URL%/api/health'; if($r.app -eq 'ServiceFlowJobCards' -and [string]$r.version -eq '!EXPECTED_VERSION!'){'CURRENT'} elseif($r.app -eq 'ServiceFlowJobCards'){'OLD'} else {'FOREIGN'}}catch{'FOREIGN'}"') do set "INSTANCE_STATE=%%S"
)
if /I "!INSTANCE_STATE!"=="CURRENT" (
  start "ServiceFlow Form Prewarm" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "scripts\prewarm-service-form.ps1" -BaseUrl "%APP_URL%" >nul 2>&1
  popd & exit /b 0
)

rem 2) Only an incompatible old ServiceFlow is restarted. A compatible ServiceFlow
rem from another V6.3.8+ extracted folder is intentionally kept alive because all
rem such packages use the same persistent ServiceData junction.
if /I "!INSTANCE_STATE!"=="OLD" (
  if defined PORT_PID taskkill /PID !PORT_PID! /T /F >nul 2>&1
)
if /I "!INSTANCE_STATE!"=="FOREIGN" (popd & exit /b 2)

rem 3) Absolute fastest route: current folder already has runtime + exact build.
set "SOURCE_SIG="
if exist "SOURCE_SIGNATURE.txt" set /p SOURCE_SIG=<"SOURCE_SIGNATURE.txt"
set "READY_SIG="
if exist "data\build.signature" set /p READY_SIG=<"data\build.signature"
if defined SOURCE_SIG if /I "!READY_SIG!"=="!SOURCE_SIG!" if exist "node_modules\next\package.json" if exist ".next\BUILD_ID" (
  >"data\startup.lock" echo starting
  start "ServiceFlow Hot Server" /min cmd /d /c "call RUN_SERVER_HIDDEN.bat"
  start "ServiceFlow Form Prewarm" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "scripts\prewarm-service-form.ps1" -BaseUrl "%APP_URL%" >nul 2>&1
  start "ServiceFlow Lock Cleanup" /min cmd /d /c "timeout /t 8 /nobreak ^>nul ^& del /q data\startup.lock ^>nul 2^>^&1"
  popd
  exit /b 0
)

rem 4) Reconnect zero-copy cached runtime/build with no source hashing.
set "DEP_SIG="
if exist "DEPENDENCY_SIGNATURE.txt" set /p DEP_SIG=<"DEPENDENCY_SIGNATURE.txt"
if defined SOURCE_SIG if defined DEP_SIG (
  set "CACHE_ROOT=%LOCALAPPDATA%\ServiceFlow"
  set "RUNTIME_DIR=!CACHE_ROOT!\runtime\!DEP_SIG!"
  set "BUILD_DIR=!CACHE_ROOT!\build-cache\!SOURCE_SIG!"
  if not exist "node_modules\next\package.json" if exist "!RUNTIME_DIR!\.ready" if exist "!RUNTIME_DIR!\node_modules\next\package.json" (
    if exist "node_modules" rmdir "node_modules" >nul 2>&1
    mklink /J "node_modules" "!RUNTIME_DIR!\node_modules" >nul 2>&1
  )
  if not exist ".next\BUILD_ID" if exist "!BUILD_DIR!\BUILD_ID" (
    if exist ".next" rmdir ".next" >nul 2>&1
    mklink /J ".next" "!BUILD_DIR!" >nul 2>&1
    if exist ".next\BUILD_ID" >"data\build.signature" echo !SOURCE_SIG!
  )
  if exist "node_modules\next\package.json" if exist ".next\BUILD_ID" (
    >"data\startup.lock" echo starting
    start "ServiceFlow Hot Server" /min cmd /d /c "call RUN_SERVER_HIDDEN.bat"
    start "ServiceFlow Form Prewarm" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "scripts\prewarm-service-form.ps1" -BaseUrl "%APP_URL%" >nul 2>&1
    start "ServiceFlow Lock Cleanup" /min cmd /d /c "timeout /t 8 /nobreak ^>nul ^& del /q data\startup.lock ^>nul 2^>^&1"
    popd
    exit /b 0
  )
)

rem 5) During company boot, do not compete with the dashboard for a first-time npm install/build.
rem If the cached Servicing runtime/build exists, the fast paths above already started it.
rem Otherwise defer the heavy preparation until the dashboard is live and WARM_MODULES triggers it.
if /I "%NUNES_FAST_ONLY%"=="1" (popd & exit /b 3)

rem One-time preparation only. Original reliable installer/build path is kept.
popd
call "%~dp0START_SERVICE_JOB_APP.bat"
exit /b %ERRORLEVEL%
