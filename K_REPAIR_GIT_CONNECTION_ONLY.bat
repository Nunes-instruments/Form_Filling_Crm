@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Repair Git Connection Only
cls
echo ============================================================
echo        NUNES - REPAIR GIT CONNECTION ONLY
echo ============================================================
echo This does NOT publish or replace company data.
echo It prepares this folder as the Form_Filling_Crm Git master.
echo.
where git.exe >nul 2>&1 || (echo [ERROR] Git for Windows is not installed.& pause & exit /b 2)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-git-master.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo [ERROR] Git connection repair failed.
  pause
  exit /b 1
)
echo.
echo [OK] Git connection is ready.
echo Next run: J_PUBLISH_LIVE_AND_GITHUB.bat
pause
exit /b 0
