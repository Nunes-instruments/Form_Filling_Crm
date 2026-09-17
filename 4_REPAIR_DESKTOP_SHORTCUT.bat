@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Repair NUNES Operations Desktop Shortcut
cls
echo ============================================================
echo        REPAIR NUNES OPERATIONS DESKTOP SHORTCUT
echo ============================================================
echo.
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create-desktop-shortcut.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo ERROR: The shortcut could not be repaired.
  echo Make sure this is the complete NUNES folder and try again.
  pause
  exit /b 1
)
echo.
echo Done. Double-click NUNES Operations on the Desktop.
pause
