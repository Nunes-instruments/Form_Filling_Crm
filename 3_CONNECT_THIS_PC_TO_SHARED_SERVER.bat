@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title NUNES - One Time Staff / Owner Connection
cls
echo ============================================================
echo       NUNES STAFF / OWNER - ONE TIME CONNECTION
echo ============================================================
set "DEFAULT_URL=http://100.97.196.17:8795"
echo Main server: %DEFAULT_URL%
echo.

set "TS_EXE="
for /f "delims=" %%I in ('where tailscale.exe 2^>nul') do if not defined TS_EXE set "TS_EXE=%%I"
if not defined TS_EXE if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS_EXE=%ProgramFiles%\Tailscale\tailscale.exe"
if not defined TS_EXE if exist "%ProgramFiles(x86)%\Tailscale\tailscale.exe" set "TS_EXE=%ProgramFiles(x86)%\Tailscale\tailscale.exe"

if not defined TS_EXE (
  echo [ACTION NEEDED] Tailscale is not installed on this staff/owner PC.
  echo Install Tailscale, sign in to the company tailnet, then run this file again.
  echo.
  start "" "https://tailscale.com/download/windows"
  pause
  exit /b 2
)

echo [1/4] Tailscale found.
"%TS_EXE%" status >nul 2>&1
if errorlevel 1 (
  echo [ACTION NEEDED] Tailscale is installed but not connected.
  echo Open Tailscale and sign in to the company account/tailnet, then retry.
  start "" "%TS_EXE%"
  pause
  exit /b 3
)

set /p "URL=Server address [press Enter for %DEFAULT_URL%]: "
if not defined URL set "URL=%DEFAULT_URL%"
set "URL=%URL:\"=%"
if /I not "%URL:~0,7%"=="http://" if /I not "%URL:~0,8%"=="https://" set "URL=http://%URL%"
if "%URL:~-1%"=="/" set "URL=%URL:~0,-1%"

echo [2/4] Checking main server from THIS client PC...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%URL%'.TrimEnd('/'); $ok=$false; 1..4|%%{try{$r=Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 ($u+'/api/health?_client='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds());if($r.ok -eq $true -and [string]$r.product -eq 'NUNES Company Platform'){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500};if($ok){exit 0}else{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [NOT CONNECTED] Tailscale is installed, but this PC cannot reach:
  echo   %URL%
  echo.
  echo Testing the main-server Tailscale address...
  "%TS_EXE%" ping 100.97.196.17
  echo.
  echo On the MAIN SERVER PC confirm NUNES is running and run
  echo D_FIX_STAFF_TAILSCALE_ACCESS.bat once as Administrator if needed.
  pause
  exit /b 1
)

echo [3/4] Saving main-server address on this PC...
if not exist "%LOCALAPPDATA%\NUNES Operations" mkdir "%LOCALAPPDATA%\NUNES Operations" >nul 2>&1
>"%LOCALAPPDATA%\NUNES Operations\client-server-url.txt" echo %URL%

for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create-desktop-shortcut.ps1" -Root "%NUNES_ROOT%" -ClientOnly >nul
if errorlevel 1 (
  echo Could not create the NUNES Operations desktop shortcut.
  pause
  exit /b 1
)

echo [4/4] READY.
echo.
echo Staff/owner PC now uses ONLY the main server:
echo   %URL%
echo No server, Node, npm, code ZIP, Gmail setup or WhatsApp setup is required here.
echo Future main-server updates are received automatically in the browser.
echo.
if exist "%~dp0OPEN_NUNES_DESKTOP.bat" (call "%~dp0OPEN_NUNES_DESKTOP.bat") else (call "%~dp02_OPEN_NUNES_DESKTOP.bat")
exit /b 0
