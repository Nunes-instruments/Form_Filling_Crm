@echo off
setlocal
pushd "%~dp0"
title Rebuild ServiceFlow
set "NEXT_TELEMETRY_DISABLED=1"
echo Rebuilding ServiceFlow after source-code changes...
if exist ".next" rmdir /s /q ".next"
node "node_modules\next\dist\bin\next" build
if errorlevel 1 (
  echo BUILD FAILED.
  pause
  popd
  exit /b 1
)
if exist "SOURCE_SIGNATURE.txt" copy /y "SOURCE_SIGNATURE.txt" "data\build.signature" >nul
echo Build completed. Run START_SERVICE_JOB_APP.bat.
pause
popd
