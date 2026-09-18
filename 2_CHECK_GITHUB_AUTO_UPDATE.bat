@echo off
cd /d "%~dp0"
title NUNES - GitHub Auto Update Status
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check-github-single-source.ps1" -Root "%~dp0."
echo.
pause
