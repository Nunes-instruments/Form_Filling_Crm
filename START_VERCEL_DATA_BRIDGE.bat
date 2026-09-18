@echo off
setlocal EnableExtensions EnableDelayedExpansion
title NUNES V6.4.7 - Vercel Data Bridge
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (echo ERROR: Cannot open this folder.& pause & exit /b 1)
set "ROOT=%CD%"
set "NUNES_SERVICE_DATA_FILE=%LOCALAPPDATA%\NUNES Operations\ServiceData\jobs.json"
cls
echo ============================================================
echo       NUNES V6.4.7 - VERCEL DATA BRIDGE
echo ============================================================
echo This keeps your existing Purchasing and Servicing records on
 echo this PC and lets the Vercel website read them from this PC.
echo No database is copied into Vercel.
echo.

rem Prepare Node because Purchasing/Servicing modules may be started on demand.
set "NODEFILE=%TEMP%\nunes_node_bridge_%RANDOM%_%RANDOM%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\bootstrap-node.ps1" -OutputFile "%NODEFILE%"
if exist "%NODEFILE%" set /p NODEDIR=<"%NODEFILE%"
del /q "%NODEFILE%" >nul 2>&1
if not defined NODEDIR goto :NODE_ERROR
set "PATH=%NODEDIR%;%PATH%"

set "PYFILE=%TEMP%\nunes_python_bridge_%RANDOM%_%RANDOM%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\bootstrap-python.ps1" -OutputFile "%PYFILE%"
if exist "%PYFILE%" set /p PYEXE=<"%PYFILE%"
del /q "%PYFILE%" >nul 2>&1
if not defined PYEXE goto :PYTHON_ERROR
if not exist "%PYEXE%" goto :PYTHON_ERROR

rem Vercel browser bridge probes 8865-8875. Reuse a healthy NUNES API if one exists.
set "APIPORT="
for %%Q in (8865 8866 8867 8868 8869 8870 8871 8872 8873 8874 8875) do (
  if not defined APIPORT (
    powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 1 http://127.0.0.1:%%Q/api/health;if($r.ok -eq $true -and [string]$r.product -like 'NUNES Company Data API*'){exit 0}}catch{};exit 1" >nul 2>&1
    if not errorlevel 1 set "APIPORT=%%Q"
  )
)
if defined APIPORT goto :API_READY

for %%Q in (8865 8866 8867 8868 8869 8870 8871 8872 8873 8874 8875) do (
  if not defined APIPORT (
    set "USED="
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%%Q .*LISTENING"') do set "USED=%%P"
    if not defined USED set "APIPORT=%%Q"
  )
)
if not defined APIPORT (echo ERROR: Ports 8865-8875 are already in use.& pause & exit /b 1)

set "NUNES_API_PORT=!APIPORT!"
set "NUNES_HOST=127.0.0.1"
set "NUNES_BROWSER_ORIGINS=https://nunes-operations-workspace.vercel.app"
set "NUNES_CLOUD=0"
start "NUNES Vercel Data Bridge" /min "%PYEXE%" "%ROOT%\platform\server.py"

for /L %%I in (1,1,20) do (
  powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 1 http://127.0.0.1:!APIPORT!/api/health;if($r.ok -eq $true){exit 0}}catch{};exit 1" >nul 2>&1
  if not errorlevel 1 goto :API_READY
  timeout /t 1 /nobreak >nul
)
echo ERROR: Local data bridge did not start.
pause
exit /b 1

:API_READY
rem Keep Servicing warm, but do not block opening Vercel.
start "NUNES Servicing Always Ready" /min cmd /d /c "call ""%ROOT%\tools\EARLY_START_SERVICING.bat"""

echo.
echo ============================================================
echo DATA BRIDGE READY - PORT !APIPORT!
echo ============================================================
echo Keep this PC running while using live records in Vercel.
echo Opening the same production website now...
echo.
start "" "https://nunes-operations-workspace.vercel.app/?bridge=!APIPORT!&connect=local"
echo IMPORTANT: If Chrome asks for Local Network Access, choose Allow.
echo If the page still says Data offline, click CONNECT THIS PC on the amber banner.
echo You can minimize this window.
echo ============================================================
pause
popd
exit /b 0

:PYTHON_ERROR
echo ERROR: Python could not be prepared automatically.
pause
exit /b 1
:NODE_ERROR
echo ERROR: Node.js could not be prepared automatically.
pause
exit /b 1
