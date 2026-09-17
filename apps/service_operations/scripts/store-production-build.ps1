param(
  [Parameter(Mandatory=$true)][string]$BuildDir,
  [Parameter(Mandatory=$true)][string]$CacheDir
)
$ErrorActionPreference='SilentlyContinue'
function ValidBuild([string]$dir){
  return (Test-Path -LiteralPath (Join-Path $dir 'BUILD_ID')) -and
         (Test-Path -LiteralPath (Join-Path $dir 'routes-manifest.json')) -and
         (Test-Path -LiteralPath (Join-Path $dir 'prerender-manifest.json'))
}
if(!(ValidBuild $BuildDir)){exit 0}
if(ValidBuild $CacheDir){exit 0}
if(Test-Path -LiteralPath $CacheDir){Remove-Item -LiteralPath $CacheDir -Recurse -Force}
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
$null = robocopy $BuildDir $CacheDir /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
exit 0
