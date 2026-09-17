@echo off
setlocal EnableExtensions
title NUNES FORM WORKFLOW - FAST RUNTIME REPAIR
pushd "%~dp0" >nul 2>nul
if errorlevel 1 exit /b 1

echo ==========================================================
echo      NUNES FORM WORKFLOW - RUNTIME REPAIR
echo ==========================================================
echo.
echo This repairs ONLY the local package runtime.
echo Your database, orders, reports, PDFs, Excel and settings are kept.
echo.
if exist ".nunes_runtime\site-packages" rmdir /S /Q ".nunes_runtime\site-packages" >nul 2>nul
if exist ".nunes_runtime\core_v1011.ok" del /Q ".nunes_runtime\core_v1011.ok" >nul 2>nul
if exist ".venv" (
  echo Removing obsolete old .venv from earlier versions...
  attrib -R -S -H ".venv" /S /D >nul 2>nul
  rmdir /S /Q ".venv" >nul 2>nul
)
echo Runtime reset complete. Starting automatic setup...
echo.
call START_SERVER.bat
popd
