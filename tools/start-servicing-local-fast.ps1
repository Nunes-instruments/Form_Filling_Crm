param(
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir = Join-Path $stateRoot 'ServicingResident'
$residentStart = Join-Path $residentDir 'start-servicing-resident.ps1'
$configPath = Join-Path $residentDir 'servicing-resident.json'

# Fast daily path: after the one-time server setup, no source/share access is required.
if ((Test-Path -LiteralPath $residentStart -PathType Leaf) -and (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  & powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $residentStart -Port 5055
  exit $LASTEXITCODE
}

# Compatibility fallback for a ZIP opened before setup was rerun: prepare/install the local
# resident once, then all later starts are local-disk only.
$Root = (Resolve-Path -LiteralPath $Root).ProviderPath
$prep = Join-Path $Root 'tools\prepare-servicing-resident.ps1'
if (-not (Test-Path -LiteralPath $prep -PathType Leaf)) { exit 3 }
& powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $prep -Root $Root
exit $LASTEXITCODE
