@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title NUNES - Save Version to GitHub
cls
echo ============================================================
echo                SAVE NUNES VERSION TO GITHUB
echo ============================================================
where git.exe >nul 2>&1 || (echo Git is not installed.& pause & exit /b 2)
if not exist ".git" (echo Run 0_FIRST_TIME_VSCODE_MAIN_SERVER.bat first.& pause & exit /b 2)

for /f "delims=" %%I in ('git remote get-url origin 2^>nul') do set "REMOTE=%%I"
if not defined REMOTE (
  echo GitHub is not connected yet.
  echo Run 1_CONNECT_GITHUB_PRIVATE_REPO.bat once.
  pause
  exit /b 2
)

git check-ignore -q LOCAL_ONLY_SECRETS\google_oauth_client.json
if errorlevel 1 (
  echo [BLOCKED] Private-secret protection is not active. Nothing was pushed.
  pause
  exit /b 1
)

git add -A
git diff --cached --name-only | findstr /I /R "LOCAL_ONLY_SECRETS google_oauth_client.json client_secret.*json" >nul
if not errorlevel 1 (
  echo [BLOCKED] A Google credential is staged. Nothing was pushed.
  git reset >nul
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo No new code changes to save.
  pause
  exit /b 0
)

set "MSG="
set /p "MSG=Version note [Enter = NUNES update]: "
if not defined MSG set "MSG=NUNES update"
git commit -m "%MSG%"
if errorlevel 1 goto :FAIL
git push origin main
if errorlevel 1 goto :FAIL

echo.
echo [OK] Version saved to GitHub.
pause
exit /b 0
:FAIL
echo.
echo [ERROR] GitHub save failed. Live server/data were not changed by this script.
pause
exit /b 1
