@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0" >nul 2>&1
set "APP=%CD%\apps\service_operations"
echo ============================================================
echo NUNES V6.4.1 - SERVICING START SPEED TEST
echo ============================================================
echo.
set "PORT=5055"
set "NUNES_EMBEDDED=1"
set "NEXT_TELEMETRY_DISABLED=1"
set "START_MS="
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()"') do set "START_MS=%%T"
start "ServiceFlow Speed Test" /min cmd /d /c "call ""%APP%\START_EMBEDDED_FAST.bat"""
set "READY_MS="
for /L %%I in (1,1,200) do (
  powershell -NoProfile -Command "try{$r=Invoke-RestMethod -TimeoutSec 0.2 http://127.0.0.1:5055/api/health;if($r.ok -eq $true -and [string]$r.app -eq 'ServiceFlowJobCards'){exit 0}}catch{};exit 1" >nul 2>&1
  if not errorlevel 1 (
    for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()"') do set "READY_MS=%%T"
    goto :DONE
  )
  powershell -NoProfile -Command "Start-Sleep -Milliseconds 50" >nul 2>&1
)
:DONE
if defined READY_MS (
  set /a ELAPSED=READY_MS-START_MS
  echo Servicing health ready in approximately !ELAPSED! ms.
  echo Target after one-time setup: under 1000 ms for repeat start/open.
) else (
  echo Servicing did not become ready during the test window.
  echo Run START_NUNES_COMPANY.bat once to complete the one-time setup/build.
)
echo.
pause
popd
