param(
  [Parameter(Mandatory=$true)][string]$SourceNodeModules,
  [Parameter(Mandatory=$true)][string]$RuntimeDir
)
$ErrorActionPreference = 'SilentlyContinue'
if (-not (Test-Path -LiteralPath (Join-Path $SourceNodeModules 'next\package.json'))) { exit 0 }
$target = Join-Path $RuntimeDir 'node_modules'
$ready = Join-Path $RuntimeDir '.ready'
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
if (Test-Path -LiteralPath $ready) { exit 0 }
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $target | Out-Null
& robocopy $SourceNodeModules $target /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -lt 8 -and (Test-Path -LiteralPath (Join-Path $target 'next\package.json'))) {
  Set-Content -LiteralPath $ready -Value 'ready' -Encoding ASCII
}
exit 0
