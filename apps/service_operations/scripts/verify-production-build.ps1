param([Parameter(Mandatory=$true)][string]$AppDir)
$required = @(
  '.next\BUILD_ID',
  '.next\server\pages-manifest.json',
  '.next\server\app-paths-manifest.json',
  '.next\prerender-manifest.json',
  '.next\routes-manifest.json'
)
foreach ($rel in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $AppDir $rel))) { 'NO'; exit 0 }
}
'YES'
