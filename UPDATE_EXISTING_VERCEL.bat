@echo off
setlocal EnableExtensions EnableDelayedExpansion
title NUNES V6.4.7 - Update Existing Vercel Project
set "ROOT=%~dp0"
set "WEB=%ROOT%platform_web"
if not exist "%WEB%\package.json" (
  echo ERROR: platform_web was not found.
  pause
  exit /b 1
)
pushd "%WEB%" >nul
cls
echo ============================================================
echo   NUNES V6.4.7 - UPDATE SAME VERCEL PROJECT
echo ============================================================
echo This updates web code only. Existing Purchasing and Servicing
echo records are not deleted or replaced by this deployment.
echo.

where node >nul 2>&1 || (echo ERROR: Node.js is required.& pause&popd&exit /b 1)
where npm >nul 2>&1 || (echo ERROR: npm is required.& pause&popd&exit /b 1)
where vercel >nul 2>&1
if errorlevel 1 (
  echo [1/6] Installing Vercel CLI...
  call npm install -g vercel
  if errorlevel 1 goto :FAIL
) else echo [1/6] Vercel CLI ready.

rem Reuse the same Vercel project link from an older NUNES folder when this
rem new ZIP was extracted into a fresh folder.
if not exist ".vercel\project.json" (
  echo [2/6] Looking for the existing nunes-operations-workspace project link...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$target='%CD%\.vercel'; New-Item -ItemType Directory -Force -Path $target ^| Out-Null;" ^
    "$roots=@('%USERPROFILE%\Desktop','%USERPROFILE%\Downloads');" ^
    "$hits=@(); foreach($r in $roots){if(Test-Path $r){$hits += Get-ChildItem -Path $r -Filter project.json -Recurse -ErrorAction SilentlyContinue ^| Where-Object {$_.FullName -match '\\.vercel\\project\.json$'}}};" ^
    "$found=$null; foreach($f in $hits){try{$j=Get-Content $f.FullName -Raw ^| ConvertFrom-Json; if($j.projectName -eq 'nunes-operations-workspace'){$found=$f;break}}catch{}};" ^
    "if($found){Copy-Item $found.FullName '%CD%\.vercel\project.json' -Force; Write-Host ('      Reused existing link: '+$found.FullName); exit 0}else{exit 2}"
  if errorlevel 2 (
    echo       Existing link was not found automatically.
    echo       You will be asked once to select the EXISTING project.
  )
) else echo [2/6] Existing Vercel project link already present.

if not exist ".vercel\project.json" (
  echo [3/6] Linking to existing project...
  echo       IMPORTANT: choose your Vercel team and then EXISTING project:
  echo       nunes-operations-workspace
  echo       DO NOT choose Create a new project.
  call vercel link
  if errorlevel 1 goto :FAIL
) else echo [3/6] Same Vercel project selected automatically.

for /f "usebackq tokens=*" %%P in (`powershell -NoProfile -Command "try{(Get-Content '.vercel\project.json' -Raw ^| ConvertFrom-Json).projectName}catch{''}"`) do set "PROJECT_NAME=%%P"
if /I not "!PROJECT_NAME!"=="nunes-operations-workspace" (
  echo ERROR: Linked project is "!PROJECT_NAME!".
  echo This updater will NOT deploy to a different/new project.
  echo Delete platform_web\.vercel and run this file again, then select
  echo the existing nunes-operations-workspace project.
  pause
  popd
  exit /b 1
)

echo [4/6] Preparing packages...
if not exist "node_modules\next\package.json" (
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :FAIL
) else echo       Existing packages found - no reinstall needed.

echo [5/6] Verifying production build...
call npm run build
if errorlevel 1 goto :BUILDFAIL

echo [6/6] Updating PRODUCTION on the SAME project/domain...
call vercel deploy --prod
if errorlevel 1 goto :FAIL

echo.
echo ============================================================
echo  UPDATE COMPLETE
echo  Same production domain: https://nunes-operations-workspace.vercel.app
echo ============================================================
echo Future code changes: run UPDATE_EXISTING_VERCEL.bat again.
echo Data files are separate and are not replaced by Vercel deployment.
echo.
pause
popd
exit /b 0

:BUILDFAIL
echo.
echo BUILD FAILED. Vercel was NOT updated with a broken build.
pause
popd
exit /b 1

:FAIL
echo.
echo UPDATE STOPPED. Existing production and company data were not deleted.
pause
popd
exit /b 1
