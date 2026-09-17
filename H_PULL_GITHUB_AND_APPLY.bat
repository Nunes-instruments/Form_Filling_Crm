@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - Pull GitHub and Apply Live
cls
echo ============================================================
echo              PULL GITHUB VERSION + APPLY LIVE
echo ============================================================
where git.exe >nul 2>&1 || (echo Git is not installed.& pause & exit /b 2)
if not exist ".git" (echo This folder is not a Git repository.& pause & exit /b 2)
for /f "delims=" %%I in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY (
  echo [STOPPED] This folder has unsaved/uncommitted changes.
  echo Save/commit them first so GitHub cannot overwrite your work.
  git status --short
  pause
  exit /b 1
)

git pull --ff-only origin main
if errorlevel 1 (
  echo GitHub pull failed. Nothing was applied live.
  pause
  exit /b 1
)
call "%~dp0F_APPLY_VSCODE_CHANGES_LIVE.bat"
exit /b %ERRORLEVEL%
