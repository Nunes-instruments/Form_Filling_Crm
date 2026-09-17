@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-servicing-speed.ps1"
echo.
pause
