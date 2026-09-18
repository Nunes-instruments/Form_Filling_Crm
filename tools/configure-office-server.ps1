param([Parameter(Mandatory=$true)][string]$Root)

$ErrorActionPreference = 'Stop'

# Do not call GetFullPath() directly on the command-line value. A quoted BAT
# argument ending in a backslash can arrive with an extra quote character on
# some Windows command-line paths (for example C:\Folder\"). Resolve the
# already-existing application folder after stripping only wrapping quotes.
$receivedRoot = [Environment]::ExpandEnvironmentVariables([string]$Root).Trim()
$receivedRoot = $receivedRoot.Trim([char]34).Trim([char]39).Trim()
if ([string]::IsNullOrWhiteSpace($receivedRoot)) { throw 'NUNES application folder path is empty.' }
try {
  $Root = (Resolve-Path -LiteralPath $receivedRoot -ErrorAction Stop).ProviderPath
} catch {
  throw ("NUNES application folder could not be resolved. Received: [{0}]. {1}" -f $receivedRoot, $_.Exception.Message)
}

# V7 NETWORK/NTFS FIX:
# Windows directory junctions (used by the fast reusable build/data caches) cannot
# be created when the LINK itself lives on a UNC/network volume. Older setups could
# therefore fail with:
#   "Local NTFS volumes are required to complete the operation."
#
# If this ZIP was extracted on a NAS/shared path, make a small LOCAL working mirror
# first and run the actual NUNES server from that local NTFS folder. The shared folder
# remains only the installation source. Persistent Purchasing/Servicing data still
# lives under LOCALAPPDATA exactly as before.
$InstallSourceRoot = $Root

function Test-NunesRemotePath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  if ($Path.StartsWith('\\')) { return $true }
  try {
    $pathRoot = [IO.Path]::GetPathRoot($Path)
    if ($pathRoot -match '^[A-Za-z]:\\$') {
      $device = $pathRoot.Substring(0,2)
      try {
        $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}'" -f $device) -ErrorAction Stop
        if ($disk -and [int]$disk.DriveType -eq 4) { return $true }
      } catch {
        try {
          $drive = Get-PSDrive -Name $device.Substring(0,1) -ErrorAction Stop
          if ($drive.DisplayRoot -and ([string]$drive.DisplayRoot).StartsWith('\\')) { return $true }
        } catch {}
      }
    }
  } catch {}
  return $false
}

if (Test-NunesRemotePath $Root) {
  Write-Host ''
  Write-Host 'Network/shared NUNES folder detected.' -ForegroundColor Yellow
  Write-Host 'Creating a local NTFS runtime so Windows junction/cache operations are reliable...' -ForegroundColor Cyan

  $runtimeParent = Join-Path $env:LOCALAPPDATA 'NUNES Operations\WorkspaceRuntime'
  $localRoot = Join-Path $runtimeParent 'NUNES_OPERATIONS_WORKSPACE_V6_5_0'
  New-Item -ItemType Directory -Force -Path $runtimeParent,$localRoot | Out-Null

  $mirrorMarker = Join-Path $localRoot '.nunes-local-runtime.ready'
  $isFirstMirror = -not (Test-Path -LiteralPath $mirrorMarker)

  $excludeDirs = @(
    (Join-Path $InstallSourceRoot 'platform_web\node_modules'),
    (Join-Path $InstallSourceRoot 'platform_web\.next'),
    (Join-Path $InstallSourceRoot 'apps\service_operations\node_modules'),
    (Join-Path $InstallSourceRoot 'apps\service_operations\.next'),
    (Join-Path $InstallSourceRoot 'apps\service_operations\logs')
  )
  if (-not $isFirstMirror) {
    $excludeDirs += (Join-Path $InstallSourceRoot 'apps\order_forms\data')
    $excludeDirs += (Join-Path $InstallSourceRoot 'apps\service_operations\data')
  }

  $roboArgs = @(
    $InstallSourceRoot, $localRoot,
    '/E','/XJ','/COPY:DAT','/DCOPY:DAT','/R:2','/W:1',
    '/NFL','/NDL','/NJH','/NJS','/NP'
  )
  if ($excludeDirs.Count -gt 0) {
    $roboArgs += '/XD'
    $roboArgs += $excludeDirs
  }
  $roboArgs += '/XF'
  $roboArgs += @('server-startup.log','OPEN_ON_OTHER_DEVICES.txt')

  & robocopy.exe @roboArgs | Out-Null
  $mirrorRc = $LASTEXITCODE
  if ($mirrorRc -ge 8) {
    throw ("Could not create the local NUNES runtime (robocopy code {0}). The source folder was left unchanged: {1}" -f $mirrorRc,$InstallSourceRoot)
  }

  Set-Content -LiteralPath $mirrorMarker -Value @(
    'NUNES LOCAL NTFS RUNTIME',
    ('Source=' + $InstallSourceRoot),
    ('Updated=' + [DateTime]::Now.ToString('s'))
  ) -Encoding UTF8

  $sourcePointer = Join-Path $env:LOCALAPPDATA 'NUNES Operations\installation-source.txt'
  Set-Content -LiteralPath $sourcePointer -Value $InstallSourceRoot -Encoding UTF8

  $Root = (Resolve-Path -LiteralPath $localRoot -ErrorAction Stop).ProviderPath
  Write-Host ("Local runtime ready: {0}" -f $Root) -ForegroundColor Green
  Write-Host 'The server and Servicing engine will run from this local folder.' -ForegroundColor Green
}
# V6.5.12 ROOT-BIND FIX: persist the exact active master/runtime root BEFORE
# touching tasks. Older fast-repair builds could refresh the Desktop shortcut to a
# new extracted folder while the CompanyResident task still pointed at an older
# folder. If that old folder was later removed, daily restore failed.
$stateRootForBinding = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
New-Item -ItemType Directory -Force -Path $stateRootForBinding | Out-Null
Set-Content -LiteralPath (Join-Path $stateRootForBinding 'workspace-root.txt') -Value $Root -Encoding UTF8

$launcher = Join-Path $Root 'START_SERVER_AUTOMATIC.bat'
$watchdog = Join-Path $Root 'NUNES_SERVER_WATCHDOG.bat'
$desktopLauncher = Join-Path $Root 'OPEN_NUNES_DESKTOP.bat'
if (-not (Test-Path $launcher)) { throw "Automatic launcher is missing: $launcher" }
if (-not (Test-Path $watchdog)) { throw "Watchdog is missing: $watchdog" }
if (-not (Test-Path $desktopLauncher)) {
  $desktopLauncher = Join-Path $Root '2_OPEN_NUNES_DESKTOP.bat'
}
if (-not (Test-Path $desktopLauncher)) { throw "Desktop launcher is missing in: $Root" }

# Configure Windows Firewall using ONLY individual validated numeric ports.
# TAILSCALE STAFF ACCESS FIX: allow office LAN plus Tailscale CGNAT peers (100.64.0.0/10).
# Do not pass comma-separated values or port-range text to -LocalPort because
# some Windows builds reject those strings with HRESULT 0x80070057.
$legacyRuleNames = @(
  'NUNES Company Platform',
  'NUNES Company Data API',
  'NUNES Purchasing and Servicing'
)
foreach ($legacyName in $legacyRuleNames) {
  Get-NetFirewallRule -DisplayName $legacyName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

# V6.5.15 FIXED-PORT UPDATE: TCP 8765 and all unrelated ports are untouched.
# Remove only obsolete NUNES firewall rules on ports that this release no longer uses.
foreach ($oldPort in @(8766,8767,8768,8769,8771,8772,8773,8774,8775,8786,8787,8788,8789,8790,8791,8792,8793,8794)) {
  Get-NetFirewallRule -DisplayName ("NUNES Operations TCP $oldPort") -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

$requiredPorts = @(5055,5056,8770,8795)
$requiredPorts = @($requiredPorts | ForEach-Object { [int]$_ } | Where-Object { $_ -ge 1 -and $_ -le 65535 } | Sort-Object -Unique)
if (-not $requiredPorts -or $requiredPorts.Count -lt 1) { throw 'No valid NUNES firewall ports were generated.' }

foreach ($port in $requiredPorts) {
  $portText = [string]$port
  $ruleName = "NUNES Operations TCP $portText"
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  try {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $portText -Profile Any -RemoteAddress @('LocalSubnet','100.64.0.0/10') -ErrorAction Stop | Out-Null
  } catch {
    # Fallback for Windows editions where the NetSecurity cmdlet behaves
    # differently. netsh receives one plain numeric port at a time as well.
    & netsh.exe advfirewall firewall delete rule name="$ruleName" | Out-Null
    & netsh.exe advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$portText profile=any remoteip=localsubnet,100.64.0.0/10 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw ("Could not create Windows Firewall rule for TCP port {0}. {1}" -f $portText, $_.Exception.Message)
    }
  }
}

# Stop any older setup/watchdog instance first. Previous V6.5.0 builds could
# remain stuck at an invisible PAUSE after a startup error, causing IgnoreNew to
# reject every later start attempt. Re-registering then starts one clean instance.
foreach ($oldTask in @('NUNES Company Server','NUNES Company Watchdog','NUNES Company Keepalive','NUNES Servicing Warm','NUNES Servicing Keepalive','NUNES WhatsApp Resident','NUNES WhatsApp Keepalive')) {
  try { Stop-ScheduledTask -TaskName $oldTask -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 500
Remove-Item (Join-Path $env:LOCALAPPDATA 'NUNES Operations\server-status.txt') -Force -ErrorAction SilentlyContinue

# Remove only legacy automatic launch entries owned by older NUNES builds. These old
# BAT/CMD launchers are the usual source of black terminal windows appearing by
# themselves after Windows login. The normal desktop shortcut is not touched.
try {
  $startup=[Environment]::GetFolderPath('Startup')
  if($startup -and (Test-Path -LiteralPath $startup)){
    Get-ChildItem -LiteralPath $startup -File -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -match '^NUNES.*\.(bat|cmd|lnk|vbs)$'
    } | Remove-Item -Force -ErrorAction SilentlyContinue
  }
} catch {}
try {
  $runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if(Test-Path $runKey){
    $props=Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue
    foreach($prop in $props.PSObject.Properties){
      if($prop.Name -match '^PS'){continue}
      $value=[string]$prop.Value
      if($value -match '(?i)NUNES' -and $value -match '(?i)(START_NUNES_COMPANY|START_SERVER_AUTOMATIC|NUNES_SERVER_WATCHDOG)'){
        Remove-ItemProperty -Path $runKey -Name $prop.Name -Force -ErrorAction SilentlyContinue
      }
    }
  }
} catch {}

# SPEED-ONLY V5: prepare Servicing completely during this one-time setup. This is the
# only time npm/build work is allowed to happen. Daily Windows sign-in then launches an
# already-built local resident directly from LOCALAPPDATA without touching the network share.
# Prevent accidental QuickEdit selection from freezing console output during setup.
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NunesSetupConsole {
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint mode);
}
'@
  $inputHandle = [NunesSetupConsole]::GetStdHandle(-10)
  [uint32]$consoleMode = 0
  if ([NunesSetupConsole]::GetConsoleMode($inputHandle, [ref]$consoleMode)) {
    [void][NunesSetupConsole]::SetConsoleMode($inputHandle, (($consoleMode -bor 0x80) -band (-bnot 0x40)))
  }
} catch { }

# V6.5.15 STABLE-START ORDER:
# The company dashboard is CRITICAL and is prepared FIRST. Servicing and WhatsApp are
# optional connection modules; a failure in either must never prevent the main NUNES
# dashboard from starting on TCP 8795.

# Before replacing the dashboard build, stop only VERIFIED old NUNES processes on the
# fixed dashboard/API ports. This prevents an old Next.js process from serving an old
# HTML shell while new static chunks are being installed (client-side exception after update).
function Stop-VerifiedNunesPort([int]$Port,[string]$HealthUrl,[string]$ExpectedProduct) {
  try {
    $h=Invoke-RestMethod -TimeoutSec 1 $HealthUrl
    if($h.ok -ne $true -or [string]$h.product -ne $ExpectedProduct){ return }
    $line=netstat -ano -p tcp | Select-String (':'+$Port+'\s+.*LISTENING') | Select-Object -First 1
    if($line){
      $parts=($line.ToString().Trim() -split '\s+')
      $pidToStop=[int]$parts[-1]
      if($pidToStop -gt 0){ Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 160 }
    }
  } catch {}
}
Stop-VerifiedNunesPort 8795 'http://127.0.0.1:8795/api/health' 'NUNES Company Platform'
Stop-VerifiedNunesPort 8865 'http://127.0.0.1:8865/api/health' 'NUNES Company Data API'

# CRITICAL: prepare the dashboard/data runtime before any optional module.
$prepareCompanyResident = Join-Path $Root 'tools\prepare-company-resident.ps1'
if (-not (Test-Path -LiteralPath $prepareCompanyResident -PathType Leaf)) { throw "Company fast resident installer is missing: $prepareCompanyResident" }
Write-Host 'Preparing NUNES main dashboard runtime first...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $prepareCompanyResident -Root $Root
if ($LASTEXITCODE -ne 0) { throw 'NUNES main dashboard runtime could not be prepared.' }
$companyResidentStart = Join-Path $env:LOCALAPPDATA 'NUNES Operations\CompanyResident\start-company-resident.ps1'
if (-not (Test-Path -LiteralPath $companyResidentStart -PathType Leaf)) { throw "Company resident launcher is missing after preparation: $companyResidentStart" }
Write-Host '[OK] Main dashboard runtime is prepared.' -ForegroundColor Green

# OPTIONAL: prepare Servicing. Keep the dashboard install alive if this module needs repair.
$servicingPrepared = $false
$residentStart = Join-Path $env:LOCALAPPDATA 'NUNES Operations\ServicingResident\start-servicing-resident.ps1'
try {
  $prepareResident = Join-Path $Root 'tools\prepare-servicing-resident.ps1'
  if (-not (Test-Path -LiteralPath $prepareResident -PathType Leaf)) { throw "Servicing resident installer is missing: $prepareResident" }
  Write-Host 'Preparing Servicing fast resident runtime...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $prepareResident -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'Servicing fast resident runtime could not be prepared.' }
  if (-not (Test-Path -LiteralPath $residentStart -PathType Leaf)) { throw "Servicing resident launcher is missing after preparation: $residentStart" }
  $servicingPrepared = $true
  Write-Host '[OK] Servicing resident is prepared.' -ForegroundColor Green
} catch {
  Write-Host ('[WARNING] Servicing setup did not finish: ' + $_.Exception.Message) -ForegroundColor Yellow
  Write-Host '[WARNING] Main dashboard setup will continue. Run 5_REPAIR_SERVICING_WHATSAPP.bat later.' -ForegroundColor Yellow
}

# OPTIONAL: prepare WhatsApp. A WhatsApp setup problem must never block the dashboard.
$whatsAppPrepared = $false
$whatsAppResidentStart = Join-Path $env:LOCALAPPDATA 'NUNES Operations\WhatsAppResident\start-whatsapp-resident.ps1'
try {
  $prepareWhatsApp = Join-Path $Root 'tools\prepare-whatsapp-resident.ps1'
  if (-not (Test-Path -LiteralPath $prepareWhatsApp -PathType Leaf)) { throw "WhatsApp resident installer is missing: $prepareWhatsApp" }
  Write-Host 'Preparing WhatsApp fast resident runtime...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $prepareWhatsApp -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'WhatsApp fast resident runtime could not be prepared.' }
  if (-not (Test-Path -LiteralPath $whatsAppResidentStart -PathType Leaf)) { throw "WhatsApp resident launcher is missing after preparation: $whatsAppResidentStart" }
  $whatsAppPrepared = $true
  Write-Host '[OK] WhatsApp resident is prepared.' -ForegroundColor Green
} catch {
  Write-Host ('[WARNING] WhatsApp setup did not finish: ' + $_.Exception.Message) -ForegroundColor Yellow
  Write-Host '[WARNING] Main dashboard setup will continue. Run 5_REPAIR_SERVICING_WHATSAPP.bat later.' -ForegroundColor Yellow
}

$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$serviceSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 8 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Priority 0

# Use WScript as the scheduled-task executable. Running powershell.exe directly from
# Task Scheduler can still flash a black console briefly on some Windows builds even
# with -WindowStyle Hidden. The VBS wrapper launches it with window style 0.
$hiddenDir = Join-Path $env:LOCALAPPDATA 'NUNES Operations\HiddenLaunchers'
New-Item -ItemType Directory -Force -Path $hiddenDir | Out-Null
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscript)) { $wscript = 'wscript.exe' }
function New-HiddenPsAction([string]$Name,[string]$Script,[string]$ExtraArgs='',[string]$WorkingDirectory='') {
  $vbsPath = Join-Path $hiddenDir ($Name + '.vbs')
  $ps = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
  if (-not (Test-Path -LiteralPath $ps)) { $ps='powershell.exe' }
  $cmd = $ps + ' -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Script + '"'
  if (-not [string]::IsNullOrWhiteSpace($ExtraArgs)) { $cmd += ' ' + $ExtraArgs }
  $vbs = @"
Option Explicit
Dim sh, cmd
Set sh = CreateObject("WScript.Shell")
cmd = "$($cmd.Replace('"','""'))"
sh.Run cmd, 0, False
"@
  Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII
  $wd = $WorkingDirectory
  if ([string]::IsNullOrWhiteSpace($wd)) { $wd = Split-Path -Parent $Script }
  return New-ScheduledTaskAction -Execute $wscript -Argument ('"{0}"' -f $vbsPath) -WorkingDirectory $wd
}

$action = New-HiddenPsAction 'company-server' $companyResidentStart '' (Split-Path -Parent $companyResidentStart)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
Register-ScheduledTask -TaskName 'NUNES Company Server' -Action $action -Trigger $trigger -Settings $serviceSettings -Principal $principal -Force | Out-Null

foreach ($oldOptionalTask in @('NUNES Servicing Warm','NUNES Servicing Keepalive')) {
  try { Unregister-ScheduledTask -TaskName $oldOptionalTask -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
if ($servicingPrepared) {
  $serviceAction = New-HiddenPsAction 'servicing-resident' $residentStart '-Port 5055' (Split-Path -Parent $residentStart)
  $serviceTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
  Register-ScheduledTask -TaskName 'NUNES Servicing Warm' -Action $serviceAction -Trigger $serviceTrigger -Settings $serviceSettings -Principal $principal -Force | Out-Null
  $keepTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName 'NUNES Servicing Keepalive' -Action $serviceAction -Trigger $keepTrigger -Settings $serviceSettings -Principal $principal -Force | Out-Null
}

$companyKeepTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'NUNES Company Keepalive' -Action $action -Trigger $companyKeepTrigger -Settings $serviceSettings -Principal $principal -Force | Out-Null

# WhatsApp is started at Windows logon and kept resident when its runtime is ready.
foreach ($oldOptionalTask in @('NUNES WhatsApp Resident','NUNES WhatsApp Keepalive')) {
  try { Unregister-ScheduledTask -TaskName $oldOptionalTask -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
if ($whatsAppPrepared) {
  $waAction = New-HiddenPsAction 'whatsapp-resident' $whatsAppResidentStart '-Port 5056' (Split-Path -Parent $whatsAppResidentStart)
  $waTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
  Register-ScheduledTask -TaskName 'NUNES WhatsApp Resident' -Action $waAction -Trigger $waTrigger -Settings $serviceSettings -Principal $principal -Force | Out-Null
  $waKeepTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName 'NUNES WhatsApp Keepalive' -Action $waAction -Trigger $waKeepTrigger -Settings $serviceSettings -Principal $principal -Force | Out-Null
}

$watchHidden=Join-Path $Root 'tools\run-watchdog-hidden.ps1'
$watchAction = New-HiddenPsAction 'company-watchdog' $watchHidden ('-Root "{0}"' -f $Root) $Root
$watchTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'NUNES Company Watchdog' -Action $watchAction -Trigger $watchTrigger -Settings $settings -Principal $principal -Force | Out-Null

# V6.5.3: GitHub is now the single code source. The MAIN SERVER checks
# Form_Filling_Crm/main every minute and applies only safe fast-forward updates.
# Use the installation/source root here (not the local runtime mirror) because
# the Git repository lives in the master VS Code folder.
$githubAutoInstaller = Join-Path $InstallSourceRoot 'tools\install-github-auto-update.ps1'
if ((Test-Path -LiteralPath $githubAutoInstaller -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $InstallSourceRoot '.git') -PathType Container)) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $githubAutoInstaller -Root $InstallSourceRoot -Quiet
  if ($LASTEXITCODE -ne 0) { Write-Host 'GitHub auto-update task could not be refreshed. Main server setup will continue.' -ForegroundColor Yellow }
}

# Desktop-style launcher: create a verified silent shortcut through WScript.
# The normal launcher logic is unchanged; only the console window is suppressed.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\create-desktop-shortcut.ps1') -Root $Root
if ($LASTEXITCODE -ne 0) { throw 'NUNES Operations desktop shortcut could not be created.' }

Remove-Item (Join-Path $env:LOCALAPPDATA 'NUNES Operations\client-server-url.txt') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Root 'OPEN_ON_OTHER_DEVICES.txt') -Force -ErrorAction SilentlyContinue
# CRITICAL service starts first and is never held behind optional modules.
Start-ScheduledTask -TaskName 'NUNES Company Server'
Start-Sleep -Milliseconds 120
if ($servicingPrepared) { try { Start-ScheduledTask -TaskName 'NUNES Servicing Warm' -ErrorAction Stop } catch {} }
if ($whatsAppPrepared) { try { Start-ScheduledTask -TaskName 'NUNES WhatsApp Resident' -ErrorAction Stop } catch {} }

$dashboardReady=$false
$dashboardDeadline=(Get-Date).AddSeconds(20)
while((Get-Date) -lt $dashboardDeadline){
  try{
    $h=Invoke-RestMethod -TimeoutSec 1 'http://127.0.0.1:8795/api/health'
    if($h.ok -eq $true -and [string]$h.product -eq 'NUNES Company Platform'){$dashboardReady=$true;break}
  }catch{}
  Start-Sleep -Milliseconds 150
}
if(-not $dashboardReady){ throw 'Main dashboard did not become ready on TCP 8795 after setup.' }

$serviceReady=$false
if($servicingPrepared){
  $serviceDeadline=(Get-Date).AddSeconds(12)
  while((Get-Date) -lt $serviceDeadline){
    try{
      $h=Invoke-RestMethod -TimeoutSec 1 'http://127.0.0.1:5055/api/health'
      if($h.app -eq 'ServiceFlowJobCards' -and $h.ok -eq $true){$serviceReady=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 120
  }
}
if($serviceReady){ Write-Host 'Servicing fast resident is READY NOW.' -ForegroundColor Green }
elseif($servicingPrepared){ Write-Host '[WARNING] Servicing runtime is prepared but is not healthy yet. Main dashboard remains available.' -ForegroundColor Yellow }

Write-Host ''
Write-Host 'NUNES always-on MAIN SERVER setup completed.' -ForegroundColor Green
Write-Host 'Main dashboard is READY on TCP 8795.' -ForegroundColor Green
if($servicingPrepared){ Write-Host 'Servicing resident: prepared.' } else { Write-Host 'Servicing resident: needs optional repair.' -ForegroundColor Yellow }
if($whatsAppPrepared){ Write-Host 'WhatsApp resident: prepared.' } else { Write-Host 'WhatsApp resident: needs optional repair.' -ForegroundColor Yellow }
Write-Host 'A NUNES Operations desktop shortcut was created.'
Write-Host 'Windows Firewall access is enabled for office LAN and Tailscale company devices.'
