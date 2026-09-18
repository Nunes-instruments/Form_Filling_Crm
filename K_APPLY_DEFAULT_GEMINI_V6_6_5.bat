@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES - GEMINI DEFAULT SELF-HEAL V6.6.5

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================================
echo   NUNES V6.6.5 - GEMINI DEFAULT + CLEAN RESIDENT RESTART
echo ============================================================
echo.
echo Fixes the V6.6.4 issue where the API key was saved correctly,
echo but the already-running Servicing process was not actually stopped.
echo No Purchasing or Servicing data is deleted.
echo.

for %%I in ("%~dp0.") do set "NUNES_ROOT=%%~fI"
set "NUNES_SECRET=%~dp0LOCAL_ONLY_SECRETS\gemini-default.key"

if not exist "%NUNES_SECRET%" (
  echo [ERROR] Local-only Gemini bootstrap secret is missing.
  echo Re-extract this V6.6.5 ZIP and run this BAT again.
  pause
  exit /b 1
)

echo [1/5] Saving the owner default key to persistent local storage...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configure-gemini.ps1" -Root "%NUNES_ROOT%" -DefaultKeyFile "%NUNES_SECRET%" -NonInteractive -ForceDefault
if errorlevel 1 goto :fail

echo.
echo [2/5] Updating the resident launcher with V6.6.5 self-heal logic...
set "RESIDENT_DIR=%LOCALAPPDATA%\NUNES Operations\ServicingResident"
if not exist "%RESIDENT_DIR%" mkdir "%RESIDENT_DIR%" >nul 2>&1
copy /y "%~dp0tools\start-servicing-resident.ps1" "%RESIDENT_DIR%\start-servicing-resident.ps1" >nul
if errorlevel 1 (
  echo [ERROR] Could not update the local Servicing resident launcher.
  goto :fail
)

echo.
echo [3/5] Forcing the OLD port-5055 process to stop, then starting a fresh resident...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\restart-servicing-resident.ps1" -Port 5055 -WaitSeconds 15
if errorlevel 1 goto :fail

echo.
echo [4/5] Checking Gemini status and making a live API test call...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $g=Invoke-RestMethod -TimeoutSec 6 ('http://127.0.0.1:5055/api/forms/gemini-status?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); Write-Host ('Model      : '+$g.model) -ForegroundColor Cyan; Write-Host ('Configured : '+$g.configured) -ForegroundColor Cyan; if(-not $g.configured){throw 'Gemini is still not configured after a clean restart.'}; $t=Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 25 ('http://127.0.0.1:5055/api/forms/gemini-test?_v='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); if(-not $t.ok){throw ('Gemini live test failed: '+$t.error)}; Write-Host ('Live Test  : OK ('+$t.model+')') -ForegroundColor Green"
if errorlevel 1 goto :fail

echo.
echo [5/5] Removing the plaintext bootstrap copy from this extracted folder...
del /f /q "%NUNES_SECRET%" >nul 2>&1

echo.
echo ============================================================
echo [OK] GEMINI DEFAULT IS ACTIVE.
echo [OK] Servicing resident was CLEANLY restarted.
echo [OK] Staff PCs only need Refresh / Ctrl+R.
echo [OK] Existing company data was not deleted.
echo ============================================================
echo.
start "" "http://127.0.0.1:8795/forms/servicing?_gemini=v665"
pause
exit /b 0

:fail
echo.
echo [ERROR] V6.6.5 Gemini self-heal did not finish.
echo The plaintext bootstrap key has NOT been deleted so you can retry.
echo Send this complete window to ChatGPT.
pause
exit /b 1
