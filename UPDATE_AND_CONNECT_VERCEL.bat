@echo off
setlocal EnableExtensions
pushd "%~dp0" >nul 2>&1
if errorlevel 1 exit /b 1
cls
echo ============================================================
echo   NUNES V6.4.7 - UPDATE VERCEL + CONNECT LIVE DATA
echo ============================================================
echo This updates the SAME Vercel project and then starts the local
echo data bridge. Existing Purchasing and Servicing records remain
echo outside the web deployment and are not deleted.
echo.
call "%CD%\UPDATE_EXISTING_VERCEL.bat"
if errorlevel 1 (
  echo.
  echo Vercel update did not complete. Live production was not replaced.
  pause
  popd
  exit /b 1
)
echo.
echo Starting the Vercel data bridge...
call "%CD%\START_VERCEL_DATA_BRIDGE.bat"
popd
exit /b 0
