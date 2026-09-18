param([int]$Port = 8795)
$ErrorActionPreference='Stop'
function Get-ListenerPid([int]$p){
  try{
    $line=netstat -ano -p tcp | Select-String (':'+$p+'\s+.*LISTENING') | Select-Object -First 1
    if($line){ return [int](($line.ToString().Trim() -split '\s+')[-1]) }
  }catch{}
  return 0
}
$pidOnPort=Get-ListenerPid $Port
if($pidOnPort -le 0){ Write-Host "[OK] TCP $Port is free." -ForegroundColor Green; exit 0 }
try{
  $h=Invoke-RestMethod -TimeoutSec 1 ("http://127.0.0.1:{0}/api/health" -f $Port)
  if($h.ok -eq $true -and [string]$h.product -eq 'NUNES Company Platform'){
    Write-Host "[OK] TCP $Port is already owned by NUNES (PID $pidOnPort)." -ForegroundColor Green
    exit 0
  }
}catch{}
Write-Host "[BLOCKED] TCP $Port is already used by another application (PID $pidOnPort)." -ForegroundColor Red
Write-Host "NUNES V6.5.15 is fixed to port $Port and will NOT switch to 8765 or another dashboard port." -ForegroundColor Yellow
Write-Host 'Close or move that other application, then run setup again.' -ForegroundColor Yellow
exit 2
