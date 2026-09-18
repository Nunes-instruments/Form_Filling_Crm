param(
  [string]$Root = '',
  [int]$TimeoutSeconds = 80,
  [switch]$Quiet
)
$ErrorActionPreference='Stop'
$state=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$rootFile=Join-Path $state 'workspace-root.txt'
$log=Join-Path $state 'desktop-launcher.log'
$status=Join-Path $state 'server-status.txt'
$base='http://127.0.0.1:8795'
New-Item -ItemType Directory -Force -Path $state|Out-Null
function Log([string]$m){try{Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' READY-CHECK '+$m) -Encoding UTF8}catch{}}
function H([int]$ms=250){try{$q=[Net.HttpWebRequest]::Create($base+'/api/health');$q.Method='GET';$q.Timeout=$ms;$q.ReadWriteTimeout=$ms;$q.Proxy=$null;$r=$q.GetResponse();try{$sr=New-Object IO.StreamReader($r.GetResponseStream());$j=($sr.ReadToEnd()|ConvertFrom-Json);$sr.Dispose();return($j.ok -eq $true -and [string]$j.product -eq 'NUNES Company Platform')}finally{$r.Close()}}catch{return $false}}
function WaitReady([int]$ms){$d=[DateTime]::UtcNow.AddMilliseconds($ms);while([DateTime]::UtcNow -lt $d){if(H 220){return $true};Start-Sleep -Milliseconds 120};return $false}
function Same([string]$a,[string]$b){try{return([IO.Path]::GetFullPath($a).TrimEnd('\\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\\'))}catch{return $false}}
if(H 180){if(-not $Quiet){Write-Host '[OK] Main server already ready on 8795.' -ForegroundColor Green};exit 0}
if([string]::IsNullOrWhiteSpace($Root) -and (Test-Path -LiteralPath $rootFile)){try{$Root=(Get-Content -LiteralPath $rootFile -Raw).Trim()}catch{}}
if(-not [string]::IsNullOrWhiteSpace($Root)){$Root=[Environment]::ExpandEnvironmentVariables($Root).Trim().Trim([char]34).Trim([char]39);try{$Root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath}catch{$Root=''}}
$residentOk=$false
$config=Join-Path $state 'CompanyResident\company-resident.json'
if($Root -and (Test-Path -LiteralPath $config -PathType Leaf)){
  try{$c=Get-Content -LiteralPath $config -Raw|ConvertFrom-Json;$residentOk=(Same ([string]$c.root) $Root) -and ([int]$c.dashboardPort -eq 8795) -and (Test-Path -LiteralPath ([string]$c.nodeExe) -PathType Leaf) -and (Test-Path -LiteralPath ([string]$c.pythonExe) -PathType Leaf) -and (Test-Path -LiteralPath ([string]$c.dashboardServer) -PathType Leaf) -and (Test-Path -LiteralPath ([string]$c.dataServer) -PathType Leaf)}catch{$residentOk=$false}
}
if($residentOk){
  Log ('Prepared resident matches current root: '+$Root)
  foreach($t in @('NUNES Company Server','NUNES Servicing Warm','NUNES WhatsApp Resident')){try{Start-ScheduledTask -TaskName $t -ErrorAction Stop}catch{}}
  try{$p=Join-Path $state 'CompanyResident\start-company-resident.ps1';if(Test-Path -LiteralPath $p){Start-Process powershell.exe -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$p) -WindowStyle Hidden|Out-Null}}catch{}
  if(WaitReady 9000){if(-not $Quiet){Write-Host '[OK] Main server restored from prepared resident.' -ForegroundColor Green};exit 0}
  Log 'Prepared resident did not become healthy; switching to current-master fallback.'
}else{Log 'Prepared resident is missing/stale for current master; skipping stale resident recovery.'}
if(-not $Root){Log 'No valid current master root available.';if(-not $Quiet){Write-Host '[ERROR] Current NUNES master folder could not be resolved.' -ForegroundColor Red};exit 1}
$bat=Join-Path $Root 'START_SERVER_AUTOMATIC.bat'
if(-not(Test-Path -LiteralPath $bat -PathType Leaf)){Log ('Missing fallback: '+$bat);if(-not $Quiet){Write-Host '[ERROR] START_SERVER_AUTOMATIC.bat is missing.' -ForegroundColor Red};exit 1}
try{
  Log ('Starting current master directly: '+$Root)
  $arg='/d /s /c ""'+$bat+'""'
  Start-Process -FilePath $env:ComSpec -ArgumentList $arg -WorkingDirectory $Root -WindowStyle Hidden|Out-Null
}catch{Log ('Direct fallback failed: '+$_.Exception.Message)}
$wait=[Math]::Max(12000,$TimeoutSeconds*1000)
if(WaitReady $wait){if(-not $Quiet){Write-Host '[OK] Main server started from the current master folder.' -ForegroundColor Green};exit 0}
$details=@()
try{if(Test-Path $status){$details+=('Status: '+(Get-Content $status -Raw).Trim())}}catch{}
try{$s=Join-Path $Root 'server-startup.log';if(Test-Path $s){$details+='Latest startup log:';$details+=Get-Content $s -Tail 18}}catch{}
try{$e=Join-Path $state 'dashboard-stderr.log';if(Test-Path $e){$tail=Get-Content $e -Tail 12;if($tail){$details+='Dashboard stderr:';$details+=$tail}}}catch{}
Log ('FAILED. '+($details -join ' | '))
if(-not $Quiet){Write-Host '[ERROR] Main server did not become ready on 8795.' -ForegroundColor Red;$details|ForEach-Object{Write-Host $_};Write-Host 'Run 0_REPAIR_AND_START_MAIN_SERVER.bat as Administrator from the CURRENT full folder.' -ForegroundColor Yellow}
exit 1
