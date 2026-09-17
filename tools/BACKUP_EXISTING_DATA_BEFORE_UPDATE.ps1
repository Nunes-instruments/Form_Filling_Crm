$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$OutDir = Join-Path $Root 'backups'
$Stage = Join-Path $env:TEMP "nunes-data-$Stamp"
$Zip = Join-Path $OutDir "NUNES_DATA_BACKUP_$Stamp.zip"

New-Item -ItemType Directory -Force -Path $OutDir,$Stage | Out-Null
$orderData = Join-Path $Root 'apps\order_forms\data'
$serviceData = Join-Path $Root 'apps\service_operations\data'

if (Test-Path $orderData) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'order_forms') | Out-Null
  Copy-Item "$orderData\*" (Join-Path $Stage 'order_forms') -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $serviceData) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'service_operations') | Out-Null
  Copy-Item "$serviceData\*" (Join-Path $Stage 'service_operations') -Recurse -Force -ErrorAction SilentlyContinue
}

Compress-Archive -Path "$Stage\*" -DestinationPath $Zip -CompressionLevel Optimal -Force
Remove-Item $Stage -Recurse -Force
Write-Host "Backup created: $Zip" -ForegroundColor Green
