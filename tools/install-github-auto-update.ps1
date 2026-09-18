param(
  [Parameter(Mandatory=$true)][string]$Root,
  [switch]$Quiet
)

$ErrorActionPreference='Stop'
$received=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if([string]::IsNullOrWhiteSpace($received)){throw 'NUNES master folder path is empty.'}
$Root=(Resolve-Path -LiteralPath $received -ErrorAction Stop).ProviderPath
$watcher=Join-Path $Root 'tools\github-auto-watcher.ps1'
if(-not (Test-Path -LiteralPath $watcher -PathType Leaf)){throw "GitHub auto watcher is missing: $watcher"}
if(-not (Test-Path -LiteralPath (Join-Path $Root '.git') -PathType Container)){throw 'This NUNES master folder is not a Git repository.'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'Git for Windows is not installed or not in PATH.'}
$gitExe=$git.Source
$expected='https://github.com/Nunes-instruments/Form_Filling_Crm.git'

# Missing origin is a normal first-run condition. Probe the remote list first so
# Windows PowerShell 5 never turns Git's STDERR into a NativeCommandError.
$oldPreference=$ErrorActionPreference
try {
  $ErrorActionPreference='Continue'
  $remoteNames=@(& $gitExe -C $Root remote 2>&1 | ForEach-Object { [string]$_ })
  $remoteRc=$LASTEXITCODE
} finally { $ErrorActionPreference=$oldPreference }
if($remoteRc -ne 0){throw 'Could not inspect Git remotes.'}
$origin=''
if(@($remoteNames | ForEach-Object {$_.Trim()}) -contains 'origin'){
  try {
    $ErrorActionPreference='Continue'
    $originLines=@(& $gitExe -C $Root remote get-url origin 2>&1 | ForEach-Object { [string]$_ })
    $originRc=$LASTEXITCODE
  } finally { $ErrorActionPreference=$oldPreference }
  if($originRc -eq 0){$origin=([string]($originLines | Select-Object -First 1)).Trim()}
}
if([string]::IsNullOrWhiteSpace($origin)){
  & $gitExe -C $Root remote add origin $expected
  if($LASTEXITCODE -ne 0){throw 'Could not add the Form_Filling_Crm GitHub remote.'}
  $origin=$expected
}
if($origin.TrimEnd('/').ToLowerInvariant() -ne $expected.TrimEnd('/').ToLowerInvariant()){
  throw "Unexpected Git origin. Expected $expected but found $origin"
}

$stateRoot=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$hiddenDir=Join-Path $stateRoot 'HiddenLaunchers'
New-Item -ItemType Directory -Force -Path $hiddenDir | Out-Null
$vbsPath=Join-Path $hiddenDir 'github-auto-update.vbs'
$ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if(-not (Test-Path -LiteralPath $ps)){ $ps='powershell.exe' }
$cmd=$ps + ' -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $watcher + '" -Root "' + $Root + '"'
$vbs=@"
Option Explicit
Dim sh, cmd
Set sh = CreateObject("WScript.Shell")
cmd = "$($cmd.Replace('"','""'))"
sh.Run cmd, 0, False
"@
Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII

$wscript=Join-Path $env:SystemRoot 'System32\wscript.exe'
if(-not (Test-Path -LiteralPath $wscript)){ $wscript='wscript.exe' }
$action=New-ScheduledTaskAction -Execute $wscript -Argument ('"{0}"' -f $vbsPath) -WorkingDirectory $Root
$taskUser=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$logon=New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'NUNES GitHub Auto Update' -Action $action -Trigger @($logon,$repeat) -Settings $settings -Principal $principal -Force | Out-Null

try { Start-ScheduledTask -TaskName 'NUNES GitHub Auto Update' -ErrorAction SilentlyContinue } catch {}

$statusFile=Join-Path $stateRoot 'github-auto-update-installed.txt'
Set-Content -LiteralPath $statusFile -Value @(
  'NUNES GitHub Auto Update',
  ('Installed=' + (Get-Date).ToString('s')),
  ('Root=' + $Root),
  ('Remote=' + $expected),
  'Branch=main',
  'Interval=1 minute'
) -Encoding UTF8

if(-not $Quiet){
  Write-Host ''
  Write-Host 'NUNES GitHub Auto Update is ENABLED.' -ForegroundColor Green
  Write-Host 'Repository: Nunes-instruments/Form_Filling_Crm'
  Write-Host 'Branch    : main'
  Write-Host 'Check     : every 1 minute'
  Write-Host 'Staff/owner PCs do not need Git, VS Code, ZIPs, or update scripts.' -ForegroundColor Green
}
exit 0
