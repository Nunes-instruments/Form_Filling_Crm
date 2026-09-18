@echo off
cd /d "%~dp0"
call "%~dp00_REPAIR_AND_START_MAIN_SERVER.bat"
exit /b %errorlevel%
