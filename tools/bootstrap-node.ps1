param([Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function ValidNode([string]$exe){
  if(-not $exe -or -not (Test-Path $exe)){return $false}
  try{$major=[int](& $exe -p "Number(process.versions.node.split('.')[0])" 2>$null); return $major -ge 20}catch{return $false}
}
$c=Get-Command node.exe -ErrorAction SilentlyContinue
if($c -and (ValidNode $c.Source)){ Set-Content $OutputFile (Split-Path $c.Source) -Encoding Default; exit 0 }
$arch=$env:PROCESSOR_ARCHITECTURE
if($env:PROCESSOR_ARCHITEW6432){$arch=$env:PROCESSOR_ARCHITEW6432}
$tag='x64'; if($arch -match 'ARM64'){$tag='arm64'} elseif($arch -match '86'){$tag='x86'}
$ver='v22.22.0'
$root=Join-Path $env:LOCALAPPDATA "NunesCompanyOperations\runtime\node\$ver-$tag"
$dir=Join-Path $root "node-$ver-win-$tag"
$exe=Join-Path $dir 'node.exe'
if(-not (ValidNode $exe)){
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $zip=Join-Path $env:TEMP "node-$ver-win-$tag.zip"
  $url="https://nodejs.org/dist/$ver/node-$ver-win-$tag.zip"
  Write-Host '[Setup] Downloading portable Node.js LTS for Service Operations...'
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  Get-ChildItem $root -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $zip -DestinationPath $root -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
if(ValidNode $exe){Set-Content $OutputFile $dir -Encoding Default; exit 0}
Set-Content $OutputFile '' -Encoding Default; exit 1
