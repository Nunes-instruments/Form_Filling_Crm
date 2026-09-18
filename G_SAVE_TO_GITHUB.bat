@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title NUNES - Save Version to GitHub
cls
echo ============================================================
echo                SAVE NUNES VERSION TO GITHUB
echo ============================================================
where git.exe >nul 2>&1 || (echo Git is not installed.& pause & exit /b 2)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\assert-full-source.ps1" -Root "%~dp0."
if errorlevel 1 (echo [STOPPED] Use the complete NUNES master folder, not a patch folder.& pause & exit /b 12)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-git-master.ps1" -Root "%~dp0."
if errorlevel 1 (echo [ERROR] Git master preparation failed.& pause & exit /b 2)

git check-ignore -q --no-index LOCAL_ONLY_SECRETS/google_oauth_client.json
if errorlevel 1 (
  echo [BLOCKED] Private-secret protection is not active. Nothing was pushed.
  pause
  exit /b 1
)

git add -A
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-staged-git-safety.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo [BLOCKED] Private data or credentials are staged. Nothing was pushed.
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
git fetch origin main --prune
if errorlevel 1 goto :FAIL
git merge-base --is-ancestor origin/main HEAD >nul 2>&1
if errorlevel 1 (
  git rebase origin/main
  if errorlevel 1 goto :REBASEFAIL
)
git push -u origin main
if errorlevel 1 goto :FAIL

echo.
echo [OK] Version saved to GitHub Form_Filling_Crm/main.
pause
exit /b 0
:REBASEFAIL
echo.
echo [ERROR] GitHub has conflicting changes. Run git rebase --abort, resolve in VS Code, then retry.
pause
exit /b 1
:FAIL
echo.
echo [ERROR] GitHub save failed. Live server/data were not changed by this script.
pause
exit /b 1
