param(
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'
$Version = '6.5.0'
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
  foreach ($p in @(8785,8786,8787,8788,8789,8790,8791,8792,8793,8794,8795)) {
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

  # FAST OPEN V8: first use the fixed local resident dashboard port. In normal daily
  # use this makes the desktop icon open in a fraction of a second and avoids scanning
  # ten possible ports. If the resident is not running yet, start it directly from
  # LOCALAPPDATA and poll only the expected port for a few seconds.
  $fastUrl = 'http://127.0.0.1:8785'
  if (Get-Health $fastUrl 180) { Open-Dashboard $fastUrl; Start-Sleep -Milliseconds 120; exit 0 }
  try {
    $companyResident = Join-Path $StateDir 'CompanyResident\start-company-resident.ps1'
    if (Test-Path -LiteralPath $companyResident -PathType Leaf) {
      Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$companyResident) -WindowStyle Hidden | Out-Null
      $fastDeadline = [DateTime]::UtcNow.AddSeconds(6)
      while ([DateTime]::UtcNow -lt $fastDeadline) {
        if (Get-Health $fastUrl 150) { Open-Dashboard $fastUrl; Start-Sleep -Milliseconds 120; exit 0 }
        Start-Sleep -Milliseconds 90
      }
    }
  } catch { Write-Log ('Fast resident start unavailable: ' + $_.Exception.Message) }

  # Server PC: resolve the workspace root from the stable LocalAppData pointer.
  if ([string]::IsNullOrWhiteSpace($Root) -and (Test-Path -LiteralPath $RootFile)) {
    $Root = (Get-Content -LiteralPath $RootFile -Raw -ErrorAction Stop).Trim()
  }
  if ([string]::IsNullOrWhiteSpace($Root)) { Fail 'The NUNES workspace folder is not configured. Run 1_SETUP_ALWAYS_ON_SERVER.bat once from the extracted NUNES folder.' }
  $Root = [Environment]::ExpandEnvironmentVariables($Root).Trim().Trim([char]34).Trim([char]39)
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { Fail "The saved NUNES workspace folder no longer exists:`n$Root`n`nRun 1_SETUP_ALWAYS_ON_SERVER.bat from the current extracted folder to update it." $Root }

  $existing = Find-LocalServer
  if ($existing) { Open-Dashboard $existing; Start-Sleep -Milliseconds 350; exit 0 }

  Write-Host 'Server is not running. Starting NUNES now...' -ForegroundColor Yellow
  Write-Log ('Starting server from ' + $Root)
  Remove-Item -LiteralPath $StatusFile -Force -ErrorAction SilentlyContinue

  $taskStarted = $false
  try {
    $null = Get-ScheduledTask -TaskName 'NUNES Company Server' -ErrorAction Stop
    Start-ScheduledTask -TaskName 'NUNES Company Server' -ErrorAction Stop
    $taskStarted = $true
    Write-Host 'Always-on server task started.' -ForegroundColor Gray
    Write-Log 'Scheduled task started.'
  } catch { Write-Log ('Scheduled task start unavailable: ' + $_.Exception.Message) }

  if (-not $taskStarted) {
    Write-Host 'Starting server directly...' -ForegroundColor Gray
    Start-DirectServer $Root
  }

  # First preparation can involve a one-time npm build. Do not fail at 150 seconds
  # while valid work is still progressing; show the real stage instead.
  $deadline = (Get-Date).AddMinutes(8)
  $lastStatus=''
  $lastProgress=Get-Date
  $fallbackUsed=$false
  $startTime=Get-Date
  while ((Get-Date) -lt $deadline) {
    $url = Find-LocalServer
    if ($url) {
      Write-Host ''
      Write-Host 'Server is ready.' -ForegroundColor Green
      Open-Dashboard $url
      Start-Sleep -Milliseconds 500
      exit 0
    }

    $status=''
    try { if(Test-Path -LiteralPath $StatusFile){ $status=(Get-Content -LiteralPath $StatusFile -Raw -ErrorAction Stop).Trim() } } catch {}
    if($status -and $status -ne $lastStatus){
      Write-Host ''
      if($status.StartsWith('ERROR')){ Write-Host $status -ForegroundColor Red } else { Write-Host $status -ForegroundColor Cyan }
      Write-Log ('Server status: ' + $status)
      $lastStatus=$status; $lastProgress=Get-Date
      if($status.StartsWith('ERROR')){ Fail $status $Root }
    }

    # If the scheduled task exited almost immediately without a working server,
    # try the same launcher directly once. This also covers task/quote problems.
    if($taskStarted -and -not $fallbackUsed -and ((Get-Date)-$startTime).TotalSeconds -ge 12){
      try {
        $state=[string](Get-ScheduledTask -TaskName 'NUNES Company Server' -ErrorAction Stop).State
        if($state -ne 'Running'){
          Write-Host ''
          Write-Host 'Scheduled start ended before the dashboard was ready. Trying direct recovery...' -ForegroundColor Yellow
          Start-DirectServer $Root
          $fallbackUsed=$true
          $startTime=Get-Date
        }
      } catch {}
    }

    if(((Get-Date)-$lastProgress).TotalSeconds -ge 20){ Write-Host -NoNewline '.'; $lastProgress=Get-Date }
    Start-Sleep -Milliseconds 650
  }

  Fail "The server did not become ready after the recovery wait.`n`nThe latest startup lines are shown below. Your Purchasing and Servicing data has not been deleted." $Root
}
catch { Fail $_.Exception.Message $Root }
