param(
  [Parameter(Mandatory=$true)][string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
$Root = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath
$StartBat = Join-Path $Root 'START_NUNES_COMPANY.bat'
$LogFile = Join-Path $Root 'server-startup.log'
$StateDir = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$StatusFile = Join-Path $StateDir 'server-status.txt'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
if (-not (Test-Path -LiteralPath $StartBat)) { throw "Server start file is missing: $StartBat" }

# Local\ keeps the lock per signed-in Windows session, which matches the
# Interactive scheduled tasks used by NUNES Operations.
$mutex = [System.Threading.Mutex]::new($false, 'Local\NUNESOperationsServerStartupV650')
$acquired = $false
try {
  try { $acquired = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $acquired = $true }

  if (-not $acquired) {
    # Another legitimate startup is already running. Do not overwrite its status
    # or log and do not start a second build.
    exit 0
  }

  $header = @(
    '============================================================',
    ('NUNES SERVER START - ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
    ('Workspace: ' + $Root),
    'Single-start lock: ACQUIRED',
    '============================================================'
  )
  Set-Content -LiteralPath $LogFile -Value $header -Encoding UTF8

  # Merge stderr into stdout before Tee-Object so both streams are continuously
  # drained. Long-lived child servers are launched with >nul in the BAT and do
  # not inherit/lock this startup log.
  $cmdLine = 'call "' + $StartBat + '"'
  & $env:ComSpec /d /s /c $cmdLine 2>&1 | Tee-Object -FilePath $LogFile -Append | ForEach-Object { $_ }
  $rc = $LASTEXITCODE
  Add-Content -LiteralPath $LogFile -Value @('', ('NUNES SERVER EXIT CODE: ' + $rc)) -Encoding UTF8
  exit $rc
}
catch {
  try {
    Add-Content -LiteralPath $LogFile -Value ('STARTUP WRAPPER ERROR: ' + $_.Exception.Message) -Encoding UTF8
    Set-Content -LiteralPath $StatusFile -Value ('ERROR - Startup wrapper: ' + $_.Exception.Message) -Encoding UTF8
  } catch {}
  exit 1
}
finally {
  if ($acquired) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  try { $mutex.Dispose() } catch {}
}
