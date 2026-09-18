param(
  [int]$Port = 5055,
  [int]$WaitSeconds = 12
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-ListeningPid([int]$TargetPort) {
  try {
    $c = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($c -and [int]$c.OwningProcess -gt 0) { return [int]$c.OwningProcess }
  } catch {}
  try {
    $lines = & $env:SystemRoot\System32\netstat.exe -ano -p tcp 2>$null
    foreach ($line in $lines) {
      if ($line -match ('^\s*TCP\s+\S+:' + $TargetPort + '\s+\S+\s+LISTENING\s+(\d+)\s*$')) {
        return [int]$Matches[1]
      }
    }
  } catch {}
  return 0
}

function Test-Health([int]$TargetPort) {
  try {
    $h = Invoke-RestMethod -TimeoutSec 2 ("http://127.0.0.1:{0}/api/health?_={1}" -f $TargetPort,[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    return ($h.app -eq 'ServiceFlowJobCards' -and $h.ok -eq $true)
  } catch { return $false }
}

$pidToStop = Get-ListeningPid $Port
if ($pidToStop -gt 0 -and $pidToStop -ne $PID) {
  Write-Host ("Stopping old Servicing listener on port {0} (PID {1})..." -f $Port,$pidToStop) -ForegroundColor Yellow
  try { Stop-Process -Id $pidToStop -Force -ErrorAction Stop } catch { & taskkill.exe /PID $pidToStop /T /F | Out-Null }
  $deadline = [DateTime]::UtcNow.AddSeconds(6)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ((Get-ListeningPid $Port) -eq 0) { break }
    Start-Sleep -Milliseconds 150
  }
}

$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$launcher = Join-Path $stateRoot 'ServicingResident\start-servicing-resident.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Servicing resident launcher is missing: $launcher" }

Write-Host 'Starting Servicing with the persistent Gemini environment...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -Port $Port
if ($LASTEXITCODE -ne 0) { throw "Servicing resident launcher failed with exit code $LASTEXITCODE." }

$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
  if (Test-Health $Port) {
    Write-Host '[OK] Servicing resident restarted.' -ForegroundColor Green
    exit 0
  }
  Start-Sleep -Milliseconds 250
}
throw "Servicing did not become healthy on port $Port within $WaitSeconds seconds."
