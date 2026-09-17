@echo off
setlocal EnableExtensions
cd /d "%~dp0"
cls
echo ====================================================
echo      NUNES - CONFIGURE GEMINI FORM READER
echo ====================================================
echo.
echo Gemini is already configured with the default key in this build.
echo Press ENTER at the secure prompt to keep that key,
echo or paste a replacement key to change it.
echo.
for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configure-gemini.ps1" -Root "%NUNES_ROOT%"
if errorlevel 1 (
  echo.
  echo Gemini setup failed.
  pause
  exit /b 1
)
echo.
echo Start NUNES normally with START_NUNES_COMPANY.bat
echo.
pause
