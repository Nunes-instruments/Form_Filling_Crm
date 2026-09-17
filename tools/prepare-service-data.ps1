param(
  [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
  [Parameter(Mandatory=$true)][string]$CurrentData
)
$ErrorActionPreference = 'SilentlyContinue'

$WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
$CurrentData = [IO.Path]::GetFullPath($CurrentData)
$sharedRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$sharedData = Join-Path $sharedRoot 'ServiceData'
$marker = Join-Path $sharedRoot 'service-data-v1.ready'
New-Item -ItemType Directory -Force -Path $sharedRoot | Out-Null

function IsServiceFlowRunning {
  try {
    $r = Invoke-RestMethod -TimeoutSec 0.5 'http://127.0.0.1:5055/api/health'
    return ($r.app -eq 'ServiceFlowJobCards')
  } catch { return $false }
}
function StopServiceFlow {
  if(-not (IsServiceFlowRunning)){ return }
  try {
    $line = netstat -ano -p tcp | Select-String ':5055\s+.*LISTENING' | Select-Object -First 1
    if($line){
      $parts = ($line.ToString().Trim() -split '\s+')
      $pidToStop = [int]$parts[-1]
      if($pidToStop -gt 0){ taskkill /PID $pidToStop /T /F | Out-Null; Start-Sleep -Milliseconds 300 }
    }
  } catch {}
}
function DataScore([string]$dir){
  $jobs = Join-Path $dir 'jobs.json'
  if(!(Test-Path -LiteralPath $jobs)){ return [DateTime]::MinValue }
  try { return (Get-Item -LiteralPath $jobs).LastWriteTimeUtc } catch { return [DateTime]::MinValue }
}
function CopyData([string]$src,[string]$dst){
  if(!(Test-Path -LiteralPath $src)){ return }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  $null = robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1 /XF startup.lock server.pid
  $rc=$LASTEXITCODE
  if($rc -ge 8){ throw "Servicing data copy failed (robocopy code $rc). Source was left untouched: $src" }
  $sourceJobs=Join-Path $src 'jobs.json'
  if((Test-Path -LiteralPath $sourceJobs) -and !(Test-Path -LiteralPath (Join-Path $dst 'jobs.json'))){ throw 'Servicing jobs verification failed after copy. Source was left untouched.' }
}
function IsJunctionTo([string]$path,[string]$target){
  try {
    $item = Get-Item -LiteralPath $path -Force
    if(-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){ return $false }
    $rawTarget = $item.Target
    if($rawTarget -is [Array]){ $rawTarget = $rawTarget[0] }
    if([string]::IsNullOrWhiteSpace([string]$rawTarget)){ return $false }
    $resolved = [IO.Path]::GetFullPath([string]$rawTarget)
    return $resolved.TrimEnd('\') -ieq ([IO.Path]::GetFullPath($target)).TrimEnd('\')
  } catch { return $false }
}

# First V6.3.5 migration only: stop a legacy instance so we can capture its latest data
# and switch all future packages to one persistent shared data directory.
if(!(Test-Path -LiteralPath $marker)){
  StopServiceFlow

  $candidates = New-Object System.Collections.Generic.List[string]
  if(Test-Path -LiteralPath $CurrentData){ $candidates.Add($CurrentData) }
  $parent = Split-Path -Parent $WorkspaceRoot
  if(Test-Path -LiteralPath $parent){
    Get-ChildItem -LiteralPath $parent -Directory -Filter 'NUNES*' -ErrorAction SilentlyContinue | ForEach-Object {
      $d = Join-Path $_.FullName 'apps\service_operations\data'
      if(Test-Path -LiteralPath $d){ $candidates.Add($d) }
    }
  }
  $best = $null; $bestScore = [DateTime]::MinValue
  foreach($d in $candidates){
    $score = DataScore $d
    if($score -gt $bestScore){ $best = $d; $bestScore = $score }
  }
  if($best){ CopyData $best $sharedData } else { New-Item -ItemType Directory -Force -Path $sharedData | Out-Null }
  New-Item -ItemType File -Force -Path $marker | Out-Null
} elseif(!(Test-Path -LiteralPath $sharedData)){
  New-Item -ItemType Directory -Force -Path $sharedData | Out-Null
}

# Every extracted package gets a zero-copy junction to the SAME persistent ServiceData.
if(!(IsJunctionTo $CurrentData $sharedData)){
  if(Test-Path -LiteralPath $CurrentData){
    # If this package itself contains newer real data, merge it before replacing the folder.
    $curScore = DataScore $CurrentData; $sharedScore = DataScore $sharedData
    if($curScore -gt $sharedScore){ CopyData $CurrentData $sharedData }
    $removeCmd = 'rmdir /S /Q "{0}"' -f $CurrentData
    cmd.exe /d /c $removeCmd | Out-Null
  }
  $linkCmd = 'mklink /J "{0}" "{1}"' -f $CurrentData, $sharedData
  cmd.exe /d /c $linkCmd | Out-Null
}

Write-Output $sharedData
