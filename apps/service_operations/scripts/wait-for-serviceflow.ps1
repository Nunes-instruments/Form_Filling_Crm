param(
  [string]$Url = 'http://127.0.0.1:5055/api/health',
  [int]$TimeoutSeconds = 15,
  [string]$ExpectedVersion = ''
)
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $r = Invoke-RestMethod -UseBasicParsing -TimeoutSec 1 -Uri $Url
    $versionOk = [string]::IsNullOrWhiteSpace($ExpectedVersion) -or ([string]$r.version -eq $ExpectedVersion)
    if ($r.app -eq 'ServiceFlowJobCards' -and $versionOk) { Write-Output 'YES'; exit 0 }
  } catch {}
  Start-Sleep -Milliseconds 120
}
Write-Output 'NO'
