@echo off
setlocal
title Fix NUNES Network NTFS Startup Error
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Cannot open this NUNES folder.
  pause
  exit /b 1
)
echo ============================================================
echo   NUNES - FIX NETWORK / NTFS STARTUP ERROR
echo ============================================================
echo.
echo This will run the normal owner-server setup and move the

echo active runtime to the owner PC local disk when this package

echo is stored on a network/shared folder.
echo.
call "%~dp01_SETUP_ALWAYS_ON_SERVER.bat"
set "RC=%errorlevel%"
popd
exit /b %RC%
