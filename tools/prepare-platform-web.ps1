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
function RemovePath([string]$p){ if(Test-Path -LiteralPath $p){cmd.exe /d /c ('rmdir /S /Q "{0}"' -f $p) | Out-Null} }
function Junction([string]$link,[string]$target){ RemovePath $link; cmd.exe /d /c ('mklink /J "{0}" "{1}"' -f $link,$target) | Out-Null; if(-not (Test-Path -LiteralPath $link)){throw "Could not connect cache: $link"} }

$depHash=DependencySignature (Join-Path $Web 'package.json')
$runtime=Join-Path $CacheRoot "runtime\$depHash"
$runtimeNode=Join-Path $runtime 'node_modules'
if(-not (Test-Path -LiteralPath (Join-Path $Web 'node_modules\next\package.json'))){
  if(Test-Path -LiteralPath (Join-Path $runtimeNode 'next\package.json')){
    Junction (Join-Path $Web 'node_modules') $runtimeNode
  } else {
    # A previous extracted NUNES folder often already has the exact same dependency
    # set. Reuse it immediately instead of downloading the same packages again.
    $siblingNode=$null
    $parent=Split-Path -Parent $Root
    if(Test-Path -LiteralPath $parent){
      Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue | Where-Object {$_.FullName -ne $Root} | ForEach-Object {
        if($siblingNode){return}
        $otherWeb=Join-Path $_.FullName 'platform_web'
        $otherLock=Join-Path $otherWeb 'package-lock.json'
        $otherNode=Join-Path $otherWeb 'node_modules'
        if((Test-Path -LiteralPath $otherLock) -and (Test-Path -LiteralPath (Join-Path $otherNode 'next\package.json'))){
          try{if((DependencySignature (Join-Path $otherWeb 'package.json')) -eq $depHash){$script:siblingNode=$otherNode}}catch{}
        }
      }
    }
    if($siblingNode){
      $sameVolume=([IO.Path]::GetPathRoot($siblingNode) -ieq [IO.Path]::GetPathRoot($runtimeNode))
      $siblingIsLink=$false;try{$siblingIsLink=[bool]((Get-Item -LiteralPath $siblingNode -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)}catch{}
      if($sameVolume -and -not $siblingIsLink){
        New-Item -ItemType Directory -Force -Path $runtime | Out-Null
        if(Test-Path -LiteralPath $runtimeNode){RemovePath $runtimeNode}
        try {
          # Same-volume directory rename is instant when the previous extracted
          # folder is idle. If an older server still has files open, do NOT fail
          # startup with "file is being used"; reuse that compatible runtime in place.
          Move-Item -LiteralPath $siblingNode -Destination $runtimeNode -ErrorAction Stop
          Junction $siblingNode $runtimeNode
          Junction (Join-Path $Web 'node_modules') $runtimeNode
        } catch {
          Junction (Join-Path $Web 'node_modules') $siblingNode
        }
      } else {
        # Cross-drive move would be a full copy and slow startup. Use the compatible
        # sibling runtime directly; a later clean install can populate LOCALAPPDATA.
        Junction (Join-Path $Web 'node_modules') $siblingNode
      }
    } else {
      New-Item -ItemType Directory -Force -Path $runtime | Out-Null
      Copy-Item -LiteralPath (Join-Path $Web 'package.json') -Destination (Join-Path $runtime 'package.json') -Force
      Copy-Item -LiteralPath (Join-Path $Web 'package-lock.json') -Destination (Join-Path $runtime 'package-lock.json') -Force
      Push-Location $runtime
      try{ & $NpmCmd ci --no-audit --no-fund --prefer-offline --progress=false --loglevel=error; if($LASTEXITCODE -ne 0){throw 'npm ci failed'} }finally{Pop-Location}
      Junction (Join-Path $Web 'node_modules') $runtimeNode
    }
  }
}

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
  # Keep Next's compilation cache across source-version updates. A changed ZIP still
  # gets a fresh final build, but unchanged modules do not need full recompilation.
  $incremental=Join-Path $CacheRoot "incremental\$depHash"
  New-Item -ItemType Directory -Force -Path $incremental | Out-Null
  Junction (Join-Path $webBuild 'cache') $incremental
  Push-Location $Web
  try{ & $NpmCmd run build; if($LASTEXITCODE -ne 0){throw 'Next.js platform build failed'} }finally{Pop-Location}
  if(-not (Test-Path -LiteralPath (Join-Path $webBuild 'BUILD_ID'))){throw 'Next.js build finished without BUILD_ID'}
  Set-Content -LiteralPath (Join-Path $webBuild $markerName) -Value $sourceHash -Encoding ASCII
  # Runtime does not need the compiler cache inside the immutable source build.
  RemovePath (Join-Path $webBuild 'cache')
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $buildCache) | Out-Null
  RemovePath $buildCache
  Move-Item -LiteralPath $webBuild -Destination $buildCache
  Junction $webBuild $buildCache
}
# output:'standalone' intentionally omits .next/static. Attach the generated
# static folder to the standalone runtime without copying it, so cached builds
# remain fast and the browser receives JS/CSS chunks correctly.
$standaloneServer=Join-Path $webBuild 'standalone\server.js'
if(-not (Test-Path -LiteralPath $standaloneServer)){throw 'Standalone dashboard server.js is missing after build preparation'}
$staticSource=Join-Path $webBuild 'static'
if(Test-Path -LiteralPath $staticSource){
  $standaloneNext=Join-Path $webBuild 'standalone\.next'
  New-Item -ItemType Directory -Force -Path $standaloneNext | Out-Null
  $staticTarget=Join-Path $standaloneNext 'static'
  if(-not (Test-Path -LiteralPath $staticTarget)){
    Junction $staticTarget $staticSource
  }
}
Write-Output "READY $sourceHash"
