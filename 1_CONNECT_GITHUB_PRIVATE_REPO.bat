@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Connect Form_Filling_Crm GitHub Repository
cls
echo ============================================================
echo           CONNECT THIS MASTER FOLDER TO GITHUB
echo ============================================================
echo Repository: https://github.com/Nunes-instruments/Form_Filling_Crm.git
echo.
where git.exe >nul 2>&1 || (echo Git is not installed.& pause & exit /b 2)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-git-master.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo [ERROR] GitHub connection preparation failed.
  pause
  exit /b 1
)
echo.
echo [OK] This folder is connected safely to Form_Filling_Crm/main.
echo Run J_PUBLISH_LIVE_AND_GITHUB.bat to apply live and push the current full version.
pause
exit /b 0
