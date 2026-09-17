param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$Root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath
$transfer=Join-Path $Root 'MAIN_SERVER_TRANSFER_DATA'
$serviceOut=Join-Path $transfer 'ServiceData'
$purchaseOut=Join-Path $transfer 'PurchasingData'
New-Item -ItemType Directory -Force -Path $transfer | Out-Null

$taskNames=@('NUNES Company Server','NUNES Company Watchdog','NUNES Company Keepalive','NUNES Servicing Warm','NUNES Servicing Keepalive','NUNES WhatsApp Resident','NUNES WhatsApp Keepalive')
foreach($name in $taskNames){
  try{Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue}catch{}
  try{Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null}catch{}
}
Start-Sleep -Milliseconds 700

function Stop-NunesListener([int]$Port){
  try{
    $line=netstat -ano -p tcp | Select-String (':'+$Port+'\s+.*LISTENING') | Select-Object -First 1
    if(-not $line){return}
    $parts=($line.ToString().Trim() -split '\s+')
    $pidToStop=[int]$parts[-1]
    if($pidToStop -le 0){return}
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$pidToStop" -ErrorAction SilentlyContinue
    $cmd=[string]$proc.CommandLine
    if($cmd -match '(?i)(NUNES|ServiceFlow|whatsapp-sidecar\.js|platform\\server\.py|order_forms|service_operations|WorkspaceRuntime)'){
      taskkill /PID $pidToStop /T /F | Out-Null
    }
  }catch{}
}
foreach($p in @(5055,5056,8770,8765,8766,8767,8768,8769,8771,8772,8773,8774,8775,8785,8786,8787,8788,8789,8790,8791,8792,8793,8794,8795,8865,8866,8867,8868,8869,8870,8871,8872,8873,8874,8875)){Stop-NunesListener $p}
Start-Sleep -Milliseconds 400

function Copy-Folder([string]$Source,[string]$Dest,[string]$Label){
  if(-not (Test-Path -LiteralPath $Source -PathType Container)){
    Write-Host ("[SKIP] {0} not found at {1}" -f $Label,$Source) -ForegroundColor Yellow
    return $false
  }
  if(Test-Path -LiteralPath $Dest){Remove-Item -LiteralPath $Dest -Recurse -Force}
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  & robocopy.exe $Source $Dest /E /XJ /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if($LASTEXITCODE -ge 8){throw ("{0} export failed (robocopy code {1}). Source was NOT deleted." -f $Label,$LASTEXITCODE)}
  Write-Host ("[OK] {0} exported" -f $Label) -ForegroundColor Green
  return $true
}

$local=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$serviceSrc=Join-Path $local 'ServiceData'
$purchaseSrc=Join-Path $local 'PurchasingData'
if(-not (Test-Path -LiteralPath $serviceSrc)){ $serviceSrc=Join-Path $Root 'apps\service_operations\data' }
if(-not (Test-Path -LiteralPath $purchaseSrc)){ $purchaseSrc=Join-Path $Root 'apps\order_forms\data' }

$serviceOk=Copy-Folder $serviceSrc $serviceOut 'Servicing + Gmail settings/data'
$purchaseOk=Copy-Folder $purchaseSrc $purchaseOut 'Purchasing data'
@(
  'NUNES MAIN SERVER TRANSFER',
  ('ExportedAt=' + [DateTime]::Now.ToString('s')),
  ('OldComputer=' + $env:COMPUTERNAME),
  ('OldUser=' + $env:USERNAME),
  ('ServiceData=' + $serviceOk),
  ('PurchasingData=' + $purchaseOk),
  'WhatsAppSession=NOT_COPIED_RELINK_ON_NEW_MAIN_SERVER'
) | Set-Content -LiteralPath (Join-Path $transfer 'TRANSFER_INFO.txt') -Encoding UTF8

Write-Host ''
Write-Host 'OLD OWNER SERVER STOPPED.' -ForegroundColor Green
Write-Host 'Data export is ready here:' -ForegroundColor Cyan
Write-Host $transfer
Write-Host 'Copy this whole updated NUNES folder to the new main-server PC, then run B_MAKE_THIS_PC_MAIN_SERVER.bat.' -ForegroundColor Cyan
