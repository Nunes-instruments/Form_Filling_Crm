param(
  [Parameter(Mandatory=$true)][string]$AppDir,
  [Parameter(Mandatory=$true)][string]$SourceHash
)
$ErrorActionPreference = 'SilentlyContinue'
$source = Join-Path $AppDir '.next'
if (-not (Test-Path -LiteralPath (Join-Path $source 'BUILD_ID'))) { exit 0 }
$dest = Join-Path $env:LOCALAPPDATA "ServiceFlow\build-cache\$SourceHash\.next"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
& robocopy $source $dest /MIR /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
exit 0
