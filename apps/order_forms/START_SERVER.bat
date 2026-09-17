@echo off
setlocal EnableExtensions EnableDelayedExpansion
title NUNES FORM WORKFLOW

rem ============================================================
rem V1.0.12 FAST / WINDOWS-SAFE STARTUP
rem - No copied .venv and no pyvenv.cfg dependency.
rem - Uses any working Python 3.10+ already on the PC.
rem - Installs only the small CORE package set once into .nunes_runtime.
rem - Google API packages install only when Google sync is actually used.
rem ============================================================

pushd "%~dp0" >nul 2>nul
if errorlevel 1 (
  echo ==========================================================
  echo        NUNES FORM WORKFLOW - SERVER
  echo ==========================================================
  echo.
  echo ERROR: Cannot access the application folder:
  echo %~dp0
  echo.
  echo Extract the ZIP to a writable local folder such as:
  echo C:\NUNES_FORM_WORKFLOW
  pause
  exit /b 1
)

set "APP_DIR=%CD%"
set "RUNTIME=.nunes_runtime"
set "SITEPKG=%RUNTIME%\site-packages"
set "PIPCACHE=%RUNTIME%\pip-cache"
set "CORE_REQ=core_requirements.txt"
set "CORE_STAMP=%RUNTIME%\core_v1011.ok"
if "%PORT%"=="" set "PORT=8770"

cls
echo ==========================================================
echo        NUNES FORM WORKFLOW - SERVER V1.0.12
echo ==========================================================
echo.

rem Make sure this location is writable before touching Python/packages/data.
if not exist "data" mkdir "data" >nul 2>nul
>"%APP_DIR%\data\.write_test.tmp" echo ok 2>nul
if not exist "%APP_DIR%\data\.write_test.tmp" (
  echo ERROR: This folder is read-only or protected.
  echo.
  echo Move/extract the application to a writable local folder, for example:
  echo C:\NUNES_FORM_WORKFLOW
  echo.
  pause
  popd
  exit /b 1
)
del /q "%APP_DIR%\data\.write_test.tmp" >nul 2>nul

rem ------------------------------------------------------------
rem 1) Find a working Windows Python quickly.
rem ------------------------------------------------------------
echo [1/4] Finding Python...
call :FIND_PYTHON
if defined PYEXE goto :PYTHON_READY

rem No Python found. Use the company bootstrapper: winget first, then an official per-user installer fallback.
echo       Python 3.10+ was not found. Preparing it automatically...
set "PYFILE=%TEMP%\nunes_python_%RANDOM%_%RANDOM%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\..\..\tools\bootstrap-python.ps1" -OutputFile "!PYFILE!"
if exist "!PYFILE!" set /p PYEXE=<"!PYFILE!"
del /q "!PYFILE!" >nul 2>nul
if defined PYEXE if exist "!PYEXE!" set "NUNES_PYTHON=!PYEXE!"

if not defined PYEXE (
  echo.
  echo ERROR: Python could not be found or installed automatically.
  echo.
  echo This package supports normal 32-bit or 64-bit Windows PCs with
  echo Python 3.10 or newer.
  echo.
  echo Install Python once, then run START_SERVER.bat again.
  echo The official download page will now open.
  start "" "https://www.python.org/downloads/windows/"
  pause
  popd
  exit /b 1
)

:PYTHON_READY
for /f "usebackq delims=" %%V in (`"%PYEXE%" -c "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))" 2^>nul`) do set "PYVER=%%V"
echo       Using Python !PYVER!: %PYEXE%

rem ------------------------------------------------------------
rem 2) Core packages: install once, locally, without a virtual env.
rem This is much faster and cannot fail with "No pyvenv.cfg file".
rem ------------------------------------------------------------
echo [2/4] Checking core packages...
if not exist "%RUNTIME%" mkdir "%RUNTIME%" >nul 2>nul
if not exist "%SITEPKG%" mkdir "%SITEPKG%" >nul 2>nul
if not exist "%PIPCACHE%" mkdir "%PIPCACHE%" >nul 2>nul

set "PYTHONPATH=%APP_DIR%\%SITEPKG%;%PYTHONPATH%"
set "NEED_CORE=0"
if not exist "%CORE_STAMP%" set "NEED_CORE=1"

"%PYEXE%" -c "import flask,werkzeug,openpyxl,reportlab" >nul 2>nul
if errorlevel 1 set "NEED_CORE=1"

if "!NEED_CORE!"=="1" (
  echo       First-time core setup. Installing only essential packages...
  "%PYEXE%" -m pip --version >nul 2>nul
  if errorlevel 1 (
    "%PYEXE%" -m ensurepip --upgrade >nul 2>nul
  )
  "%PYEXE%" -m pip --version >nul 2>nul
  if errorlevel 1 goto :PIP_FAIL

  "%PYEXE%" -m pip install --disable-pip-version-check --no-warn-script-location --prefer-binary --no-compile --cache-dir "%PIPCACHE%" --target "%SITEPKG%" -q -r "%CORE_REQ%"
  if errorlevel 1 goto :PACKAGE_FAIL

  "%PYEXE%" -c "import flask,werkzeug,openpyxl,reportlab" >nul 2>nul
  if errorlevel 1 goto :PACKAGE_FAIL
  >"%CORE_STAMP%" echo NUNES core packages ready.
  echo       Core setup completed.
) else (
  echo       Ready - no package download needed.
)

rem ------------------------------------------------------------
rem 3) Open browser. Browser delay is short; server starts immediately.
rem ------------------------------------------------------------
echo [3/4] Preparing Task Board...
if /I not "%NUNES_EMBEDDED%"=="1" start "" cmd /c "timeout /t 1 /nobreak >nul & start \"\" http://127.0.0.1:%PORT%"

rem ------------------------------------------------------------
rem 4) Start shared office server.
rem ------------------------------------------------------------
echo [4/4] Starting shared office server...
echo.
echo Local URL : http://127.0.0.1:%PORT%
echo Keep this window open while the office is using the system.
echo Client PCs only need the Office/LAN URL from data\CLIENT_ACCESS.txt.
echo.
"%PYEXE%" app.py
set "SERVER_EXIT=%ERRORLEVEL%"
echo.
if not "%SERVER_EXIT%"=="0" echo Server stopped with error code %SERVER_EXIT%.
if "%SERVER_EXIT%"=="0" echo Server stopped.
pause
popd
exit /b %SERVER_EXIT%

:FIND_PYTHON
set "PYEXE="
if defined NUNES_PYTHON if exist "%NUNES_PYTHON%" (
  "%NUNES_PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,10) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYEXE=%NUNES_PYTHON%"
)
if defined PYEXE exit /b 0

rem Known per-user installs first - fastest and avoids Microsoft Store aliases.
for %%P in (
  "%LocalAppData%\Programs\Python\Python315\python.exe"
  "%LocalAppData%\Programs\Python\Python314\python.exe"
  "%LocalAppData%\Programs\Python\Python313\python.exe"
  "%LocalAppData%\Programs\Python\Python312\python.exe"
  "%LocalAppData%\Programs\Python\Python311\python.exe"
  "%LocalAppData%\Programs\Python\Python310\python.exe"
  "%LocalAppData%\Programs\Python\Python313-32\python.exe"
  "%LocalAppData%\Programs\Python\Python312-32\python.exe"
  "%LocalAppData%\Programs\Python\Python311-32\python.exe"
  "%LocalAppData%\Programs\Python\Python310-32\python.exe"
  "%ProgramFiles%\Python315\python.exe"
  "%ProgramFiles%\Python314\python.exe"
  "%ProgramFiles%\Python313\python.exe"
  "%ProgramFiles%\Python312\python.exe"
  "%ProgramFiles%\Python311\python.exe"
  "%ProgramFiles%\Python310\python.exe"
) do (
  if not defined PYEXE if exist "%%~P" (
    "%%~P" -c "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,10) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYEXE=%%~P"
  )
)

if defined PYEXE exit /b 0

rem Python Launcher handles both 32-bit and 64-bit registered installations.
where py >nul 2>nul
if not errorlevel 1 (
  for %%V in (3.15 3.14 3.13 3.12 3.11 3.10) do (
    if not defined PYEXE (
      for /f "usebackq delims=" %%P in (`py -%%V -c "import sys; print(sys.executable)" 2^>nul`) do set "CANDIDATE=%%P"
      if defined CANDIDATE if exist "!CANDIDATE!" set "PYEXE=!CANDIDATE!"
      set "CANDIDATE="
    )
  )
)
if defined PYEXE exit /b 0

rem PATH fallbacks. Validate to reject the non-functional Microsoft Store stub.
for %%C in (python.exe python3.exe) do (
  if not defined PYEXE (
    for /f "delims=" %%P in ('where %%C 2^>nul') do (
      if not defined PYEXE (
        "%%P" -c "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,10) else 1)" >nul 2>nul
        if not errorlevel 1 set "PYEXE=%%P"
      )
    )
  )
)
exit /b 0

:PIP_FAIL
echo.
echo ERROR: Python is installed, but pip is unavailable.
echo Run REPAIR_RUNTIME.bat or repair the Python installation and try again.
echo No company data was changed.
pause
popd
exit /b 1

:PACKAGE_FAIL
echo.
echo ERROR: Core package setup failed.
echo.
echo Check internet/proxy/firewall access and run START_SERVER.bat again.
echo Already downloaded files are cached, so the retry is normally faster.
echo No company data was changed.
pause
popd
exit /b 1
