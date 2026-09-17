@echo off
setlocal
cls
echo ============================================================
echo          RESET NUNES WHATSAPP WEB LINK
echo ============================================================
echo.
echo This removes ONLY the saved WhatsApp Web linked browser login.
echo It does NOT delete Service jobs, Purchasing records, reports or attachments.
echo.
set /p CONFIRM=Type RESET to continue: 
if /I not "%CONFIRM%"=="RESET" exit /b 0
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "try{Invoke-RestMethod -Method Post -TimeoutSec 5 'http://127.0.0.1:5056/logout'|Out-Null}catch{}" >nul 2>&1
if exist "%LOCALAPPDATA%\ServiceFlow\whatsapp-web-link\auth" rmdir /S /Q "%LOCALAPPDATA%\ServiceFlow\whatsapp-web-link\auth" >nul 2>&1
if exist "%LOCALAPPDATA%\ServiceFlow\whatsapp-web-link\linked.json" del /Q "%LOCALAPPDATA%\ServiceFlow\whatsapp-web-link\linked.json" >nul 2>&1
schtasks /Run /TN "NUNES WhatsApp Resident" >nul 2>&1
echo.
echo WhatsApp Web link cleared.
echo Open NUNES Settings and click Open WhatsApp Web Login to link once again.
pause
