@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title NUNES - Publish Live and GitHub
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
  exit /b %errorlevel%
)
cls
echo ============================================================
echo       NUNES - ONE BUTTON PUBLISH: LIVE + GITHUB
echo ============================================================
echo 1. Auto-connect THIS folder to Form_Filling_Crm if needed.
echo 2. Verify/build/apply on THIS main server.
echo 3. Staff/owner pages receive the new rollout automatically.
echo 4. Save the same working source to Form_Filling_Crm/main.
echo.
where git.exe >nul 2>&1 || (echo [ERROR] Git is not installed.& pause & exit /b 2)

echo [PRECHECK] Confirming this is the COMPLETE product folder...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\assert-full-source.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo [STOPPED] You are running from a patch/incomplete folder.
  echo No Git setup, live update, commit, or push was attempted.
  pause
  exit /b 12
)

echo [0/4] Checking the one master Git folder...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-git-master.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo [ERROR] Could not prepare this folder as the NUNES Git master.
  echo Your live company data was not intentionally deleted.
  pause
  exit /b 2
)

echo [1/4] Applying your VS Code changes to the live main server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-main-server-update.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo [STOPPED] Live verification failed. Nothing will be pushed to GitHub.
  pause
  exit /b 1
)

echo [2/4] Preparing safe Git commit...
git check-ignore -q --no-index LOCAL_ONLY_SECRETS/google_oauth_client.json
if errorlevel 1 (
  echo [BLOCKED] Secret protection is not active. Nothing was pushed.
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
  echo [INFO] No new source changes to commit.
) else (
  git commit -m "NUNES live update %date% %time:~0,5%"
  if errorlevel 1 goto :FAIL
)

echo [3/4] Synchronizing with GitHub main safely...
git fetch origin main --prune
if errorlevel 1 goto :FAIL
for /f "delims=" %%I in ('git rev-parse origin/main 2^>nul') do set "REMOTE_SHA=%%I"
if defined REMOTE_SHA (
  git merge-base --is-ancestor origin/main HEAD >nul 2>&1
  if errorlevel 1 (
    echo [INFO] GitHub has newer commits. Rebasing this verified update on top of them...
    git rebase origin/main
    if errorlevel 1 (
      echo.
      echo [ERROR] Automatic rebase stopped because the same code was changed in two places.
      echo Run: git rebase --abort
      echo Then resolve the code difference in VS Code before publishing again.
      pause
      exit /b 1
    )
  )
)

echo [4/4] Pushing the working version to GitHub main...
git push -u origin main
if errorlevel 1 goto :FAIL

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-github-auto-update.ps1" -Root "%~dp0." -Quiet
if errorlevel 1 echo [WARN] Live/GitHub publish succeeded, but auto watcher registration needs attention.

echo.
echo ============================================================
echo DONE
echo Main server : UPDATED
echo GitHub      : UPDATED - Nunes-instruments/Form_Filling_Crm
echo Staff/Owner : AUTO REFRESH / latest version on next open
echo ============================================================
pause
exit /b 0
:FAIL
echo.
echo [ERROR] GitHub synchronization/push failed.
echo The verified live server remains running. Company data was not deleted.
echo If GitHub opens a browser sign-in, complete it and run this file again.
pause
exit /b 1
