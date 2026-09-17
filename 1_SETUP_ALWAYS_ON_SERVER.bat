@echo off
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Cannot open the NUNES setup folder.
  pause
  exit /b 1
)
call "%~dp0SETUP_THIS_PC_AS_SERVER.bat"
set "RC=%errorlevel%"
popd
exit /b %RC%
