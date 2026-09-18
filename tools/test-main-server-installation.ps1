param(
  [Parameter(Mandatory=$true)][string]$Root,
  [switch]$RequireHealth,
  [switch]$Quiet
)
$ErrorActionPreference='Stop'
$Root=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
try{$Root=(Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath}catch{if(-not $Quiet){Write-Host '[NOT READY] Master folder does not exist.' -ForegroundColor Red};exit 1}
$state=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$reasons=New-Object System.Collections.Generic.List[string]
function SamePath([string]$A,[string]$B){
  try{return ([IO.Path]::GetFullPath($A).TrimEnd('\\') -ieq [IO.Path]::GetFullPath($B).TrimEnd('\\'))}catch{return $false}
}
function Health([string]$Url,[string]$Expected){
  try{$r=Invoke-RestMethod -TimeoutSec 1 $Url;return ($r.ok -eq $true -and [string]$r.product -eq $Expected)}catch{return $false}
}
$rootFile=Join-Path $state 'workspace-root.txt'
if(-not (Test-Path -LiteralPath $rootFile -PathType Leaf)){$reasons.Add('workspace-root.txt is missing.')}
else{
  try{$saved=(Get-Content -LiteralPath $rootFile -Raw).Trim().Trim([char]34).Trim([char]39);if(-not (SamePath $saved $Root)){$reasons.Add('Desktop/server root still points to an older NUNES folder.')}}catch{$reasons.Add('workspace-root.txt could not be read.')}
}
$configFile=Join-Path $state 'CompanyResident\company-resident.json'
if(-not (Test-Path -LiteralPath $configFile -PathType Leaf)){$reasons.Add('Company fast-resident configuration is missing.')}
else{
  try{
    $c=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    if(-not (SamePath ([string]$c.root) $Root)){$reasons.Add('Company resident is bound to an older NUNES folder.')}
    if([int]$c.dashboardPort -ne 8795){$reasons.Add('Company resident still uses an older dashboard port; expected 8795.')}
    foreach($pair in @(
      @('Node runtime',[string]$c.nodeExe),
      @('Python runtime',[string]$c.pythonExe),
      @('Dashboard runtime',[string]$c.dashboardServer),
      @('Data API',[string]$c.dataServer)
    )){if([string]::IsNullOrWhiteSpace($pair[1]) -or -not (Test-Path -LiteralPath $pair[1] -PathType Leaf)){$reasons.Add($pair[0]+' is missing from the prepared resident.')}}
  }catch{$reasons.Add('Company resident configuration is invalid JSON or unreadable.')}
}
foreach($name in @('NUNES Company Server','NUNES Company Keepalive')){
  if(-not (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)){$reasons.Add('Critical scheduled task missing: '+$name)}
}
$optionalMissing=@()
foreach($name in @('NUNES Servicing Warm','NUNES Servicing Keepalive','NUNES WhatsApp Resident','NUNES WhatsApp Keepalive')){
  if(-not (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)){$optionalMissing+=$name}
}
if(-not (Test-Path -LiteralPath (Join-Path $state 'open-nunes-desktop.ps1') -PathType Leaf)){$reasons.Add('Stable desktop launcher is missing.')}
if($RequireHealth){
  if(-not (Health 'http://127.0.0.1:8795/api/health' 'NUNES Company Platform')){$reasons.Add('Main dashboard is not healthy on 8795.')}
}
if($reasons.Count -gt 0){
  if(-not $Quiet){Write-Host '[NOT READY] NUNES installation needs repair/rebind:' -ForegroundColor Yellow;$reasons|ForEach-Object{Write-Host ('  - '+$_) -ForegroundColor Yellow}}
  exit 1
}
if(-not $Quiet){
  Write-Host '[OK] This folder is the prepared NUNES main-server root.' -ForegroundColor Green
  if($optionalMissing.Count -gt 0){
    Write-Host ('[WARNING] Optional connection/service tasks still need repair: ' + ($optionalMissing -join ', ')) -ForegroundColor Yellow
    Write-Host 'Run 5_REPAIR_SERVICING_WHATSAPP.bat after the dashboard is live.' -ForegroundColor Yellow
  }
}
exit 0
