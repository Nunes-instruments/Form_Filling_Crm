@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Connect Form_Filling_Crm GitHub Repository
cls
echo ============================================================
echo           CONNECT THIS MASTER FOLDER TO GITHUB
echo ============================================================
echo GitHub account detected for this project: Nunes-instruments
echo GitHub repository: Nunes-instruments/Form_Filling_Crm
echo.

where git.exe >nul 2>&1 || (echo Git is not installed.& pause & exit /b 2)
if not exist ".git" (
  echo Run 0_FIRST_TIME_VSCODE_MAIN_SERVER.bat first.
  pause
  exit /b 2
)

for /f "delims=" %%I in ('git remote get-url origin 2^>nul') do set "EXISTING=%%I"
if defined EXISTING (
  echo Already connected:
  echo   %EXISTING%
  echo.
  choice /C YN /N /M "Replace this GitHub remote? [Y/N]: "
  if errorlevel 2 exit /b 0
  git remote remove origin
)

echo Connecting to the permanent NUNES GitHub repository:
set "REPO=https://github.com/Nunes-instruments/Form_Filling_Crm.git"
echo   %REPO%
echo.
git remote add origin "%REPO%"
if errorlevel 1 goto :FAIL

echo Checking that secrets are excluded from Git...
git check-ignore -q LOCAL_ONLY_SECRETS\google_oauth_client.json
if errorlevel 1 (
  echo [BLOCKED] Secret protection failed. GitHub push was NOT attempted.
  git remote remove origin
  pause
  exit /b 1
)

git add -A
git diff --cached --name-only | findstr /I /R "LOCAL_ONLY_SECRETS google_oauth_client.json client_secret.*json" >nul
if not errorlevel 1 (
  echo [BLOCKED] A private Google credential appears staged. GitHub push was NOT attempted.
  git reset >nul
  pause
  exit /b 1
)

git commit -m "Connect NUNES single-source workspace" >nul 2>&1

echo Pushing main branch. Git/VS Code may open a browser sign-in once.
git push -u origin main
if errorlevel 1 goto :FAIL

echo.
echo [OK] GitHub is connected.
pause
exit /b 0
:FAIL
echo.
echo [ERROR] GitHub connection/push failed.
echo The live NUNES server and company data were not changed.
pause
exit /b 1
