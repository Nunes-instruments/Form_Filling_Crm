param(
  [Parameter(Mandatory=$true)][string]$AppDir,
  [Parameter(Mandatory=$true)][string]$DependencyHash
)
$ErrorActionPreference = 'SilentlyContinue'
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
$parent = Split-Path -Parent $AppDir
$hashScript = Join-Path $AppDir 'scripts\get-dependency-hash.ps1'
$candidates = Get-ChildItem -LiteralPath $parent -Directory |
  Where-Object { $_.FullName -ne $AppDir } |
  Sort-Object LastWriteTime -Descending

foreach ($candidate in $candidates) {
  $pkg = Join-Path $candidate.FullName 'package.json'
  $next = Join-Path $candidate.FullName 'node_modules\next\package.json'
  if (-not ((Test-Path -LiteralPath $pkg) -and (Test-Path -LiteralPath $next))) { continue }
  try {
    $name = (Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).name
    if ($name -ne 'servicejob-online-offline-webapp') { continue }
    $h = & $hashScript -PackageJson $pkg
    if ($h -eq $DependencyHash) {
      Write-Output (Join-Path $candidate.FullName 'node_modules')
      break
    }
  } catch {}
}
