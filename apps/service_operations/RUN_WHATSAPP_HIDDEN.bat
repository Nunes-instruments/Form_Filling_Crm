@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0" >nul 2>&1
if errorlevel 1 exit /b 1

rem V21 primary path: owner setup installs a persistent WhatsApp Web link resident.
set "WA_RESIDENT=%LOCALAPPDATA%\NUNES Operations\WhatsAppResident\start-whatsapp-resident.ps1"
if exist "%WA_RESIDENT%" (
  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%WA_RESIDENT%" -Port 5056 >nul 2>&1
  set "RC=!ERRORLEVEL!"
  popd >nul
  exit /b !RC!
)

rem Compatibility fallback only. Normal owner setup should always use the resident above.
if not exist logs mkdir logs >nul 2>&1
if "%WA_PORT%"=="" set "WA_PORT=5056"
set "WHATSAPP_SIDECAR_PORT=%WA_PORT%"
set "WA_RUNTIME=%LOCALAPPDATA%\ServiceFlow\whatsapp-runtime\web-link-1.34.7"
set "WA_NODE_MODULES=%WA_RUNTIME%\node_modules"
set "NPM_CACHE=%LOCALAPPDATA%\ServiceFlow\npm-cache"
if not exist "%WA_RUNTIME%" mkdir "%WA_RUNTIME%" >nul 2>&1
if not exist "%NPM_CACHE%" mkdir "%NPM_CACHE%" >nul 2>&1
if not exist "%WA_NODE_MODULES%\whatsapp-web.js\package.json" (
  if exist "%WA_RUNTIME%\installing.lock" (popd >nul & exit /b 0)
  >"%WA_RUNTIME%\installing.lock" echo installing
  copy /y "scripts\whatsapp-runtime-package.json" "%WA_RUNTIME%\package.json" >nul
  pushd "%WA_RUNTIME%" >nul
  set "PUPPETEER_SKIP_DOWNLOAD=true"
  set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true"
  call npm install --no-audit --no-fund --prefer-offline --progress=false --loglevel=error --cache "%NPM_CACHE%" --fetch-retries=2 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=5000 >> "%~dp0logs\whatsapp-install.log" 2>&1
  set "WA_INSTALL_RC=!ERRORLEVEL!"
  popd >nul
  del /q "%WA_RUNTIME%\installing.lock" >nul 2>&1
  if not "!WA_INSTALL_RC!"=="0" (popd >nul & exit /b 1)
)
set "NODE_PATH=%WA_NODE_MODULES%"
node "scripts\whatsapp-sidecar.js" >> "logs\whatsapp.log" 2>&1
set "RC=%ERRORLEVEL%"
popd >nul
exit /b %RC%
