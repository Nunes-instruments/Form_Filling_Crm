$ErrorActionPreference='SilentlyContinue'
$state=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$resident=Join-Path $state 'ServicingResident'
$config=Join-Path $resident 'servicing-resident.json'
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' NUNES SERVICING SPEED CHECK' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ('Time: ' + (Get-Date))
foreach($name in @('NUNES Servicing Warm','NUNES Servicing Keepalive')){
  try{$t=Get-ScheduledTask -TaskName $name -ErrorAction Stop;$i=Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue;Write-Host ("Task {0}: {1}  LastResult={2}" -f $name,$t.State,$i.LastTaskResult)}catch{Write-Host ("Task {0}: MISSING" -f $name) -ForegroundColor Yellow}
}
if(Test-Path -LiteralPath $config){
  Write-Host ('Resident config: ' + $config) -ForegroundColor Green
  try{$c=Get-Content -LiteralPath $config -Raw|ConvertFrom-Json;Write-Host ('Runtime: '+$c.runtimeApp);Write-Host ('Server entry: '+$c.serverEntry);Write-Host ('Standalone exists: '+(Test-Path -LiteralPath ([string]$c.serverEntry)))}catch{}
}else{Write-Host 'Resident config: MISSING - run 1_SETUP_ALWAYS_ON_SERVER.bat once.' -ForegroundColor Red}
function Time-Url([string]$u,[int]$TargetMs=1000){$sw=[Diagnostics.Stopwatch]::StartNew();try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri $u;$sw.Stop();$ms=$sw.ElapsedMilliseconds;$c=if($ms -le $TargetMs){'Green'}else{'Yellow'};Write-Host ("{0} -> HTTP {1} in {2} ms (target <= {3} ms)" -f $u,[int]$r.StatusCode,$ms,$TargetMs) -ForegroundColor $c}catch{$sw.Stop();Write-Host ("{0} -> FAILED after {1} ms : {2}" -f $u,$sw.ElapsedMilliseconds,$_.Exception.Message) -ForegroundColor Red}}
Time-Url 'http://127.0.0.1:5055/api/health'
Time-Url 'http://127.0.0.1:5055/jobs/new'
try{$line=netstat -ano -p tcp|Select-String ':5055\s+.*LISTENING'|Select-Object -First 1;if($line){$parts=($line.ToString().Trim()-split '\s+');$pid=[int]$parts[-1];$p=Get-Process -Id $pid -ErrorAction SilentlyContinue;Write-Host ("Port 5055 PID: {0}  Process: {1}  Started: {2}" -f $pid,$p.ProcessName,$p.StartTime)}}catch{}
Write-Host '============================================================'

Write-Host 'Note: first browser paint also depends on the staff PC/browser/Tailscale latency; the hidden prewarmer removes most of that cost after dashboard load.' -ForegroundColor DarkGray
