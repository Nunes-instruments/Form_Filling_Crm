@echo off
setlocal EnableExtensions
if not defined NUNES_API_PORT set "NUNES_API_PORT=8865"
rem Servicing has priority because it is the daily slow path reported by users.
start "Validate Servicing" /b powershell -NoProfile -Command "try{Invoke-RestMethod -Method Post -TimeoutSec 2 http://127.0.0.1:%NUNES_API_PORT%/api/modules/service_operations/start ^| Out-Null}catch{}" >nul 2>&1
rem Purchasing can prepare a few seconds later so its first-time Python package work
rem never competes with opening the Servicing form.
start "Warm Purchasing Later" /b cmd /d /c "timeout /t 8 /nobreak ^>nul ^& powershell -NoProfile -Command ""try{Invoke-RestMethod -Method Post -TimeoutSec 2 http://127.0.0.1:%NUNES_API_PORT%/api/modules/order_forms/start ^| Out-Null}catch{}""" >nul 2>&1
exit /b 0
