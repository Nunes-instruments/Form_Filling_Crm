@echo off
setlocal EnableExtensions
pushd "%~dp0" >nul 2>nul
if errorlevel 1 exit /b 1
if not exist "backups" mkdir "backups"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "stamp=%%I"
if "%stamp%"=="" set "stamp=backup"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'data\*' -DestinationPath 'backups\NUNES_DATA_%stamp%.zip' -Force"
if errorlevel 1 (
  echo Backup failed.
) else (
  echo Backup created: backups\NUNES_DATA_%stamp%.zip
)
pause
popd
