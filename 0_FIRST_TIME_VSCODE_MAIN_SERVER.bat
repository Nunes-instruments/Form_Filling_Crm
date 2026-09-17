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
echo It keeps this extracted folder as the single source of truth.
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

if not exist "%~dp0.git" (
  echo [1/4] Creating local Git repository...
  git init -b main
  if errorlevel 1 goto :FAIL
  for /f "delims=" %%I in ('git config user.name 2^>nul') do set "GITNAME=%%I"
  if not defined GITNAME git config user.name "Nunes Instruments"
  for /f "delims=" %%I in ('git config user.email 2^>nul') do set "GITEMAIL=%%I"
  if not defined GITEMAIL git config user.email "307533164+Nunes-instruments@users.noreply.github.com"
  git add -A
  git commit -m "NUNES Operations baseline v6.5.1"
  if errorlevel 1 echo [INFO] Git repository created. No baseline commit was needed or Git reported a commit warning.
) else (
  echo [1/4] Existing Git repository kept.
)

rem Permanent GitHub single-source repository
for /f "delims=" %%I in ('git remote get-url origin 2^>nul') do set "EXISTING_REMOTE=%%I"
if not defined EXISTING_REMOTE (
  git remote add origin "https://github.com/Nunes-instruments/Form_Filling_Crm.git" >nul 2>&1
)

echo [2/4] Installing this folder as the NUNES main server...
call "%~dp0B_MAKE_THIS_PC_MAIN_SERVER.bat"
if errorlevel 1 goto :FAIL

echo [3/4] Preparing VS Code workspace...
where code.cmd >nul 2>&1
if not errorlevel 1 start "" code "%~dp0NUNES.code-workspace"
if errorlevel 1 echo [INFO] VS Code command was not found in PATH. Open this folder manually in VS Code.

echo [4/4] READY.
echo.
echo NEXT TIME:
echo   Edit this SAME folder in VS Code.
echo   Run F_APPLY_VSCODE_CHANGES_LIVE.bat to publish changes to staff/owner.
echo   Run G_SAVE_TO_GITHUB.bat to save a version to GitHub.
echo.
echo GitHub account: Nunes-instruments
if not exist "%~dp0.git\config" goto :DONE
for /f "delims=" %%I in ('git remote get-url origin 2^>nul') do set "REMOTE=%%I"
if defined REMOTE echo GitHub remote: %REMOTE%
if not defined REMOTE echo GitHub remote should be Form_Filling_Crm. Run 1_CONNECT_GITHUB_PRIVATE_REPO.bat if it needs repair.
:DONE
pause
exit /b 0
:FAIL
echo.
echo [ERROR] First-time setup did not complete.
pause
exit /b 1
