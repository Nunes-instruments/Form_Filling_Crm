@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cls
echo ============================================================
echo   A - STOP OLD OWNER SERVER AND EXPORT NUNES DATA
echo ============================================================
echo This stops ONLY NUNES scheduled server tasks on this old PC.
echo Business data is COPIED, not deleted.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\export-old-main-server.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo ERROR: Export did not complete. Old data was not intentionally deleted.
  pause
  exit /b 1
)
echo.
pause
