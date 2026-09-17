param(
  [string]$Url = 'http://127.0.0.1:5056/health',
  [string]$ExpectedVersion = '3.0.0'
)
$ErrorActionPreference = 'SilentlyContinue'
try {
  $r = Invoke-RestMethod -Uri $Url -TimeoutSec 2
  if ($r.service -eq 'ServiceFlow WhatsApp Runtime' -and $r.engine -eq 'WhatsAppWebLink' -and $r.version -eq $ExpectedVersion -and $r.ok -eq $true) { 'YES' } else { 'NO' }
} catch { 'NO' }
