param(
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'
$Version = '6.6.0'
$StateDir = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$RootFile = Join-Path $StateDir 'workspace-root.txt'
$ClientFile = Join-Path $StateDir 'client-server-url.txt'
$LogFile = Join-Path $StateDir 'desktop-launcher.log'
$StatusFile = Join-Path $StateDir 'server-status.txt'

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

function Write-Log([string]$Text) {
  try { Add-Content -LiteralPath $LogFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $Text) -Encoding UTF8 } catch {}
}

function Get-StartupTail([string]$WorkspaceRoot, [int]$Lines = 14) {
  try {
    $p=Join-Path $WorkspaceRoot 'server-startup.log'
    if(Test-Path -LiteralPath $p){ return ((Get-Content -LiteralPath $p -Tail $Lines -ErrorAction Stop) -join "`n") }
  } catch {}
  return ''
}

function Fail([string]$Text, [string]$WorkspaceRoot = '') {
  Write-Host ''
  Write-Host 'NUNES Operations could not open.' -ForegroundColor Red
  Write-Host $Text -ForegroundColor Yellow
  $tail=''
  if($WorkspaceRoot){ $tail=Get-StartupTail $WorkspaceRoot 12 }
  if($tail){
    Write-Host ''
    Write-Host 'Latest server startup details:' -ForegroundColor Cyan
    Write-Host $tail
  }
  Write-Host ''
  Write-Host "Launcher log: $LogFile"
  Write-Log ('ERROR: ' + $Text.Replace("`r",' ').Replace("`n",' '))
  try {
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    $popup=$Text
    if($tail){ $popup += "`n`nLatest startup details:`n" + $tail }
    if($popup.Length -gt 1800){ $popup=$popup.Substring(0,1800) }
    [System.Windows.MessageBox]::Show($popup, 'NUNES Operations', 'OK', 'Error') | Out-Null
  } catch {}
  Write-Host 'Press any key to close...'
  try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Start-Sleep -Seconds 8 }
  exit 1
}

function Get-Health([string]$BaseUrl, [int]$TimeoutMs = 700) {
  try {
    $uri = $BaseUrl.TrimEnd('/') + '/api/health'
    $req = [System.Net.HttpWebRequest]::Create($uri)
    $req.Method = 'GET'
    $req.Timeout = [Math]::Max(250, $TimeoutMs)
    $req.ReadWriteTimeout = [Math]::Max(250, $TimeoutMs)
    $resp = $req.GetResponse()
    try {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $text = $reader.ReadToEnd(); $reader.Dispose()
      $j = $text | ConvertFrom-Json
      if ($j.ok -eq $true -and [string]$j.product -eq 'NUNES Company Platform') { return $true }
    } finally { $resp.Close() }
  } catch {}
  return $false
}

function Find-LocalServer {
  foreach ($p in @(8795)) {
    $u = "http://127.0.0.1:$p"
    if (Get-Health $u 350) { return $u }
  }
  return $null
}

function Open-Dashboard([string]$Url) {
  # Cache-bust only the top-level dashboard document after an update. Static assets keep
  # their normal immutable caching, but staff never reuse a stale HTML shell/chunk map.
  $separator='?'
  if($Url.Contains('?')){ $separator='&' }
  $launchUrl = $Url + $separator + '_nunes=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  Write-Host "Opening dashboard: $launchUrl" -ForegroundColor Green
  Write-Log ('Opening ' + $launchUrl)
  $edgeCandidates = @()
  if (${env:ProgramFiles(x86)}) { $edgeCandidates += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe') }
  if ($env:ProgramFiles) { $edgeCandidates += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe') }
  $edgeCandidates = @($edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
  if ($edgeCandidates.Count -gt 0) { Start-Process -FilePath $edgeCandidates[0] -ArgumentList @("--app=$launchUrl", '--start-maximized'); return }
  $chromeCandidates = @()
  if ($env:ProgramFiles) { $chromeCandidates += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe') }
  if (${env:ProgramFiles(x86)}) { $chromeCandidates += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe') }
  $chromeCandidates = @($chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
  if ($chromeCandidates.Count -gt 0) { Start-Process -FilePath $chromeCandidates[0] -ArgumentList @("--app=$launchUrl", '--start-maximized'); return }
  Start-Process $launchUrl
}

function Start-DirectServer([string]$WorkspaceRoot) {
  $startBat = Join-Path $WorkspaceRoot 'START_SERVER_AUTOMATIC.bat'
  if (-not (Test-Path -LiteralPath $startBat)) { Fail "The server launcher is missing:`n$startBat" $WorkspaceRoot }
  $arg = '/d /s /c ""' + $startBat + '""'
  Start-Process -FilePath $env:ComSpec -ArgumentList $arg -WorkingDirectory $WorkspaceRoot -WindowStyle Hidden
  Write-Log 'Direct server fallback started.'
}

try {
  Write-Log 'Launcher started.'
  Write-Host 'NUNES Operations' -ForegroundColor Cyan
  Write-Host 'Checking server...' -ForegroundColor Gray

  # Office client PC: use the shared server configured by the connect script.
  if (Test-Path -LiteralPath $ClientFile) {
    $clientUrl = (Get-Content -LiteralPath $ClientFile -Raw -ErrorAction Stop).Trim().TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($clientUrl)) { Fail 'The saved shared-server address is empty. Run 3_CONNECT_THIS_PC_TO_SHARED_SERVER.bat again.' }
    Write-Host "Shared server: $clientUrl"
    # FAST OPEN V8: office LAN health should answer in milliseconds. Use a short first
    # probe so healthy staff PCs do not wait 2.5 seconds before the browser opens, then
    # one longer retry only when the network is actually slow.
    $clientReady = Get-Health $clientUrl 650
    if (-not $clientReady) { $clientReady = Get-Health $clientUrl 1400 }
    if (-not $clientReady) { Fail "The shared NUNES server is not reachable at:`n$clientUrl`n`nCheck that Tailscale is ON on this staff/owner PC and that the main server PC is ON. This client will not start a local server." }
    Open-Dashboard $clientUrl
    Start-Sleep -Milliseconds 350
    exit 0
  }

  # V16: owner-PC open also kicks the hidden WhatsApp resident immediately.
  # Normally the logon task already restores the saved WhatsApp Web session; this is only
  # a safety net if Task Scheduler was delayed after Windows sign-in.
  try {
    Start-ScheduledTask -TaskName 'NUNES WhatsApp Resident' -ErrorAction Stop
  } catch {
    try {
      $waResident = Join-Path $StateDir 'WhatsAppResident\start-whatsapp-resident.ps1'
      if (Test-Path -LiteralPath $waResident -PathType Leaf) {
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$waResident,'-Port','5056') -WindowStyle Hidden | Out-Null
      }
    } catch {}
  }

  # SPEED-ONLY V6: owner-PC desktop open also kicks the local Servicing resident
  # immediately. This is a second safety net if the Windows logon task was delayed.
  try {
    $residentStart = Join-Path $StateDir 'ServicingResident\start-servicing-resident.ps1'
    if (Test-Path -LiteralPath $residentStart) {
      Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$residentStart,'-Port','5055') -WindowStyle Hidden | Out-Null
    } else {
      Start-ScheduledTask -TaskName 'NUNES Servicing Warm' -ErrorAction SilentlyContinue
    }
  } catch {}

  # V6.5.10 FAST/RELIABLE OPEN: the dashboard should normally already be hot.
  # If Windows restarted/killed it, use the tiny resident recovery helper first.
  $fastUrl = 'http://127.0.0.1:8795'
  if (Get-Health $fastUrl 160) { Open-Dashboard $fastUrl; Start-Sleep -Milliseconds 80; exit 0 }

  # Server PC: resolve the CURRENT workspace root from the stable LocalAppData pointer.
  if ([string]::IsNullOrWhiteSpace($Root) -and (Test-Path -LiteralPath $RootFile)) {
    $Root = (Get-Content -LiteralPath $RootFile -Raw -ErrorAction Stop).Trim()
  }
  if ([string]::IsNullOrWhiteSpace($Root)) { Fail 'The NUNES workspace folder is not configured. Run 0_REPAIR_AND_START_MAIN_SERVER.bat once from the complete NUNES folder.' }
  $Root = [Environment]::ExpandEnvironmentVariables($Root).Trim().Trim([char]34).Trim([char]39)
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { Fail "The saved NUNES workspace folder no longer exists:`n$Root`n`nRun 0_REPAIR_AND_START_MAIN_SERVER.bat from the current complete NUNES folder." $Root }

  Write-Host 'Server was sleeping. Restoring the fast resident...' -ForegroundColor Yellow
  Write-Log ('Fast recovery requested from ' + $Root)
  $ensure = Join-Path $Root 'tools\ensure-main-server-ready.ps1'
  if (-not (Test-Path -LiteralPath $ensure -PathType Leaf)) { Fail "Fast recovery helper is missing:`n$ensure`n`nUse the V6.6.0 complete folder and run 0_REPAIR_AND_START_MAIN_SERVER.bat once." $Root }

  & powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $ensure -Root $Root -TimeoutSeconds 90 -Quiet
  if ($LASTEXITCODE -eq 0 -and (Get-Health $fastUrl 500)) {
    Write-Host 'Server is ready.' -ForegroundColor Green
    Open-Dashboard $fastUrl
    Start-Sleep -Milliseconds 100
    exit 0
  }

  Fail "The main server could not be restored automatically.`n`nRun 0_REPAIR_AND_START_MAIN_SERVER.bat as Administrator from the CURRENT full NUNES folder. V6.6.0 will rebind the resident/tasks to that exact folder and keeps your existing data/connections." $Root
}
catch { Fail $_.Exception.Message $Root }
