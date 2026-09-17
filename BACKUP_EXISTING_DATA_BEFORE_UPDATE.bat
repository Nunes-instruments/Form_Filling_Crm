@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\BACKUP_EXISTING_DATA_BEFORE_UPDATE.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Data backup failed. Do not replace the application yet.
  pause
  exit /b 1
)
echo.
echo Company data backup completed safely.
pause
