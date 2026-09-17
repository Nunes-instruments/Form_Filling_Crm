@echo off
setlocal EnableExtensions
pushd "%~dp0" >nul 2>&1
if errorlevel 1 exit /b 0
rem V16: no artificial 3-second delay. The QR/session should already be warming.
schtasks /Run /TN "NUNES WhatsApp Resident" >nul 2>&1
if not errorlevel 1 (
  popd >nul
  exit /b 0
)
start "" /b cmd /d /c "call RUN_WHATSAPP_HIDDEN.bat" >nul 2>&1
popd >nul
exit /b 0
