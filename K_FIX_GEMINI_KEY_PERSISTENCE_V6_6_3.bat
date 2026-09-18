@echo off
setlocal
cd /d "%~dp0"
call "%~dp0K_APPLY_DEFAULT_GEMINI_V6_6_4.bat"
exit /b %ERRORLEVEL%
