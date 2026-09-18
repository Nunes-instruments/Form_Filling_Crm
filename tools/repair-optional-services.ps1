param([string]$Root='')
$ErrorActionPreference='Stop'
$state=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$rootFile=Join-Path $state 'workspace-root.txt'
New-Item -ItemType Directory -Force -Path $state | Out-Null
if([string]::IsNullOrWhiteSpace($Root) -and (Test-Path -LiteralPath $rootFile)){
  $Root=(Get-Content -LiteralPath $rootFile -Raw).Trim()
}
$Root=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if([string]::IsNullOrWhiteSpace($Root)){throw 'NUNES master folder is not configured.'}
$Root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath
$log=Join-Path $state 'optional-services-repair.log'
function Log([string]$m){try{Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' '+$m) -Encoding UTF8}catch{}}
function Rule([int]$p){
  $n="NUNES Operations TCP $p"
  try{Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue|Remove-NetFirewallRule -ErrorAction SilentlyContinue;New-NetFirewallRule -DisplayName $n -Direction Inbound -Action Allow -Protocol TCP -LocalPort ([string]$p) -Profile Any -RemoteAddress @('LocalSubnet','100.64.0.0/10') -ErrorAction Stop|Out-Null}catch{& netsh.exe advfirewall firewall delete rule name="$n"|Out-Null;& netsh.exe advfirewall firewall add rule name="$n" dir=in action=allow protocol=TCP localport=$p profile=any remoteip=localsubnet,100.64.0.0/10|Out-Null}
}
Rule 5055; Rule 5056
$taskUser=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 8 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Priority 0
$psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if(-not(Test-Path -LiteralPath $psExe)){$psExe='powershell.exe'}
function Hidden([string]$Name,[string]$Script,[string]$Extra=''){
  $args='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$Script+'"'
  if($Extra){$args+=' '+$Extra}
  New-ScheduledTaskAction -Execute $psExe -Argument $args -WorkingDirectory (Split-Path -Parent $Script)
}
$svcOk=$false;$waOk=$false
Write-Host '[1/2] Repairing Servicing (5055)...' -ForegroundColor Cyan
try{
  $prep=Join-Path $Root 'tools\prepare-servicing-resident.ps1';if(-not(Test-Path $prep)){throw 'prepare-servicing-resident.ps1 is missing.'}
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $prep -Root $Root
  if($LASTEXITCODE -ne 0){throw "Servicing preparation exit code $LASTEXITCODE"}
  $start=Join-Path $state 'ServicingResident\start-servicing-resident.ps1';if(-not(Test-Path $start)){throw 'Servicing resident launcher is missing.'}
  foreach($t in @('NUNES Servicing Warm','NUNES Servicing Keepalive')){try{Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue}catch{}}
  $a=Hidden 'servicing-resident' $start '-Port 5055'
  Register-ScheduledTask -TaskName 'NUNES Servicing Warm' -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $taskUser) -Settings $settings -Principal $principal -Force|Out-Null
  Register-ScheduledTask -TaskName 'NUNES Servicing Keepalive' -Action $a -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)) -Settings $settings -Principal $principal -Force|Out-Null
  Start-ScheduledTask -TaskName 'NUNES Servicing Warm';Start-Sleep -Milliseconds 300
  $deadline=(Get-Date).AddSeconds(15);while((Get-Date)-lt $deadline){try{$h=Invoke-RestMethod -TimeoutSec 1 'http://127.0.0.1:5055/api/health';if($h.ok -eq $true){$svcOk=$true;break}}catch{};Start-Sleep -Milliseconds 200}
  if(-not $svcOk){throw 'Servicing did not become healthy on 5055.'}
  Write-Host '[OK] Servicing is ready.' -ForegroundColor Green;Log 'Servicing ready.'
}catch{Write-Host ('[ERROR] Servicing: '+$_.Exception.Message) -ForegroundColor Red;Log ('Servicing ERROR: '+$_.Exception.Message)}
Write-Host '[2/2] Repairing WhatsApp resident (5056)...' -ForegroundColor Cyan
try{
  $prep=Join-Path $Root 'tools\prepare-whatsapp-resident.ps1';if(-not(Test-Path $prep)){throw 'prepare-whatsapp-resident.ps1 is missing.'}
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $prep -Root $Root
  if($LASTEXITCODE -ne 0){throw "WhatsApp preparation exit code $LASTEXITCODE"}
  $start=Join-Path $state 'WhatsAppResident\start-whatsapp-resident.ps1';if(-not(Test-Path $start)){throw 'WhatsApp resident launcher is missing.'}
  foreach($t in @('NUNES WhatsApp Resident','NUNES WhatsApp Keepalive')){try{Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue}catch{}}
  $a=Hidden 'whatsapp-resident' $start '-Port 5056'
  Register-ScheduledTask -TaskName 'NUNES WhatsApp Resident' -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $taskUser) -Settings $settings -Principal $principal -Force|Out-Null
  Register-ScheduledTask -TaskName 'NUNES WhatsApp Keepalive' -Action $a -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)) -Settings $settings -Principal $principal -Force|Out-Null
  Start-ScheduledTask -TaskName 'NUNES WhatsApp Resident';Start-Sleep -Milliseconds 500
  try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:5056';if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){$waOk=$true}}catch{if($_.Exception.Response){$waOk=$true}}
  Write-Host '[OK] WhatsApp resident started. Link/login from the NUNES Settings page if needed.' -ForegroundColor Green;Log 'WhatsApp resident started.'
}catch{Write-Host ('[ERROR] WhatsApp: '+$_.Exception.Message) -ForegroundColor Red;Log ('WhatsApp ERROR: '+$_.Exception.Message)}
Write-Host ''
if($svcOk){Write-Host 'Servicing  : READY  http://127.0.0.1:5055' -ForegroundColor Green}else{Write-Host 'Servicing  : NEEDS ATTENTION (see log)' -ForegroundColor Yellow}
if($waOk){Write-Host 'WhatsApp   : STARTED http://127.0.0.1:5056' -ForegroundColor Green}else{Write-Host 'WhatsApp   : check/link from Settings after repair.' -ForegroundColor Yellow}
Write-Host ('Log        : '+$log)
if($svcOk){exit 0}else{exit 2}
