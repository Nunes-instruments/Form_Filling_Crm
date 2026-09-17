param(
  [Parameter(Mandatory=$true)][string]$AppDir,
  [Parameter(Mandatory=$true)][string]$PackageJson
)
$ErrorActionPreference = 'SilentlyContinue'
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
$pkg = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
$required = @()
if ($pkg.dependencies) { $required += $pkg.dependencies.PSObject.Properties.Name }
if ($pkg.devDependencies) { $required += $pkg.devDependencies.PSObject.Properties.Name }
$required = $required | Sort-Object -Unique

function Has-AllPackages([string]$nodeModules) {
  if (-not (Test-Path -LiteralPath (Join-Path $nodeModules 'next\package.json'))) { return $false }
  foreach ($name in $required) {
    $parts = $name -split '/'
    if ($name.StartsWith('@') -and $parts.Count -ge 2) {
      $candidate = Join-Path $nodeModules (Join-Path $parts[0] (Join-Path $parts[1] 'package.json'))
    } else {
      $candidate = Join-Path $nodeModules (Join-Path $name 'package.json')
    }
    if (-not (Test-Path -LiteralPath $candidate)) { return $false }
  }
  return $true
}

# Prefer the shared LocalAppData cache because it survives deleting old ZIP folders.
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'ServiceFlow\runtime'
if (Test-Path -LiteralPath $runtimeRoot) {
  foreach ($dir in (Get-ChildItem -LiteralPath $runtimeRoot -Directory | Sort-Object LastWriteTime -Descending)) {
    $nm = Join-Path $dir.FullName 'node_modules'
    if (Has-AllPackages $nm) { Write-Output $nm; exit 0 }
  }
}

# Then reuse a previous extracted ServiceFlow folder, even when it has extra packages.
$parent = Split-Path -Parent $AppDir
foreach ($candidate in (Get-ChildItem -LiteralPath $parent -Directory | Where-Object { $_.FullName -ne $AppDir } | Sort-Object LastWriteTime -Descending)) {
  $candidatePkg = Join-Path $candidate.FullName 'package.json'
  $nm = Join-Path $candidate.FullName 'node_modules'
  if (-not (Test-Path -LiteralPath $candidatePkg)) { continue }
  try {
    $name = (Get-Content -LiteralPath $candidatePkg -Raw | ConvertFrom-Json).name
    if ($name -ne 'servicejob-online-offline-webapp') { continue }
    if (Has-AllPackages $nm) { Write-Output $nm; exit 0 }
  } catch {}
}
