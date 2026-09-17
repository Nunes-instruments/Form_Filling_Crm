@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Apply VS Code Changes Live

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================================
echo          APPLY THIS MASTER FOLDER TO LIVE SERVER
echo ============================================================
echo This is the normal button after you edit code in VS Code.
echo Staff/owner PCs do NOT need a ZIP or code update.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo [ERROR] Live update failed. Existing persistent data was not intentionally deleted.
  pause
  exit /b 1
)

echo.
echo [OK] LIVE UPDATE COMPLETE.
echo Open staff/owner dashboards will refresh automatically after the new server is ready.
echo.
pause
exit /b 0
