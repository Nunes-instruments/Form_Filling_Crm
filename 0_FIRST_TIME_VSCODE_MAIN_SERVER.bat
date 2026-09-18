@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - First Time VS Code Main Server Setup
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cls
echo ============================================================
echo      NUNES - ONE MASTER FOLDER / VS CODE / MAIN SERVER
echo ============================================================
echo This runs ONCE on the MAIN SERVER PC.
echo This same folder becomes the permanent Git + VS Code source.
echo.
where git.exe >nul 2>&1
if errorlevel 1 (
  echo [ACTION NEEDED] Git for Windows is not installed.
  echo Install Git, then run this file again.
  start "" "https://git-scm.com/download/win"
  pause
  exit /b 2
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-local-google-secret.ps1" -Root "%~dp0."
if errorlevel 1 goto :FAIL

echo [1/5] Connecting this full product folder safely to Form_Filling_Crm...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-git-master.ps1" -Root "%~dp0."
if errorlevel 1 goto :FAIL

echo [2/5] Installing this folder as the NUNES main server...
call "%~dp0B_MAKE_THIS_PC_MAIN_SERVER.bat"
if errorlevel 1 goto :FAIL

echo [3/5] Enabling automatic GitHub-to-main-server updates...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-github-auto-update.ps1" -Root "%~dp0." -Quiet
if errorlevel 1 goto :FAIL

echo [4/5] Preparing VS Code workspace...
where code.cmd >nul 2>&1
if not errorlevel 1 start "" code "%~dp0NUNES.code-workspace"
if errorlevel 1 echo [INFO] VS Code command was not found in PATH. Open this folder manually in VS Code.

echo [5/5] READY.
echo.
echo NEXT TIME:
echo   Edit this SAME folder in VS Code.
echo   Run J_PUBLISH_LIVE_AND_GITHUB.bat.
echo   Staff/Owner PCs update from the main server automatically.
echo   GitHub changes made elsewhere are checked every minute.
echo.
echo GitHub: https://github.com/Nunes-instruments/Form_Filling_Crm.git
pause
exit /b 0
:FAIL
echo.
echo [ERROR] First-time setup did not complete.
echo Existing company data was not intentionally deleted.
pause
exit /b 1
