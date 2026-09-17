param(
  [string]$Url = 'http://127.0.0.1:5056/health',
  [int]$TimeoutSeconds = 12
)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  try {
    $r = Invoke-RestMethod -Uri $Url -TimeoutSec 2
    if ($r.service -eq 'ServiceFlow WhatsApp Runtime' -and $r.ok -eq $true) { 'YES'; exit 0 }
  } catch {}
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
'NO'
