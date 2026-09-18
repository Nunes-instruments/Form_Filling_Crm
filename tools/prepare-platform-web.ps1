param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$NpmCmd
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Root=[IO.Path]::GetFullPath($Root)
$Web=Join-Path $Root 'platform_web'
$CacheRoot=Join-Path $env:LOCALAPPDATA 'NUNES Operations\PlatformCache'
New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null

function HashFile([string]$p){ (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function HashText([string]$text){$sha=[Security.Cryptography.SHA256]::Create();try{$b=[Text.Encoding]::UTF8.GetBytes($text);(($sha.ComputeHash($b)|ForEach-Object {$_.ToString('x2')}) -join '')}finally{$sha.Dispose()}}
function DependencySignature([string]$packageJson){$raw=[IO.File]::ReadAllText($packageJson);$raw=[Text.RegularExpressions.Regex]::Replace($raw,'(?m)^\s*"version"\s*:\s*"[^"]+"\s*,?\s*$','');HashText $raw}
function SourceSignature {
  $files=New-Object System.Collections.Generic.List[string]
  foreach($name in 'package.json','package-lock.json','next.config.mjs','postcss.config.mjs','tsconfig.json'){
    $p=Join-Path $Web $name; if(Test-Path -LiteralPath $p){$files.Add($p)}
  }
  Get-ChildItem -LiteralPath (Join-Path $Web 'src') -Recurse -File | Sort-Object FullName | ForEach-Object {$files.Add($_.FullName)}
  $lines=foreach($p in $files){$rel=$p.Substring($Web.Length).TrimStart([char]'\',[char]'/').Replace('\','/'); "$rel=$(HashFile $p)"}
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$bytes=[Text.Encoding]::UTF8.GetBytes(($lines -join "`n")); (($sha.ComputeHash($bytes)|ForEach-Object {$_.ToString('x2')}) -join '')}finally{$sha.Dispose()}
}
function RemovePath([string]$p){
  if(-not (Test-Path -LiteralPath $p)){ return }
  $isLink=$false
  try{$isLink=[bool]((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)}catch{}
  if($isLink){ cmd.exe /d /c ('rmdir "{0}"' -f $p) | Out-Null }
  else { cmd.exe /d /c ('rmdir /S /Q "{0}"' -f $p) | Out-Null }
}
function Junction([string]$link,[string]$target){ RemovePath $link; cmd.exe /d /c ('mklink /J "{0}" "{1}"' -f $link,$target) | Out-Null; if(-not (Test-Path -LiteralPath $link)){throw "Could not connect cache: $link"} }
function IsReparsePoint([string]$p){
  try { return (Test-Path -LiteralPath $p) -and [bool]((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) }
  catch { return $false }
}
function LockVersion([string]$name){
  try {
    $lock=Get-Content -LiteralPath (Join-Path $Web 'package-lock.json') -Raw | ConvertFrom-Json
    $key='node_modules/'+$name
    $prop=$lock.packages.PSObject.Properties[$key]
    if($prop){ return [string]$prop.Value.version }
  } catch {}
  return ''
}
function TestNodeRuntime([string]$nodeModules){
  if(-not (Test-Path -LiteralPath $nodeModules -PathType Container)){ return $false }
  $critical=@(
    'next\package.json',
    'next\dist\bin\next',
    'next\dist\client\components\builtin\global-not-found.js',
    'next\dist\server\next.js',
    'react\package.json',
    'react-dom\package.json'
  )
  foreach($rel in $critical){ if(-not (Test-Path -LiteralPath (Join-Path $nodeModules $rel) -PathType Leaf)){ return $false } }
  try {
    $expectedNext=LockVersion 'next'; $expectedReact=LockVersion 'react'; $expectedReactDom=LockVersion 'react-dom'
    $actualNext=[string]((Get-Content -LiteralPath (Join-Path $nodeModules 'next\package.json') -Raw | ConvertFrom-Json).version)
    $actualReact=[string]((Get-Content -LiteralPath (Join-Path $nodeModules 'react\package.json') -Raw | ConvertFrom-Json).version)
    $actualReactDom=[string]((Get-Content -LiteralPath (Join-Path $nodeModules 'react-dom\package.json') -Raw | ConvertFrom-Json).version)
    if($expectedNext -and $actualNext -ne $expectedNext){ return $false }
    if($expectedReact -and $actualReact -ne $expectedReact){ return $false }
    if($expectedReactDom -and $actualReactDom -ne $expectedReactDom){ return $false }
  } catch { return $false }
  return $true
}
function InstallLocalRuntime([bool]$preferOnline=$false){
  # IMPORTANT: Next.js 15 records/uses package paths while compiling. A node_modules
  # junction whose real target is in %%LOCALAPPDATA%% can make Windows/webpack generate
  # an escaping ../../../../AppData/... import for builtin/global-not-found.js. Keep
  # node_modules PHYSICALLY inside platform_web. npm's own download cache remains shared,
  # so repeat installs still benefit from the warm npm cache without path leakage.
  $nodeModules=Join-Path $Web 'node_modules'
  RemovePath $nodeModules
  Push-Location $Web
  try {
    $args=@('ci','--no-audit','--no-fund','--progress=false','--loglevel=error')
    if($preferOnline){ $args += '--prefer-online' } else { $args += '--prefer-offline' }
    & $NpmCmd @args
    if($LASTEXITCODE -ne 0){ throw 'npm ci failed' }
  } finally { Pop-Location }
  if(IsReparsePoint $nodeModules){ throw 'Dashboard node_modules unexpectedly became a junction/reparse point.' }
  if(-not (TestNodeRuntime $nodeModules)){ throw 'Local dashboard dependency install completed but required Next.js files are still missing.' }
}

$depHash=DependencySignature (Join-Path $Web 'package.json')
$webNode=Join-Path $Web 'node_modules'

# V6.6.8 ROOT FIX:
# Previous releases linked platform_web\node_modules to AppData\PlatformCache\runtime.
# The packages could be complete, but Next.js/webpack on Windows could resolve the
# junction target and emit ../../../../AppData/.../global-not-found.js. That relative
# path is wrong from a deeply nested Desktop release folder and the build fails.
# Remove that old junction and use a normal local node_modules directory.
if(IsReparsePoint $webNode){
  Write-Host '[Dashboard] Removing old external node_modules junction (Windows Next.js path fix).' -ForegroundColor Yellow
  RemovePath $webNode
}
if((Test-Path -LiteralPath $webNode) -and -not (TestNodeRuntime $webNode)){
  Write-Host '[Dashboard] Local dependencies are incomplete. Reinstalling exact locked packages.' -ForegroundColor Yellow
  RemovePath $webNode
}
if(-not (TestNodeRuntime $webNode)){
  Write-Host '[Dashboard] Installing dashboard dependencies locally inside platform_web...' -ForegroundColor Cyan
  try {
    InstallLocalRuntime $false
  } catch {
    Write-Host '[Dashboard] First install did not validate. Verifying npm cache and retrying online...' -ForegroundColor Yellow
    try { & $NpmCmd cache verify | Out-Null } catch {}
    InstallLocalRuntime $true
  }
}
if(IsReparsePoint $webNode){ throw 'Dashboard dependency path is still external after repair.' }
if(-not (TestNodeRuntime $webNode)){ throw 'Dashboard local dependency runtime is incomplete after repair.' }

$sourceHash=SourceSignature
$buildCache=Join-Path $CacheRoot "build-cache\$sourceHash"
$webBuild=Join-Path $Web '.next'
$markerName='nunes-source.signature'
$currentValid=(Test-Path -LiteralPath (Join-Path $webBuild 'BUILD_ID')) -and (Test-Path -LiteralPath (Join-Path $webBuild 'standalone\server.js')) -and (Test-Path -LiteralPath (Join-Path $webBuild $markerName)) -and ((Get-Content -LiteralPath (Join-Path $webBuild $markerName) -Raw).Trim() -eq $sourceHash)
$cacheValid=(Test-Path -LiteralPath (Join-Path $buildCache 'BUILD_ID')) -and (Test-Path -LiteralPath (Join-Path $buildCache 'standalone\server.js')) -and (Test-Path -LiteralPath (Join-Path $buildCache $markerName)) -and ((Get-Content -LiteralPath (Join-Path $buildCache $markerName) -Raw).Trim() -eq $sourceHash)
if(-not $currentValid){
  if($cacheValid){ Junction $webBuild $buildCache; $currentValid=$true }
}
if(-not $currentValid){
  RemovePath $webBuild
  New-Item -ItemType Directory -Force -Path $webBuild | Out-Null
  $incremental=Join-Path $CacheRoot "incremental\$depHash"
  New-Item -ItemType Directory -Force -Path $incremental | Out-Null
  Junction (Join-Path $webBuild 'cache') $incremental

  $buildExit=0
  Push-Location $Web
  try { & $NpmCmd run build; $buildExit=$LASTEXITCODE } finally { Pop-Location }

  if($buildExit -ne 0){
    Write-Host '[Dashboard] Build failed. Performing one full LOCAL dependency repair and retry...' -ForegroundColor Yellow
    RemovePath $webBuild
    RemovePath $webNode
    RemovePath $incremental
    try { & $NpmCmd cache verify | Out-Null } catch {}
    InstallLocalRuntime $true
    if(IsReparsePoint $webNode){ throw 'Dashboard dependency repair recreated an external link.' }
    New-Item -ItemType Directory -Force -Path $webBuild | Out-Null
    Push-Location $Web
    try { & $NpmCmd run build; $buildExit=$LASTEXITCODE } finally { Pop-Location }
    if($buildExit -ne 0){ throw 'Next.js platform build failed after local dependency retry.' }
  }

  if(-not (Test-Path -LiteralPath (Join-Path $webBuild 'BUILD_ID'))){throw 'Next.js build finished without BUILD_ID'}
  Set-Content -LiteralPath (Join-Path $webBuild $markerName) -Value $sourceHash -Encoding ASCII
  RemovePath (Join-Path $webBuild 'cache')
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $buildCache) | Out-Null
  RemovePath $buildCache
  Move-Item -LiteralPath $webBuild -Destination $buildCache
  Junction $webBuild $buildCache
}

$standaloneServer=Join-Path $webBuild 'standalone\server.js'
if(-not (Test-Path -LiteralPath $standaloneServer)){throw 'Standalone dashboard server.js is missing after build preparation'}
$staticSource=Join-Path $webBuild 'static'
if(Test-Path -LiteralPath $staticSource){
  $standaloneNext=Join-Path $webBuild 'standalone\.next'
  New-Item -ItemType Directory -Force -Path $standaloneNext | Out-Null
  $staticTarget=Join-Path $standaloneNext 'static'
  if(-not (Test-Path -LiteralPath $staticTarget)){ Junction $staticTarget $staticSource }
}
Write-Output "READY $sourceHash"
