@echo off
setlocal EnableDelayedExpansion
echo Stopping NUNES local services...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName 'NUNES GitHub Auto Update' -ErrorAction SilentlyContinue" >nul 2>&1
for %%P in (5055 5056 8770 8795 8865) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do taskkill /PID %%I /T /F >nul 2>&1
)
echo Done.
pause
