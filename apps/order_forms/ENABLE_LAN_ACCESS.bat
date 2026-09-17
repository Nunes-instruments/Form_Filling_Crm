@echo off
setlocal
title NUNES FORM WORKFLOW - ENABLE LAN ACCESS
pushd "%~dp0"
echo This enables inbound TCP port 8770 on the SERVER PC.
echo Administrator permission is required once.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c netsh advfirewall firewall delete rule name=\"NUNES Form Workflow 8770\" ^& netsh advfirewall firewall add rule name=\"NUNES Form Workflow 8770\" dir=in action=allow protocol=TCP localport=8770 profile=private ^& pause' -Verb RunAs"
popd
