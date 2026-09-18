@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title NUNES FINAL V6.5.9 - MAIN SERVER PUBLISH
cls
echo ============================================================
echo      NUNES V6.5.9 - FINAL FULL SOURCE + 1 SECOND SERVICING - START HERE
echo ============================================================
echo This FULL folder becomes the permanent master folder.
echo Do not run publish from any PATCH folder.
echo.
call "%~dp0J_PUBLISH_LIVE_AND_GITHUB.bat"
exit /b %errorlevel%
