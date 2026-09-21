param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath
$sourceApp=Join-Path $Root 'apps\service_operations'
$sourceSidecar=Join-Path $sourceApp 'scripts\whatsapp-sidecar.js'
$sourcePackage=Join-Path $sourceApp 'scripts\whatsapp-runtime-package.json'
if(-not (Test-Path -LiteralPath $sourceSidecar -PathType Leaf)){throw 'WhatsApp sidecar source is missing.'}
if(-not (Test-Path -LiteralPath $sourcePackage -PathType Leaf)){throw 'WhatsApp runtime package file is missing.'}

$stateRoot=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir=Join-Path $stateRoot 'WhatsAppResident'
# NUNES_V2_8_9_8_NO_SPACE_WHATSAPP_APP
# Keep the executable JS/app path out of "NUNES Operations" so Node can never
# lose part of the sidecar path at a Windows command-line space.
$noSpaceAppRoot=Join-Path $env:LOCALAPPDATA 'NUNES_WhatsApp_Runtime'
$workDir=Join-Path $noSpaceAppRoot 'app'
$scriptsDir=Join-Path $workDir 'scripts'
$assetsDir=Join-Path $workDir 'assets'
$runtimeDir=Join-Path $residentDir 'runtime-link'
$npmCache=Join-Path $stateRoot 'npm-cache'
New-Item -ItemType Directory -Force -Path $residentDir,$workDir,$scriptsDir,$assetsDir,$runtimeDir,$npmCache | Out-Null

$nodeOut=Join-Path $env:TEMP ('nunes_wa_node_'+[Guid]::NewGuid().ToString('N')+'.txt')
try{
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\bootstrap-node.ps1') -OutputFile $nodeOut | Out-Null
  if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nodeOut)){throw 'Node.js could not be prepared for WhatsApp.'}
  $nodeDir=(Get-Content -LiteralPath $nodeOut -Raw).Trim()
}finally{Remove-Item -LiteralPath $nodeOut -Force -ErrorAction SilentlyContinue}
$nodeExe=Join-Path $nodeDir 'node.exe';$npmCmd=Join-Path $nodeDir 'npm.cmd'
if(-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)){throw 'WhatsApp Node executable is missing.'}
if(-not (Test-Path -LiteralPath $npmCmd -PathType Leaf)){throw 'WhatsApp npm executable is missing.'}

# V21: use the PC's installed Chrome/Edge. No Puppeteer browser download is needed.
$browserCandidates=@(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
$browserPath=$browserCandidates | Select-Object -First 1
if(-not $browserPath){throw 'Google Chrome or Microsoft Edge is required on the main-server PC for WhatsApp Web login.'}

Copy-Item -LiteralPath $sourcePackage -Destination (Join-Path $runtimeDir 'package.json') -Force
$wanted=(Get-Content -LiteralPath $sourcePackage -Raw|ConvertFrom-Json).dependencies.'whatsapp-web.js'
$current=''
$installedPkg=Join-Path $runtimeDir 'node_modules\whatsapp-web.js\package.json'
if(Test-Path -LiteralPath $installedPkg){try{$current=(Get-Content -LiteralPath $installedPkg -Raw|ConvertFrom-Json).version}catch{}}
if([string]$current -ne [string]$wanted){
  Push-Location $runtimeDir
  $oldSkip=$env:PUPPETEER_SKIP_DOWNLOAD
  $oldChromiumSkip=$env:PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
  try{
    $env:PUPPETEER_SKIP_DOWNLOAD='true'
    $env:PUPPETEER_SKIP_CHROMIUM_DOWNLOAD='true'
    & $npmCmd install --no-audit --no-fund --prefer-offline --progress=false --loglevel=error --cache $npmCache --fetch-retries=2 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=5000
    if($LASTEXITCODE -ne 0){throw 'WhatsApp Web link runtime installation failed.'}
  }finally{
    $env:PUPPETEER_SKIP_DOWNLOAD=$oldSkip
    $env:PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=$oldChromiumSkip
    Pop-Location
  }
}
if(-not (Test-Path -LiteralPath $installedPkg -PathType Leaf)){throw 'WhatsApp Web runtime is missing after installation.'}

Copy-Item -LiteralPath $sourceSidecar -Destination (Join-Path $scriptsDir 'whatsapp-sidecar.js') -Force
$sourceAssets=Join-Path $sourceApp 'assets'
if(Test-Path -LiteralPath $sourceAssets -PathType Container){
  & robocopy.exe $sourceAssets $assetsDir /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if($LASTEXITCODE -ge 8){throw 'Could not copy WhatsApp branding assets to the local resident.'}
}
Copy-Item -LiteralPath (Join-Path $Root 'tools\start-whatsapp-resident.ps1') -Destination (Join-Path $residentDir 'start-whatsapp-resident.ps1') -Force
# NUNES_V2_8_10_0_WHATSAPP_CLEAN_RUNTIME
$config=[ordered]@{
  nodeExe=$nodeExe
  nodeModules=(Join-Path $runtimeDir 'node_modules')
  sidecar=(Join-Path $scriptsDir 'whatsapp-sidecar.js')
  workDir=$workDir
  browserPath=[string]$browserPath
  port=5056
  engine='WhatsAppWebLink'
  packageVersion=$wanted
  sidecarVersion='3.4.1'
  preparedAt=[DateTime]::UtcNow.ToString('o')
}
$config|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $residentDir 'whatsapp-resident.json') -Encoding UTF8

& powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File (Join-Path $residentDir 'start-whatsapp-resident.ps1') -Port 5056
if($LASTEXITCODE -ne 0){throw 'WhatsApp resident could not start.'}
exit 0
