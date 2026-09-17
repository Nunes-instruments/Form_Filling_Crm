param(
  [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
  [Parameter(Mandatory=$true)][string]$CurrentData
)
$ErrorActionPreference='Stop'
$WorkspaceRoot=(Resolve-Path -LiteralPath $WorkspaceRoot).Path
$CurrentData=[IO.Path]::GetFullPath($CurrentData)
$sharedRoot=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$sharedData=Join-Path $sharedRoot 'PurchasingData'
$marker=Join-Path $sharedRoot 'purchasing-data-v1.ready'
New-Item -ItemType Directory -Force -Path $sharedRoot | Out-Null

function DataScore([string]$dir){
  $db=Join-Path $dir 'nunes_forms.db'
  if(!(Test-Path -LiteralPath $db)){return [DateTime]::MinValue}
  try{return (Get-Item -LiteralPath $db).LastWriteTimeUtc}catch{return [DateTime]::MinValue}
}
function CopyData([string]$src,[string]$dst){
  if(!(Test-Path -LiteralPath $src)){return}
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  $null=robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1
  $rc=$LASTEXITCODE
  if($rc -ge 8){throw "Purchasing data copy failed (robocopy code $rc). Source was left untouched: $src"}
  $sourceDb=Join-Path $src 'nunes_forms.db'
  if((Test-Path -LiteralPath $sourceDb) -and !(Test-Path -LiteralPath (Join-Path $dst 'nunes_forms.db'))){throw 'Purchasing database verification failed after copy. Source was left untouched.'}
}
function IsJunctionTo([string]$path,[string]$target){
  try{
    $item=Get-Item -LiteralPath $path -Force
    if(-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){return $false}
    $raw=$item.Target;if($raw -is [Array]){$raw=$raw[0]}
    if([string]::IsNullOrWhiteSpace([string]$raw)){return $false}
    return ([IO.Path]::GetFullPath([string]$raw)).TrimEnd('\') -ieq ([IO.Path]::GetFullPath($target)).TrimEnd('\')
  }catch{return $false}
}
function StopPurchasingIfRunning {
  try{
    $r=Invoke-RestMethod -TimeoutSec 1 'http://127.0.0.1:8770/health'
    if($r.ok -ne $true){return}
    $line=netstat -ano -p tcp | Select-String ':8770\s+.*LISTENING' | Select-Object -First 1
    if($line){$parts=($line.ToString().Trim() -split '\s+');$pidToStop=[int]$parts[-1];if($pidToStop -gt 0){taskkill /PID $pidToStop /T /F | Out-Null;Start-Sleep -Milliseconds 300}}
  }catch{}
}

if(!(Test-Path -LiteralPath $marker)){
  StopPurchasingIfRunning
  $candidates=New-Object System.Collections.Generic.List[string]
  if(Test-Path -LiteralPath $CurrentData){$candidates.Add($CurrentData)}
  $parent=Split-Path -Parent $WorkspaceRoot
  if(Test-Path -LiteralPath $parent){
    Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $d=Join-Path $_.FullName 'apps\order_forms\data'
      if(Test-Path -LiteralPath $d){$candidates.Add($d)}
    }
  }
  $best=$null;$bestScore=[DateTime]::MinValue
  foreach($d in $candidates){$score=DataScore $d;if($score -gt $bestScore){$best=$d;$bestScore=$score}}
  if($best -and $bestScore -gt [DateTime]::MinValue){CopyData $best $sharedData}else{New-Item -ItemType Directory -Force -Path $sharedData | Out-Null}
  New-Item -ItemType File -Force -Path $marker | Out-Null
}elseif(!(Test-Path -LiteralPath $sharedData)){
  New-Item -ItemType Directory -Force -Path $sharedData | Out-Null
}

if(!(IsJunctionTo $CurrentData $sharedData)){
  if(Test-Path -LiteralPath $CurrentData){
    $curScore=DataScore $CurrentData;$sharedScore=DataScore $sharedData
    if($curScore -gt $sharedScore){CopyData $CurrentData $sharedData}
    cmd.exe /d /c ('rmdir /S /Q "{0}"' -f $CurrentData) | Out-Null
  }
  cmd.exe /d /c ('mklink /J "{0}" "{1}"' -f $CurrentData,$sharedData) | Out-Null
}
if(!(IsJunctionTo $CurrentData $sharedData)){throw 'Could not connect persistent Purchasing data folder.'}
Write-Output $sharedData
