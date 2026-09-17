param([Parameter(Mandatory=$true)][string]$Url)
$ProgressPreference = 'SilentlyContinue'
try {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 4 | Out-Null
} catch {
  # Best effort only. The app remains usable and Settings will retry automatically.
}
