@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Update Main Server and Auto Rollout
cls

echo ============================================================
echo        NUNES MAIN SERVER - ONE CLICK AUTO UPDATE
echo ============================================================
echo Run this file ONLY on the MAIN SERVER PC.
echo.
echo Future update method:
echo   1. Extract the new NUNES ZIP on the MAIN SERVER PC.
echo   2. Run THIS file from the new folder.
echo   3. Staff and owner PCs update automatically from the server.
echo.
echo No ZIP or code copy is required on staff/owner PCs after their
echo one-time 3_CONNECT_THIS_PC_TO_SHARED_SERVER.bat setup.
echo Port 8765 is not used by this NUNES server.
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permission...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo [ERROR] NUNES update did not complete.
  echo Existing persistent company data was not intentionally deleted.
  echo Keep this window open and send a screenshot of the error.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo READY - MAIN SERVER UPDATED + AUTO ROLLOUT ENABLED
echo ============================================================
echo Staff and owner PCs will use the new version automatically.
echo.
pause
exit /b 0
