@echo off
cd /d "%~dp0"
title NUNES - Push GitHub and Go Live
call "%~dp0J_PUBLISH_LIVE_AND_GITHUB.bat"
exit /b %errorlevel%
