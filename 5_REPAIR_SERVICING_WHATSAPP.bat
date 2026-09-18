@echo off
setlocal EnableExtensions
cd /d "%~dp0"
fltmc >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
title NUNES - Repair Servicing + WhatsApp
cls
echo ============================================================
echo    NUNES - REPAIR SERVICING + WHATSAPP ONLY (V6.5.15)
echo ============================================================
echo Main dashboard 8795 will stay independent from this repair.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\repair-optional-services.ps1" -Root "%NUNES_ROOT%"
echo.
pause
exit /b %errorlevel%
