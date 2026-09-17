@echo off
setlocal EnableExtensions EnableDelayedExpansion
title NUNES Company Platform V6.5.0 - Fast Office Server
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (echo ERROR: Cannot open this folder.& if /I not "%NUNES_NO_BROWSER%"=="1" pause & exit /b 1)
set "ROOT=%CD%"
set "VERSION=6.5.0"

rem V7 NETWORK/NTFS FIX: after the one-time server setup, always use the
rem configured LOCAL runtime when this BAT is accidentally started from a UNC share.
if "!ROOT:~0,2!"=="\\" (
  set "ROOT_POINTER=%LOCALAPPDATA%\NUNES Operations\workspace-root.txt"
  if exist "!ROOT_POINTER!" (
    set "CONFIGURED_ROOT="
    set /p CONFIGURED_ROOT=<"!ROOT_POINTER!"
    if defined CONFIGURED_ROOT if exist "!CONFIGURED_ROOT!\START_NUNES_COMPANY.bat" (
      if /I not "!CONFIGURED_ROOT!"=="!ROOT!" (
        popd
        call "!CONFIGURED_ROOT!\START_NUNES_COMPANY.bat"
        exit /b !errorlevel!
      )
    )
  )
)
set "STATE_DIR=%LOCALAPPDATA%\NUNES Operations"
if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>&1
set "STATUSFILE=%STATE_DIR%\server-status.txt"
>"%STATUSFILE%" echo STARTING - Initializing NUNES server...
set "NEXT_TELEMETRY_DISABLED=1"
cls
echo ============================================================
echo        NUNES COMPANY PLATFORM V6.5.0 - FAST SERVER
echo ============================================================
echo Shared dashboard + Purchasing + Servicing
echo.

rem FAST REOPEN: do not bootstrap Node/Python or rebuild anything when the
rem same server stack is already alive. This is the normal daily path.
set "EXISTING_PLATFORM="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\find-running-platform.ps1" -Version "%VERSION%" 2^>nul`) do if not defined EXISTING_PLATFORM set "EXISTING_PLATFORM=%%P"
set "EXISTING_API="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\find-running-data-api.ps1" -Version "%VERSION%" 2^>nul`) do if not defined EXISTING_API set "EXISTING_API=%%P"
if defined EXISTING_PLATFORM if defined EXISTING_API (
  set "PORT=!EXISTING_PLATFORM!"
  set "APIPORT=!EXISTING_API!"
  echo [FAST] Existing server is already running. No install or build needed.
  >"%STATUSFILE%" echo READY - Existing NUNES server reused.
  start "Ensure Servicing Ready" /b powershell -NoProfile -Command "try{Invoke-RestMethod -Method Post -TimeoutSec 2 http://127.0.0.1:!APIPORT!/api/modules/service_operations/start ^| Out-Null}catch{}" ^>nul 2^>^&1
  goto :READY
)

rem If a half-running current/older dashboard exists, restart only the main
rem dashboard so it reconnects to the exact data API selected below.
for %%Q in (8785 8786 8787 8788 8789 8790 8791 8792 8793 8794 8795) do (
  powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 1 http://127.0.0.1:%%Q/api/health;if($r.ok -eq $true -and [string]$r.product -eq 'NUNES Company Platform'){exit 0}}catch{};exit 1" >nul 2>&1
  if not errorlevel 1 (
    set "OLDPID="
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%%Q .*LISTENING"') do set "OLDPID=%%P"
    if defined OLDPID taskkill /PID !OLDPID! /T /F >nul 2>&1
  )
)
if not defined EXISTING_API (
  for %%Q in (8865 8866 8867 8868 8869 8870 8871 8872 8873 8874 8875) do (
    powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 1 http://127.0.0.1:%%Q/api/health;if($r.ok -eq $true -and [string]$r.product -eq 'NUNES Company Data API'){exit 0}}catch{};exit 1" >nul 2>&1
    if not errorlevel 1 (
      set "OLDAPIPID="
      for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%%Q .*LISTENING"') do set "OLDAPIPID=%%P"
      if defined OLDAPIPID taskkill /PID !OLDAPIPID! /T /F >nul 2>&1
    )
  )
)

rem SPEED-ONLY: launch Servicing at the earliest possible moment, before Node/Python/dashboard
rem preparation. The dedicated Servicing starter reuses the existing portable Node/runtime/build
rem when available and exits quickly if the engine is already hot.
start "NUNES Servicing Instant Warm" /min cmd /d /c "call ""%ROOT%\tools\EARLY_START_SERVICING.bat""" >nul 2>&1

rem V6.5.0: Purchasing data is persistent across extracted ZIP updates, just like
rem Servicing data. The first migration selects the newest existing Purchasing DB.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\prepare-purchasing-data.ps1" -WorkspaceRoot "%ROOT%" -CurrentData "%ROOT%\apps\order_forms\data" >nul
if errorlevel 1 (echo ERROR: Could not connect persistent Purchasing data. Existing data was not intentionally deleted.& >"%STATUSFILE%" echo ERROR - Persistent Purchasing data could not be connected.& if /I not "%NUNES_NO_BROWSER%"=="1" pause & exit /b 1)

rem Node is prepared once per Windows PC, then reused forever.
echo [1/6] Preparing reusable Node runtime...
>"%STATUSFILE%" echo [1/6] Preparing reusable Node runtime...
set "NODEFILE=%TEMP%\nunes_node_%RANDOM%_%RANDOM%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\bootstrap-node.ps1" -OutputFile "%NODEFILE%"
if exist "%NODEFILE%" set /p NODEDIR=<"%NODEFILE%"
del /q "%NODEFILE%" >nul 2>&1
if not defined NODEDIR goto :NODE_ERROR
if not exist "%NODEDIR%\node.exe" goto :NODE_ERROR
set "PATH=%NODEDIR%;%PATH%"
set "NPMCMD=%NODEDIR%\npm.cmd"

rem Retry immediately after Node bootstrap as a first-PC fallback. On normal daily starts
rem the earlier warm task already has Servicing ready, so this idempotent call exits quickly.
echo [2/6] Keeping Servicing hot...
>"%STATUSFILE%" echo [2/6] Servicing warming in background...
start "NUNES Servicing Post-Node Warm" /min cmd /d /c "call ""%ROOT%\tools\EARLY_START_SERVICING.bat""" >nul 2>&1

rem Reuse an already-running data API when possible. Otherwise prepare Python once.
if defined EXISTING_API (
  set "APIPORT=!EXISTING_API!"
) else (
  echo [3/6] Preparing shared data service...
  >"%STATUSFILE%" echo [3/6] Preparing shared data service...
  rem IMPORTANT: this code is inside a parenthesized ELSE block. Use delayed
  rem expansion for values created inside the block; %%PYFILE%%/%%PYEXE%% would
  rem be expanded before SET executes and can become an empty string.
  set "PYEXE="
  set "PYFILE=!TEMP!\nunes_python_!RANDOM!_!RANDOM!.txt"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\bootstrap-python.ps1" -OutputFile "!PYFILE!"
  if errorlevel 1 (
    if exist "!PYFILE!" del /q "!PYFILE!" >nul 2>&1
    goto :PYTHON_ERROR
  )
  if exist "!PYFILE!" set /p PYEXE=<"!PYFILE!"
  if exist "!PYFILE!" del /q "!PYFILE!" >nul 2>&1
  if not defined PYEXE goto :PYTHON_ERROR
  if not exist "!PYEXE!" goto :PYTHON_ERROR
  set "APIPORT="
  for %%Q in (8865 8866 8867 8868 8869 8870 8871 8872 8873 8874 8875) do (
    if not defined APIPORT (
      set "USEDAPI="
      for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%%Q .*LISTENING"') do set "USEDAPI=%%P"
      if not defined USEDAPI set "APIPORT=%%Q"
    )
  )
  if not defined APIPORT (echo ERROR: No free internal data API port.& >"%STATUSFILE%" echo ERROR - No free internal data API port.& if /I not "%NUNES_NO_BROWSER%"=="1" pause & exit /b 1)
  set "NUNES_API_PORT=!APIPORT!"
  set "NUNES_HOST=0.0.0.0"
  start "NUNES Company Data API" /min "!PYEXE!" "%ROOT%\platform\server.py" >nul 2>&1
  set "APIREADY=NO"
  for /f %%R in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\wait-http.ps1" -Url "http://127.0.0.1:!APIPORT!/api/health" -TimeoutMilliseconds 6000 -Product "NUNES Company Data API" -Version "%VERSION%"') do set "APIREADY=%%R"
  if /I not "!APIREADY!"=="YES" (echo ERROR: Shared data service did not start.& >"%STATUSFILE%" echo ERROR - Shared data service did not start.& if /I not "%NUNES_NO_BROWSER%"=="1" pause & exit /b 1)
)

set "NUNES_API_PORT=!APIPORT!"
set "NUNES_API_INTERNAL_URL=http://127.0.0.1:!APIPORT!"
set "NUNES_HOST=0.0.0.0"

rem Keep the dashboard URL stable on the new main-server port range, starting at 8785.
set "PORT="
for %%Q in (8785 8786 8787 8788 8789 8790 8791 8792 8793 8794 8795) do (
  if not defined PORT (
    set "USED="
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%%Q .*LISTENING"') do set "USED=%%P"
    if not defined USED set "PORT=%%Q"
  )
)
if not defined PORT (echo ERROR: No free dashboard port.& >"%STATUSFILE%" echo ERROR - No free dashboard port.& if /I not "%NUNES_NO_BROWSER%"=="1" pause & exit /b 1)
set "NUNES_PORT=!PORT!"

rem V6.5.0: platform packages/build are stored once in LOCALAPPDATA and reused by
rem future ZIP updates. If this ZIP contains a verified prebuild, no Next build occurs.
echo [4/6] Connecting reusable dashboard runtime/build...
>"%STATUSFILE%" echo [4/6] Preparing dashboard runtime/build...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\repair-web-source.ps1" >nul
if errorlevel 1 goto :BUILD_ERROR
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\prepare-platform-web.ps1" -Root "%ROOT%" -NpmCmd "%NPMCMD%"
if errorlevel 1 goto :BUILD_ERROR

rem Start the main workspace only after data is live; waiting uses one PowerShell
rem process instead of dozens of one-second health-check processes.
echo [5/6] Starting NUNES workspace...
>"%STATUSFILE%" echo [5/6] Starting dashboard...
rem VERIFIED STEP-5 FIX: do not launch the dashboard through nested START/CMD/CALL
rem quoting. Use the already-prepared Node executable to create one detached
rem dashboard process and preserve stdout/stderr in LocalAppData.
"%NODEDIR%\node.exe" "%ROOT%\tools\start-dashboard.cjs" "%ROOT%" "!PORT!" "0.0.0.0" "!NUNES_API_INTERNAL_URL!" "%NODEDIR%\node.exe"
if errorlevel 1 goto :WORKSPACE_ERROR
set "READY=NO"
for /f %%R in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\wait-http.ps1" -Url "http://127.0.0.1:!PORT!/api/health" -TimeoutMilliseconds 45000 -Product "NUNES Company Platform" -Version "%VERSION%"') do set "READY=%%R"
if /I not "!READY!"=="YES" goto :WORKSPACE_ERROR

rem Low-priority repair/warm requests never block the first screen.
start "NUNES Form Warmup" /min cmd /d /c "call ""%ROOT%\tools\WARM_MODULES.bat""" >nul 2>&1

:READY
echo [6/6] Shared-device access ready.
>"%STATUSFILE%" echo READY - NUNES dashboard is running.
set "LANIP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\get-lan-ip.ps1"`) do if not defined LANIP set "LANIP=%%I"
if not defined LANIP set "LANIP=SERVER-PC-IP"
>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo NUNES COMPANY PLATFORM V6.5.0
>>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo ========================================
>>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo This PC: http://127.0.0.1:!PORT!
>>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo Other devices: http://!LANIP!:!PORT!
>>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo PC-name link: http://%COMPUTERNAME%:!PORT!
>>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo.
>>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo All devices use the SAME Purchasing and Servicing data from this server PC.
>>"%ROOT%\OPEN_ON_OTHER_DEVICES.txt" echo Keep this server PC signed in and ON. Run 1_SETUP_ALWAYS_ON_SERVER.bat once.
if /I not "%NUNES_NO_BROWSER%"=="1" start "" "http://127.0.0.1:!PORT!"
echo.
echo ============================================================
echo READY - NUNES COMPANY PLATFORM V6.5.0
echo This PC     : http://127.0.0.1:!PORT!
echo Other device: http://!LANIP!:!PORT!
echo ============================================================
popd
exit /b 0

:PYTHON_ERROR
echo ERROR: Python could not be prepared automatically.
>"%STATUSFILE%" echo ERROR - Python could not be prepared automatically.
if /I not "%NUNES_NO_BROWSER%"=="1" pause
exit /b 1
:NODE_ERROR
echo ERROR: Node.js could not be prepared automatically.
>"%STATUSFILE%" echo ERROR - Node.js could not be prepared automatically.
if /I not "%NUNES_NO_BROWSER%"=="1" pause
exit /b 1
:BUILD_ERROR
echo ERROR: The NUNES dashboard runtime/build could not be prepared.
echo Existing Purchasing and Servicing data was NOT deleted.
>"%STATUSFILE%" echo ERROR - Dashboard runtime/build could not be prepared.
if /I not "%NUNES_NO_BROWSER%"=="1" pause
exit /b 1
:WORKSPACE_ERROR
echo ERROR: NUNES workspace did not start.
>"%STATUSFILE%" echo ERROR - NUNES workspace did not start.
echo.
echo Dashboard launch details:
powershell -NoProfile -Command "$d=Join-Path $env:LOCALAPPDATA 'NUNES Operations'; foreach($n in 'dashboard-launcher.log','dashboard-stderr.log','dashboard-stdout.log','dashboard-runtime.log'){ $p=Join-Path $d $n; if(Test-Path -LiteralPath $p){ Write-Host ('--- '+$n+' ---'); Get-Content -LiteralPath $p -Tail 30 } }" 2^>nul
if /I not "%NUNES_NO_BROWSER%"=="1" pause
popd
exit /b 1
