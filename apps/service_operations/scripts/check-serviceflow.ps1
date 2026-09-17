param(
  [string]$Url = 'http://127.0.0.1:5055/api/health',
  [string]$ExpectedVersion = ''
)
try {
  $r = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 -Uri $Url
  if ($r.app -eq 'ServiceFlowJobCards') {
    if ($ExpectedVersion -and ([string]$r.version) -ne $ExpectedVersion) { Write-Output 'OLD' }
    else { Write-Output 'YES' }
  }
} catch {}
