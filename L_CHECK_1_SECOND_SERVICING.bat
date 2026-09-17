@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo       NUNES SERVICING - 1 SECOND SPEED CHECK
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-servicing-speed.ps1"
echo.
pause
