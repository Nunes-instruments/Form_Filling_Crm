param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$Root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath
$transfer=Join-Path $Root 'MAIN_SERVER_TRANSFER_DATA'
if(-not (Test-Path -LiteralPath $transfer -PathType Container)){
  Write-Host '[INFO] No transfer folder found. Existing data on this PC will be kept.' -ForegroundColor Yellow
  exit 0
}
$serviceSrc=Join-Path $transfer 'ServiceData'
$purchaseSrc=Join-Path $transfer 'PurchasingData'
$local=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$serviceDst=Join-Path $local 'ServiceData'
$purchaseDst=Join-Path $local 'PurchasingData'
$backup=Join-Path $local ('MainServerBackups\'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path $local,$backup | Out-Null

function Backup-Existing([string]$Source,[string]$Name){
  if(-not (Test-Path -LiteralPath $Source -PathType Container)){return}
  $dest=Join-Path $backup $Name
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  & robocopy.exe $Source $dest /E /XJ /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if($LASTEXITCODE -ge 8){throw "Could not back up existing $Name data."}
}
function Import-Folder([string]$Source,[string]$Dest,[string]$Label){
  if(-not (Test-Path -LiteralPath $Source -PathType Container)){Write-Host "[SKIP] $Label transfer data not present." -ForegroundColor Yellow; return}
  Backup-Existing $Dest ($Label -replace '[^A-Za-z0-9_-]','_')
  if(Test-Path -LiteralPath $Dest){Remove-Item -LiteralPath $Dest -Recurse -Force}
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  & robocopy.exe $Source $Dest /E /XJ /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if($LASTEXITCODE -ge 8){throw "$Label import failed. Existing copy is preserved in $backup"}
  Write-Host "[OK] $Label imported" -ForegroundColor Green
}

Import-Folder $serviceSrc $serviceDst 'ServiceData'
Import-Folder $purchaseSrc $purchaseDst 'PurchasingData'
Write-Host ("Backup of any previous new-PC data: {0}" -f $backup) -ForegroundColor DarkGray
