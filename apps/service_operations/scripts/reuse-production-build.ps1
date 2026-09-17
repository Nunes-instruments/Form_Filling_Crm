param(
  [Parameter(Mandatory=$true)][string]$AppDir,
  [Parameter(Mandatory=$true)][string]$CacheDir,
  [Parameter(Mandatory=$true)][string]$SourceSignature
)
$ErrorActionPreference='SilentlyContinue'
$AppDir=(Resolve-Path -LiteralPath $AppDir).Path
function ValidBuild([string]$dir){
  return (Test-Path -LiteralPath (Join-Path $dir 'BUILD_ID')) -and
         (Test-Path -LiteralPath (Join-Path $dir 'routes-manifest.json')) -and
         (Test-Path -LiteralPath (Join-Path $dir 'prerender-manifest.json'))
}
if(ValidBuild $CacheDir){ Write-Output 'READY'; exit 0 }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CacheDir) | Out-Null
# Reuse a compatible build from a previously extracted NUNES package when available.
$workspaceRoot=Split-Path -Parent (Split-Path -Parent $AppDir)
$parent=Split-Path -Parent $workspaceRoot
if(Test-Path -LiteralPath $parent){
  $candidates=Get-ChildItem -LiteralPath $parent -Directory -Filter 'NUNES*' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -ne $workspaceRoot } |
    Sort-Object LastWriteTime -Descending
  foreach($d in $candidates){
    $other=Join-Path $d.FullName 'apps\service_operations'
    $sigFile=Join-Path $other 'SOURCE_SIGNATURE.txt'
    $nextDir=Join-Path $other '.next'
    if((Test-Path -LiteralPath $sigFile) -and (ValidBuild $nextDir)){
      $sig=(Get-Content -LiteralPath $sigFile -Raw).Trim()
      if($sig -eq $SourceSignature){
        if(Test-Path -LiteralPath $CacheDir){Remove-Item -LiteralPath $CacheDir -Recurse -Force}
        New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
        $null = robocopy $nextDir $CacheDir /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
        if(ValidBuild $CacheDir){ Write-Output 'IMPORTED'; exit 0 }
      }
    }
  }
}
Write-Output 'MISS'
exit 0
