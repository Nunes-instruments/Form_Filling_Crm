@echo off
setlocal EnableExtensions
cd /d "%~dp0"
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\open-nunes-desktop.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo NUNES could not open. See the message above.
  pause
  exit /b 1
)
exit /b 0
