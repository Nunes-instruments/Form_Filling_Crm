@echo off
setlocal EnableExtensions
rem V5 SPEED-ONLY: use the locally installed resident launcher first. After one-time
rem server setup this path does not touch the shared/NAS project folder at all.
set "RESIDENT=%LOCALAPPDATA%\NUNES Operations\ServicingResident\start-servicing-resident.ps1"
if exist "%RESIDENT%" (
  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%RESIDENT%" -Port 5055 >nul 2>&1
  exit /b %ERRORLEVEL%
)
set "ROOT=%~dp0.."
for %%D in ("%ROOT%") do set "ROOT=%%~fD"
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%ROOT%\tools\start-servicing-local-fast.ps1" -Root "%ROOT%" >nul 2>&1
exit /b %ERRORLEVEL%
