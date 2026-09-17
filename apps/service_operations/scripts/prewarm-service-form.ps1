param(
  [string]$BaseUrl = 'http://127.0.0.1:5055',
  [int]$TimeoutSeconds = 12
)
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$base = $BaseUrl.TrimEnd('/')
$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSeconds))
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 1 -Uri "$base/api/health"
    if ($health.app -eq 'ServiceFlowJobCards' -and $health.ok) {
      try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "$base/jobs/new" | Out-Null } catch {}
      exit 0
    }
  } catch {}
  Start-Sleep -Milliseconds 120
}
exit 0
