@echo off
setlocal
cd /d "%~dp0"
title NUNES Owner - Old Data Cleanup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\owner-clean-old-data.ps1" -Root "%~dp0."
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Cleanup ended with error code %RC%.
echo Press any key to close.
pause >nul
exit /b %RC%
