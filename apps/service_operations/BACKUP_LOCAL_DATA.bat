@echo off
setlocal
pushd "%~dp0"
if not exist backups mkdir backups
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TS=%%T
powershell -NoProfile -Command "Compress-Archive -Path 'data\*' -DestinationPath ('backups\ServiceFlow_Backup_%TS%.zip') -Force"
if errorlevel 1 (
  echo Backup failed.
) else (
  echo Backup created: backups\ServiceFlow_Backup_%TS%.zip
)
pause
popd
