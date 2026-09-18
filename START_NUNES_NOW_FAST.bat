@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo NUNES Operations - FAST DAILY OPEN
call "%~dp0OPEN_NUNES_DESKTOP.bat"
exit /b %ERRORLEVEL%
