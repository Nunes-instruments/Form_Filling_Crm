@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - One Click Auto Update Repair
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
  exit /b %errorlevel%
)
cls
echo ============================================================
echo      NUNES V6.5.4 - ONE CLICK MASTER AUTO UPDATE FIX
echo ============================================================
echo.
echo You may run this directly from THIS PATCH folder.
echo It will find the existing Form_Filling_Crm Git master folder,
echo copy only the auto-update control files, and enable the watcher.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\find-and-apply-master.ps1" -PatchRoot "%~dp0."
if errorlevel 1 (
  echo.
  echo [ERROR] Setup did not complete.
  echo No company data was intentionally deleted.
  pause
  exit /b 1
)
echo.
echo ============================================================
echo DONE
echo GitHub auto watcher is enabled on the REAL master folder.
echo Staff and owner PCs do not need this patch.
echo ============================================================
echo.
pause
exit /b 0
