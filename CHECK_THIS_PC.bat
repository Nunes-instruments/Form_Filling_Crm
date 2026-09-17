@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0"
cls
echo ============================================================
echo       NUNES - THIS PC COMPATIBILITY CHECK
echo ============================================================
echo.
ver
wmic os get osarchitecture 2>nul | findstr /V /I "OSArchitecture" 2>nul
if errorlevel 1 echo Architecture: %PROCESSOR_ARCHITECTURE%
echo.
where powershell >nul 2>&1 && (echo [OK] Windows PowerShell) || (echo [ERROR] PowerShell missing)
where netstat >nul 2>&1 && (echo [OK] Windows networking tools) || (echo [ERROR] netstat missing)
where msedge >nul 2>&1 && (echo [OK] Microsoft Edge detected) || echo [INFO] Edge command not in PATH - normal on many PCs
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" echo [OK] Microsoft Edge installed
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" echo [OK] Microsoft Edge installed
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" echo [OK] Google Chrome installed
set "T=%TEMP%\nunes_write_%RANDOM%.tmp"
>"%T%" echo ok 2>nul
if exist "%T%" (echo [OK] User TEMP folder writable&del /q "%T%") else echo [ERROR] User TEMP folder is not writable
>".nunes_write_test.tmp" echo ok 2>nul
if exist ".nunes_write_test.tmp" (echo [OK] Extracted NUNES folder writable&del /q ".nunes_write_test.tmp") else echo [ERROR] This NUNES folder is read-only - extract it to a normal local folder
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 https://www.python.org/ -Method Head|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (echo [INFO] Internet test failed - first-time runtime/package setup may need internet) else echo [OK] Internet available for first-time setup

echo.
echo If the checks above are OK, run START_NUNES_COMPANY.bat.
pause
popd
