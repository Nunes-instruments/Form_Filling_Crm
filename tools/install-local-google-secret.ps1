param(
  [Parameter(Mandatory=$true)][string]$Root,
  [switch]$Quiet
)
$ErrorActionPreference='Stop'
# Normalize the BAT-supplied workspace path before Resolve-Path.
# A quoted Windows argument that ends in a backslash can be parsed by some
# command-line paths as: C:\Folder\" -Quiet.  Accept that legacy malformed
# value as well so setup does not fail with "Illegal characters in path".
$received = [Environment]::ExpandEnvironmentVariables([string]$Root).Trim()
if ($received -match '^(?<p>.+?)[\"'']\s+-Quiet\s*$') {
  $received = $Matches['p']
}
$received = $received.Trim().Trim([char]34).Trim([char]39).Trim()
if ([string]::IsNullOrWhiteSpace($received)) { throw 'NUNES application folder path is empty.' }
try {
  $resolved=(Resolve-Path -LiteralPath $received -ErrorAction Stop).ProviderPath
} catch {
  throw ("NUNES application folder could not be resolved. Received: [{0}]. {1}" -f $received, $_.Exception.Message)
}
$state=Join-Path $env:LOCALAPPDATA 'NUNES Operations\Secrets'
$dest=Join-Path $state 'google_oauth_client.json'
$source=Join-Path $resolved 'LOCAL_ONLY_SECRETS\google_oauth_client.json'
New-Item -ItemType Directory -Force -Path $state | Out-Null

if(Test-Path -LiteralPath $source -PathType Leaf){
  try {
    $doc=(Get-Content -LiteralPath $source -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
    $cfg=$doc.installed
    if(-not $cfg){$cfg=$doc.web}
    if(-not $cfg.client_id -or -not $cfg.client_secret){throw 'OAuth JSON does not contain client_id/client_secret.'}
    Copy-Item -LiteralPath $source -Destination $dest -Force
    if(-not $Quiet){Write-Host "Private Google OAuth JSON installed locally (not in Git): $dest" -ForegroundColor Green}
    exit 0
  } catch {
    throw "Local Google OAuth JSON is invalid: $($_.Exception.Message)"
  }
}

if(Test-Path -LiteralPath $dest -PathType Leaf){
  if(-not $Quiet){Write-Host 'Existing private Google OAuth JSON kept in LOCALAPPDATA.' -ForegroundColor Green}
  exit 0
}

if(-not $Quiet){Write-Host 'No bundled local-only Google JSON found. You can add one later from Settings.' -ForegroundColor Yellow}
exit 0
