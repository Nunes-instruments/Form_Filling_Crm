@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ServiceFlow - Service Job Cards
color 0A
set "NEXT_TELEMETRY_DISABLED=1"
set "NPM_CONFIG_UPDATE_NOTIFIER=false"
set "PUPPETEER_SKIP_DOWNLOAD=true"
set "NEXT_PRIVATE_WORKER_THREADS=false"

pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Cannot open the application folder.
  if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
  exit /b 1
)

set "APP_DIR=%CD%"
if "%PORT%"=="" set "PORT=5055"
if "%WA_PORT%"=="" set "WA_PORT=5056"
set "APP_URL=http://127.0.0.1:%PORT%"
set "WA_URL=http://127.0.0.1:%WA_PORT%"
set "APP_VERSION=1.1.32"
if exist "VERSION.txt" set /p APP_VERSION=<"VERSION.txt"
set "CACHE_ROOT=%LOCALAPPDATA%\ServiceFlow"
set "NPM_CACHE=%CACHE_ROOT%\npm-cache"
if not exist "data" mkdir "data"
>"data\startup.lock" echo starting
if not exist "logs" mkdir "logs"
if not exist "%CACHE_ROOT%" mkdir "%CACHE_ROOT%" >nul 2>&1
if not exist "%NPM_CACHE%" mkdir "%NPM_CACHE%" >nul 2>&1

cls
echo ============================================================
echo      SERVICEFLOW V!APP_VERSION! - RELIABLE START
echo ============================================================
echo.

echo [1/5] Checking Node.js runtime...
rem The company platform already prepares Node.js. Reuse it immediately instead of
rem running the bootstrap PowerShell a second time for the embedded Servicing form.
set "NODE_DIR="
set "NODE_FOUND="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_FOUND set "NODE_FOUND=%%N"
if defined NODE_FOUND for %%D in ("!NODE_FOUND!") do set "NODE_DIR=%%~dpD"
if not defined NODE_DIR (
  set "NODE_OUT=%TEMP%\nunes_node_%RANDOM%_%RANDOM%.txt"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\..\..\tools\bootstrap-node.ps1" -OutputFile "!NODE_OUT!"
  if exist "!NODE_OUT!" set /p NODE_DIR=<"!NODE_OUT!"
  del /q "!NODE_OUT!" >nul 2>&1
)
if not defined NODE_DIR goto :NO_NODE
if not exist "!NODE_DIR!\node.exe" goto :NO_NODE
set "PATH=!NODE_DIR!;%PATH%"
for /f "usebackq delims=" %%V in (`node -p "process.versions.node" 2^>nul`) do set "NODE_VER=%%V"
echo       Node.js !NODE_VER! ready.

rem V6.4.2 ULTRA-FAST PATH: if this folder already has the exact cached production
rem runtime, skip dependency hashing, verification, cache scans and rebuild checks.
set "SOURCE_SIG="
if exist "SOURCE_SIGNATURE.txt" set /p SOURCE_SIG=<"SOURCE_SIGNATURE.txt"
set "READY_SIG="
if exist "data\build.signature" set /p READY_SIG=<"data\build.signature"
if defined SOURCE_SIG if /I "!READY_SIG!"=="!SOURCE_SIG!" if exist "node_modules\next\package.json" if exist ".next\BUILD_ID" if exist ".next\routes-manifest.json" if exist ".next\prerender-manifest.json" (
  echo [2/5] Cached production runtime ready - instant start.
  goto :START_SERVER
)

set "DEP_HASH="
if exist "DEPENDENCY_SIGNATURE.txt" set /p DEP_HASH=<"DEPENDENCY_SIGNATURE.txt"
if not defined DEP_HASH (
  for /f "usebackq delims=" %%H in (`powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\get-dependency-hash.ps1" -PackageJson "%APP_DIR%\package.json"`) do if not defined DEP_HASH set "DEP_HASH=%%H"
)
if not defined DEP_HASH goto :HASH_ERROR
set "RUNTIME_DIR=%CACHE_ROOT%\runtime\!DEP_HASH!"
set "RUNTIME_NODE=!RUNTIME_DIR!\node_modules"

set "DEPS_READY="
if exist "node_modules\next\package.json" (
  node "scripts\verify-runtime.js" "%APP_DIR%" >nul 2>&1
  if not errorlevel 1 set "DEPS_READY=YES"
)
if not defined DEPS_READY if exist "!RUNTIME_DIR!\.ready" if exist "!RUNTIME_NODE!\next\package.json" (
  rmdir "node_modules" >nul 2>&1
  mklink /J "node_modules" "!RUNTIME_NODE!" >nul 2>&1
  node "scripts\verify-runtime.js" "%APP_DIR%" >nul 2>&1
  if not errorlevel 1 set "DEPS_READY=YES"
  if not defined DEPS_READY (
    rmdir "node_modules" >nul 2>&1
    rmdir /S /Q "!RUNTIME_DIR!" >nul 2>&1
  )
)
if not defined DEPS_READY (
  echo [2/5] Installing lightweight ServiceFlow web packages once...
  if not exist "!RUNTIME_DIR!" mkdir "!RUNTIME_DIR!" >nul 2>&1
  copy /y "package.json" "!RUNTIME_DIR!\package.json" >nul
  pushd "!RUNTIME_DIR!" >nul
  call npm install --no-audit --no-fund --prefer-offline --progress=false --loglevel=error --cache "!NPM_CACHE!" --fetch-retries=2 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=5000
  set "NPM_RC=!ERRORLEVEL!"
  popd >nul
  if not "!NPM_RC!"=="0" goto :NPM_ERROR
  rmdir "node_modules" >nul 2>&1
  mklink /J "node_modules" "!RUNTIME_NODE!" >nul 2>&1
  node "scripts\verify-runtime.js" "%APP_DIR%"
  if errorlevel 1 goto :NPM_ERROR
  >"!RUNTIME_DIR!\.ready" echo ready
  set "DEPS_READY=YES"
) else (
  echo [2/5] Packages verified.
)

rem V6.4.2: WhatsApp is fully lazy and is not part of form startup.
echo [3/5] Core form ready path only - WhatsApp starts only when requested.

if not defined SOURCE_SIG if exist "SOURCE_SIGNATURE.txt" set /p SOURCE_SIG=<"SOURCE_SIGNATURE.txt"
if not defined SOURCE_SIG (
  for /f "usebackq delims=" %%H in (`powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\get-source-hash.ps1" -AppDir "%APP_DIR%"`) do if not defined SOURCE_SIG set "SOURCE_SIG=%%H"
)
if not defined SOURCE_SIG goto :HASH_ERROR
set "BUILD_CACHE_DIR=%CACHE_ROOT%\build-cache\!SOURCE_SIG!"

rem V6.3.3 NEW-ZIP FAST PATH: reconnect the exact source-keyed production build
rem directly from LOCALAPPDATA with a zero-copy junction.
if not exist ".next\BUILD_ID" if exist "!BUILD_CACHE_DIR!\BUILD_ID" if exist "!BUILD_CACHE_DIR!\routes-manifest.json" if exist "!BUILD_CACHE_DIR!\prerender-manifest.json" (
  if exist ".next" rmdir ".next" >nul 2>&1
  mklink /J ".next" "!BUILD_CACHE_DIR!" >nul 2>&1
  if not errorlevel 1 >"data\build.signature" echo !SOURCE_SIG!
)
set "READY_SIG="
if exist "data\build.signature" set /p READY_SIG=<"data\build.signature"
if /I "!READY_SIG!"=="!SOURCE_SIG!" if exist ".next\BUILD_ID" if exist ".next\routes-manifest.json" if exist ".next\prerender-manifest.json" (
  echo [4/5] Cached production build connected - instant start.
  goto :START_SERVER
)

rem Reuse the exact same production build across V6 ZIP updates. This is safe because
rem the cache key is the full ServiceFlow source signature. It also imports a matching
rem build from an older extracted NUNES package when available.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\reuse-production-build.ps1" -AppDir "%APP_DIR%" -CacheDir "!BUILD_CACHE_DIR!" -SourceSignature "!SOURCE_SIG!" >nul 2>&1
if not exist ".next\BUILD_ID" if exist "!BUILD_CACHE_DIR!\BUILD_ID" (
  if exist ".next" rmdir /S /Q ".next" >nul 2>&1
  mklink /J ".next" "!BUILD_CACHE_DIR!" >nul 2>&1
  if not errorlevel 1 >"data\build.signature" echo !SOURCE_SIG!
)
set "READY_SIG="
if exist "data\build.signature" set /p READY_SIG=<"data\build.signature"
set "BUILD_VALID=NO"
for /f %%A in ('powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\verify-production-build.ps1" -AppDir "%APP_DIR%"') do set "BUILD_VALID=%%A"
if /I "!READY_SIG!"=="!SOURCE_SIG!" if /I "!BUILD_VALID!"=="YES" (
  echo [4/5] Production build verified - skipping rebuild.
  goto :START_SERVER
)

echo [4/5] Creating a clean production build once...
rem Never reuse/copy a half-written .next folder. Windows can otherwise leave missing manifests.
if exist ".next" rmdir /S /Q ".next" >nul 2>&1
if exist ".next" (
  timeout /t 1 /nobreak >nul
  rmdir /S /Q ".next" >nul 2>&1
)
if exist ".next" goto :BUILD_CLEAN_ERROR
set "NEXT_PRIVATE_WORKER_THREADS=false"
node "node_modules\next\dist\bin\next" build
if errorlevel 1 goto :BUILD_ERROR
set "BUILD_VALID=NO"
for /f %%A in ('powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\verify-production-build.ps1" -AppDir "%APP_DIR%"') do set "BUILD_VALID=%%A"
if /I not "!BUILD_VALID!"=="YES" goto :BUILD_MANIFEST_ERROR
>"data\build.signature" echo !SOURCE_SIG!
if /I not "%NUNES_PREPARE_ONLY%"=="1" start "ServiceFlow Build Cache" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "scripts\store-production-build.ps1" -BuildDir "%APP_DIR%\.next" -CacheDir "!BUILD_CACHE_DIR!"

:START_SERVER
rem Setup only prepares packages/build; the resident installer starts one server later.
if /I "%NUNES_PREPARE_ONLY%"=="1" (
  del /q "data\startup.lock" >nul 2>&1
  echo [5/5] Production build prepared. Resident installer will start the server.
  popd
  exit /b 0
)
set "EXISTING_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do set "EXISTING_PID=%%P"
if defined EXISTING_PID (
  set "IS_SERVICEFLOW="
  for /f %%A in ('powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\check-serviceflow.ps1" -Url "%APP_URL%/api/health" -ExpectedVersion "!APP_VERSION!"') do set "IS_SERVICEFLOW=%%A"
  if /I "!IS_SERVICEFLOW!"=="YES" (
    echo [5/5] ServiceFlow !APP_VERSION! already running - opening browser.
if /I not "%NUNES_EMBEDDED%"=="1" start "" "%APP_URL%"
    goto :FINISH
  )
  if /I "!IS_SERVICEFLOW!"=="OLD" (
    echo [5/5] Restarting older ServiceFlow on port %PORT%...
    taskkill /PID !EXISTING_PID! /T /F >nul 2>&1
    timeout /t 1 /nobreak >nul
  ) else (
    echo ERROR: Port %PORT% is already used by another program ^(PID !EXISTING_PID!^).
    if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
    popd
    exit /b 1
  )
)

echo [5/5] Starting ServiceFlow...
start "ServiceFlow Server" /min cmd /c "call RUN_SERVER_HIDDEN.bat"
set "SERVER_READY=NO"
for /f %%R in ('powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\wait-for-serviceflow.ps1" -Url "%APP_URL%/api/health" -TimeoutSeconds 20') do set "SERVER_READY=%%R"
if /I not "!SERVER_READY!"=="YES" goto :START_ERROR
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do >"data\server.pid" echo %%P
start "ServiceFlow Form Prewarm" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "scripts\prewarm-service-form.ps1" -BaseUrl "%APP_URL%" >nul 2>&1
if /I not "%NUNES_EMBEDDED%"=="1" start "" "%APP_URL%"

:FINISH
del /q "data\startup.lock" >nul 2>&1
start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "scripts\refresh-office-url.ps1" -AppDir "%APP_DIR%" -Port %PORT%
echo.
echo ============================================================
echo  ServiceFlow ready: %APP_URL%
echo  WhatsApp: starts only on demand from Connections
echo ============================================================
popd
exit /b 0

:NO_NODE
del /q "data\startup.lock" >nul 2>&1
echo ERROR: A compatible Node.js runtime could not be prepared automatically.
echo Check internet/proxy settings and run this file again.
if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
popd
exit /b 1
:NPM_ERROR
del /q "data\startup.lock" >nul 2>&1
echo.
echo ERROR: Package installation/runtime verification failed.
echo Delete %%LOCALAPPDATA%%\ServiceFlow\runtime and run this BAT again if needed.
if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
popd
exit /b 1
:HASH_ERROR
del /q "data\startup.lock" >nul 2>&1
echo ERROR: Could not calculate application signature.
if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
popd
exit /b 1
:BUILD_CLEAN_ERROR
del /q "data\startup.lock" >nul 2>&1
echo ERROR: Windows could not remove the old .next folder. Close any old ServiceFlow server and run again.
if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
popd
exit /b 1
:BUILD_ERROR
del /q "data\startup.lock" >nul 2>&1
echo.
echo ERROR: App build failed. The old/incomplete .next folder was already removed before this build.
if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
popd
exit /b 1
:BUILD_MANIFEST_ERROR
del /q "data\startup.lock" >nul 2>&1
echo.
echo ERROR: Next.js reported success but required production manifests are missing. Build was rejected instead of starting a broken app.
if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
popd
exit /b 1
:START_ERROR
del /q "data\startup.lock" >nul 2>&1
echo ERROR: ServiceFlow did not start. Check logs\server.log.
if /I not "%NUNES_PREPARE_ONLY%"=="1" pause
popd
exit /b 1
