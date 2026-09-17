@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Stop ServiceFlow
for %%R in (5055 5056) do (
  set "PID="
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%%R .*LISTENING"') do set "PID=%%P"
  if defined PID taskkill /PID !PID! /T /F >nul 2>&1
)
echo ServiceFlow and WhatsApp runtime stopped.
timeout /t 1 /nobreak >nul
