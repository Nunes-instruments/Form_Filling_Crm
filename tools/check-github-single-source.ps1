param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='SilentlyContinue'
$Root=(Resolve-Path -LiteralPath $Root).ProviderPath
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' NUNES GITHUB SINGLE SOURCE STATUS' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ('Folder : ' + $Root)
Write-Host 'Port   : 8795 (8765 untouched)'
Write-Host ''

try{
  $h=Invoke-RestMethod -TimeoutSec 2 ('http://127.0.0.1:8795/api/health?_status=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  if($h.ok -eq $true){
    Write-Host ('[OK] Main server running. Version=' + $h.version + ' Update=' + $h.update_id) -ForegroundColor Green
  } else { Write-Host '[WARN] Main server health response was not OK.' -ForegroundColor Yellow }
}catch{ Write-Host '[ERROR] Main server is not reachable on 127.0.0.1:8795' -ForegroundColor Red }

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if($git -and (Test-Path -LiteralPath (Join-Path $Root '.git'))){
  $branch=(& $git.Source -C $Root branch --show-current 2>$null | Select-Object -First 1)
  $local=(& $git.Source -C $Root rev-parse HEAD 2>$null | Select-Object -First 1)
  $origin=(& $git.Source -C $Root remote get-url origin 2>$null | Select-Object -First 1)
  Write-Host ('[GIT] Branch : ' + $branch)
  Write-Host ('[GIT] Origin : ' + $origin)
  Write-Host ('[GIT] Local  : ' + $local)
  & $git.Source -C $Root fetch origin main --prune *> $null
  $remote=(& $git.Source -C $Root rev-parse origin/main 2>$null | Select-Object -First 1)
  Write-Host ('[GIT] Remote : ' + $remote)
  if($local -and $remote -and $local -eq $remote){Write-Host '[OK] Local source matches GitHub main.' -ForegroundColor Green}
  elseif($local -and $remote){Write-Host '[INFO] Local/GitHub commits differ. Auto updater or a pending local edit may be involved.' -ForegroundColor Yellow}
  $dirty=@(& $git.Source -C $Root status --porcelain 2>$null)
  if($dirty.Count -gt 0){Write-Host '[INFO] Local source has uncommitted changes. Auto-pull waits until they are committed/pushed.' -ForegroundColor Yellow}
}else{Write-Host '[ERROR] Git repository is not ready in this folder.' -ForegroundColor Red}

try{
  $t=Get-ScheduledTask -TaskName 'NUNES GitHub Auto Update' -ErrorAction Stop
  $i=Get-ScheduledTaskInfo -TaskName 'NUNES GitHub Auto Update'
  Write-Host ('[OK] Auto update task: ' + $t.State + '  LastResult=' + $i.LastTaskResult) -ForegroundColor Green
}catch{Write-Host '[ERROR] NUNES GitHub Auto Update task is not installed.' -ForegroundColor Red}

$log=Join-Path $env:LOCALAPPDATA 'NUNES Operations\github-auto-update.log'
if(Test-Path -LiteralPath $log){
  Write-Host ''; Write-Host 'Recent auto-update log:' -ForegroundColor Cyan
  Get-Content -LiteralPath $log -Tail 12
}
