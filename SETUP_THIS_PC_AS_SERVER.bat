@echo off
setlocal
title Set up this PC as the NUNES Always-On Server
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Cannot open the NUNES setup folder.
  pause
  exit /b 1
)
cls
echo ============================================================
echo        SET UP THIS PC AS NUNES ALWAYS-ON SERVER
echo ============================================================
echo This one-time setup will:
echo - start NUNES automatically after Windows sign-in
echo - check/restart the server every 5 minutes if needed
echo - keep Purchasing and Servicing data on this server PC
echo - allow office devices through Windows Firewall
echo - create a NUNES Operations desktop shortcut
echo.
echo Windows will ask for Administrator permission. Choose Yes.
echo.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  popd
  exit /b
)
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configure-office-server.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo ERROR: Server setup was not completed. Run this file again and choose Yes.
  pause
  popd
  exit /b 1
)
echo.
echo Setup complete. Waiting for the shared server link...
set "ACTIVE_ROOT=%NUNES_ROOT%"
set "ROOT_POINTER=%LOCALAPPDATA%\NUNES Operations\workspace-root.txt"
if exist "%ROOT_POINTER%" (
  for /f "usebackq delims=" %%R in ("%ROOT_POINTER%") do if not "%%R"=="" set "ACTIVE_ROOT=%%R"
)
for /L %%I in (1,1,60) do (
  if exist "%ACTIVE_ROOT%\OPEN_ON_OTHER_DEVICES.txt" goto :READY
  timeout /t 1 /nobreak >nul
)
:READY
if exist "%ACTIVE_ROOT%\OPEN_ON_OTHER_DEVICES.txt" (
  type "%ACTIVE_ROOT%\OPEN_ON_OTHER_DEVICES.txt"
  copy /y "%ACTIVE_ROOT%\OPEN_ON_OTHER_DEVICES.txt" "%~dp0OPEN_ON_OTHER_DEVICES.txt" >nul 2>&1
  start "" notepad.exe "%ACTIVE_ROOT%\OPEN_ON_OTHER_DEVICES.txt"
) else (
  echo Server is starting. Use the NUNES Operations desktop shortcut when ready.
)
popd
pause
