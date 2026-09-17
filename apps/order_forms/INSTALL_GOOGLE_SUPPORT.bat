@echo off
setlocal EnableExtensions EnableDelayedExpansion
title NUNES FORM WORKFLOW - GOOGLE SUPPORT
pushd "%~dp0" >nul 2>nul
if errorlevel 1 exit /b 1

echo ==========================================================
echo    NUNES FORM WORKFLOW - GOOGLE DRIVE / SHEETS SUPPORT
echo ==========================================================
echo.
echo Normal Task Board use does NOT need this installer.
echo Google packages are also installed automatically on the first enabled sync.
echo Run this only if you want to prepare Google support in advance.
echo.

set "PYEXE="
for %%P in ("%LocalAppData%\Programs\Python\Python313\python.exe" "%LocalAppData%\Programs\Python\Python312\python.exe" "%LocalAppData%\Programs\Python\Python311\python.exe" "%LocalAppData%\Programs\Python\Python310\python.exe") do if not defined PYEXE if exist "%%~P" set "PYEXE=%%~P"
if not defined PYEXE for /f "delims=" %%P in ('where python.exe 2^>nul') do if not defined PYEXE set "PYEXE=%%P"
if not defined PYEXE (
  echo Python was not found. Run START_SERVER.bat first.
  pause
  popd
  exit /b 1
)

if not exist ".nunes_runtime\site-packages" mkdir ".nunes_runtime\site-packages" >nul 2>nul
if not exist ".nunes_runtime\pip-cache" mkdir ".nunes_runtime\pip-cache" >nul 2>nul
"%PYEXE%" -m pip install --disable-pip-version-check --no-warn-script-location --prefer-binary --no-compile --cache-dir ".nunes_runtime\pip-cache" --target ".nunes_runtime\site-packages" -r requirements_google.txt
if errorlevel 1 (
  echo.
  echo Google support installation failed. Check internet access and retry.
  pause
  popd
  exit /b 1
)
echo.
echo Google Drive / Google Sheets support is ready.
pause
popd
