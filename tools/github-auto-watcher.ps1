param(
  [Parameter(Mandatory=$true)][string]$Root
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:GIT_TERMINAL_PROMPT = '0'

$received = [Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if ([string]::IsNullOrWhiteSpace($received)) { exit 2 }
try { $Root = (Resolve-Path -LiteralPath $received -ErrorAction Stop).ProviderPath } catch { exit 2 }

$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$logPath = Join-Path $stateRoot 'github-auto-update.log'
$statusPath = Join-Path $stateRoot 'github-auto-update-status.json'
$expectedRemote = 'https://github.com/Nunes-instruments/Form_Filling_Crm.git'

function Write-NunesLog([string]$Message,[string]$Level='INFO') {
  try {
    if (Test-Path -LiteralPath $logPath -PathType Leaf) {
      $item = Get-Item -LiteralPath $logPath -ErrorAction SilentlyContinue
      if ($item -and $item.Length -gt 2097152) {
        Copy-Item -LiteralPath $logPath -Destination ($logPath + '.old') -Force -ErrorAction SilentlyContinue
        Clear-Content -LiteralPath $logPath -ErrorAction SilentlyContinue
      }
    }
    Add-Content -LiteralPath $logPath -Value ('{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Level,$Message) -Encoding UTF8
  } catch {}
}

function Write-Status([string]$State,[string]$Message,[string]$LocalCommit='',[string]$RemoteCommit='') {
  try {
    $obj = [ordered]@{
      time = (Get-Date).ToString('s')
      state = $State
      message = $Message
      repository = 'Nunes-instruments/Form_Filling_Crm'
      branch = 'main'
      local_commit = $LocalCommit
      remote_commit = $RemoteCommit
    }
    $obj | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusPath -Encoding UTF8
  } catch {}
}

$mutex = New-Object System.Threading.Mutex($false,'Local\NUNES_GITHUB_AUTO_UPDATE_V1')
$haveMutex = $false
try {
  try { $haveMutex = $mutex.WaitOne(0) } catch { $haveMutex = $false }
  if (-not $haveMutex) { exit 0 }

  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if (-not $git) {
    Write-NunesLog 'Git for Windows is not available. Auto update skipped.' 'WARN'
    Write-Status 'waiting' 'Git for Windows is not installed or is not in PATH.'
    exit 0
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Root '.git') -PathType Container)) {
    Write-NunesLog ('Master folder is not a Git repository: ' + $Root) 'WARN'
    Write-Status 'waiting' 'The NUNES master folder is not a Git repository.'
    exit 0
  }

  # Probe remotes first. On Windows PowerShell 5, a missing origin can otherwise
  # surface as NativeCommandError because Git writes the normal failure to STDERR.
  $oldPref=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    $remoteNames=@(& git -C $Root remote 2>&1 | ForEach-Object { [string]$_ })
    $remoteRc=$LASTEXITCODE
  } finally { $ErrorActionPreference=$oldPref }
  if($remoteRc -ne 0){
    Write-NunesLog 'Could not inspect Git remotes. Auto update skipped.' 'WARN'
    Write-Status 'waiting' 'Could not inspect Git remotes.'
    exit 0
  }
  $origin=''
  if(@($remoteNames | ForEach-Object {$_.Trim()}) -contains 'origin'){
    try {
      $ErrorActionPreference='Continue'
      $originLines=@(& git -C $Root remote get-url origin 2>&1 | ForEach-Object { [string]$_ })
      $originRc=$LASTEXITCODE
    } finally { $ErrorActionPreference=$oldPref }
    if($originRc -eq 0){$origin=([string]($originLines | Select-Object -First 1)).Trim()}
  }
  if ([string]::IsNullOrWhiteSpace($origin)) {
    Write-NunesLog 'Git origin is missing. Auto update skipped.' 'WARN'
    Write-Status 'waiting' 'GitHub origin is missing.'
    exit 0
  }
  $normalizedOrigin = $origin.TrimEnd('/').ToLowerInvariant()
  $normalizedExpected = $expectedRemote.TrimEnd('/').ToLowerInvariant()
  if ($normalizedOrigin -ne $normalizedExpected) {
    Write-NunesLog ('Blocked unexpected Git origin: ' + $origin) 'WARN'
    Write-Status 'blocked' ('Unexpected Git origin: ' + $origin)
    exit 0
  }

  $branch = (& git -C $Root rev-parse --abbrev-ref HEAD 2>$null | Select-Object -First 1)
  $branch = ([string]$branch).Trim()
  if ($branch -ne 'main') {
    Write-NunesLog ('Auto update waits because current branch is ' + $branch) 'WARN'
    Write-Status 'waiting' ('Current branch is ' + $branch + '; expected main.')
    exit 0
  }

  # Never overwrite local VS Code work. Ignored runtime/data files do not appear here.
  $dirty = @(& git -C $Root status --porcelain --untracked-files=normal 2>$null)
  if ($LASTEXITCODE -ne 0) {
    Write-NunesLog 'Could not inspect Git working tree.' 'WARN'
    Write-Status 'waiting' 'Could not inspect the Git working tree.'
    exit 0
  }
  if ($dirty.Count -gt 0) {
    Write-NunesLog 'Local code changes exist; GitHub auto pull skipped until they are committed/pushed.'
    Write-Status 'local_changes' 'Local VS Code changes exist. Auto pull will not overwrite them.'
    exit 0
  }

  $fetchOutput = @(& git -C $Root fetch origin main --prune 2>&1)
  if ($LASTEXITCODE -ne 0) {
    Write-NunesLog ('GitHub fetch failed: ' + (($fetchOutput | Select-Object -Last 3) -join ' | ')) 'WARN'
    Write-Status 'offline' 'GitHub fetch failed. The live server was left unchanged.'
    exit 0
  }

  $local = ([string](& git -C $Root rev-parse HEAD 2>$null | Select-Object -First 1)).Trim()
  $remote = ([string](& git -C $Root rev-parse origin/main 2>$null | Select-Object -First 1)).Trim()
  if ([string]::IsNullOrWhiteSpace($local) -or [string]::IsNullOrWhiteSpace($remote)) {
    Write-NunesLog 'Could not resolve local/remote commit IDs.' 'WARN'
    Write-Status 'waiting' 'Could not resolve Git commit IDs.' $local $remote
    exit 0
  }
  if ($local -eq $remote) {
    Write-Status 'up_to_date' 'Main server already has the latest GitHub version.' $local $remote
    exit 0
  }

  & git -C $Root merge-base --is-ancestor $local $remote *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-NunesLog ('Local and GitHub history diverged. Local=' + $local + ' Remote=' + $remote) 'WARN'
    Write-Status 'blocked' 'Local and GitHub history diverged. Manual review is required; nothing was overwritten.' $local $remote
    exit 0
  }

  # Safety gate: remote updates must never contain persistent data or credentials.
  $changed = @(& git -C $Root diff --name-only ($local + '..' + $remote) 2>$null)
  $blocked = @()
  foreach ($path in $changed) {
    $p = ([string]$path).Replace('\','/').Trim()
    $isSafeDataPlaceholder = ($p -ieq 'apps/order_forms/data/.keep' -or $p -ieq 'apps/service_operations/data/.gitkeep')
    if ($p -match '^(?i:LOCAL_ONLY_SECRETS)/' -or
        (($p -match '^(?i:apps/order_forms/data)/' -or $p -match '^(?i:apps/service_operations/data)/') -and -not $isSafeDataPlaceholder) -or
        $p -match '^(?i:backups)/' -or
        $p -match '(?i)(^|/)google_oauth_client\.json$' -or
        $p -match '(?i)(^|/)client_secret[^/]*\.json$' -or
        ($p -match '(?i)(^|/)\.env($|\.)' -and $p -notmatch '(?i)\.env\.example$') -or
        $p -match '(?i)\.(db|sqlite|sqlite3)$') {
      $blocked += $p
    }
  }
  if ($blocked.Count -gt 0) {
    Write-NunesLog ('SECURITY BLOCK: remote update contains protected path(s): ' + ($blocked -join ', ')) 'ERROR'
    Write-Status 'blocked' ('GitHub update contains protected data/secret path(s): ' + ($blocked -join ', ')) $local $remote
    exit 0
  }

  Write-NunesLog ('New GitHub version found. ' + $local.Substring(0,8) + ' -> ' + $remote.Substring(0,8))
  Write-Status 'updating' 'New GitHub version found. Applying it to the main server.' $local $remote

  $mergeOutput = @(& git -C $Root merge --ff-only origin/main 2>&1)
  if ($LASTEXITCODE -ne 0) {
    Write-NunesLog ('Fast-forward failed: ' + (($mergeOutput | Select-Object -Last 4) -join ' | ')) 'ERROR'
    Write-Status 'failed' 'Git fast-forward failed. The live server was not intentionally changed.' $local $remote
    exit 1
  }

  $apply = Join-Path $Root 'tools\apply-main-server-update.ps1'
  if (-not (Test-Path -LiteralPath $apply -PathType Leaf)) {
    & git -C $Root reset --hard $local *> $null
    Write-NunesLog 'Pulled version did not contain apply-main-server-update.ps1; source rolled back.' 'ERROR'
    Write-Status 'rolled_back' 'Update package was incomplete. Source was rolled back to the previous commit.' $local $remote
    exit 1
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $apply -Root $Root
  $applyRc = $LASTEXITCODE
  if ($applyRc -eq 0) {
    Set-Content -LiteralPath (Join-Path $stateRoot 'last-auto-github-commit.txt') -Value $remote -Encoding ASCII
    Write-NunesLog ('AUTO UPDATE COMPLETE. Live commit=' + $remote)
    Write-Status 'updated' 'GitHub version was applied successfully. Staff/owner pages will refresh automatically.' $remote $remote
    exit 0
  }

  # Roll source back and restore the previous known-good live runtime.
  Write-NunesLog ('New commit failed live verification. Rolling source back to ' + $local) 'ERROR'
  & git -C $Root reset --hard $local *> $null
  $rollbackApply = Join-Path $Root 'tools\apply-main-server-update.ps1'
  if (Test-Path -LiteralPath $rollbackApply -PathType Leaf) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $rollbackApply -Root $Root
    if ($LASTEXITCODE -eq 0) {
      Write-NunesLog 'Previous live version restored successfully after failed update.' 'WARN'
      Write-Status 'rolled_back' 'New GitHub version failed verification; previous working version was restored automatically.' $local $remote
      exit 1
    }
  }
  Write-NunesLog 'CRITICAL: automatic rollback could not be verified.' 'ERROR'
  Write-Status 'critical' 'New update failed and automatic rollback could not be verified. Check the main server.' $local $remote
  exit 2
}
catch {
  Write-NunesLog ('Watcher exception: ' + $_.Exception.Message) 'ERROR'
  Write-Status 'failed' ('Auto update error: ' + $_.Exception.Message)
  exit 1
}
finally {
  if ($haveMutex) { try { $mutex.ReleaseMutex() } catch {} }
  try { $mutex.Dispose() } catch {}
}
