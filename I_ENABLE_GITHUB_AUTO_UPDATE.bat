@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Enable GitHub Auto Update
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
  exit /b %errorlevel%
)
cls
echo ============================================================
echo          NUNES - ENABLE GITHUB AUTO UPDATE
echo ============================================================
echo Main server checks Form_Filling_Crm/main every 1 minute.
echo Staff and owner PCs do NOT need update files.
echo.
where git.exe >nul 2>&1 || (echo [ERROR] Git is not installed.& pause & exit /b 2)

echo [1/2] Preparing this folder as the one Git master...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-git-master.ps1" -Root "%~dp0."
if errorlevel 1 goto :FAIL

echo [2/2] Registering the background watcher...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-github-auto-update.ps1" -Root "%~dp0."
if errorlevel 1 goto :FAIL

echo.
echo [OK] GitHub auto update is enabled.
echo Staff/Owner PCs need no ZIP, Git or VS Code.
pause
exit /b 0
:FAIL
echo.
echo [ERROR] GitHub auto update setup failed.
echo No company data was intentionally deleted.
pause
exit /b 1
