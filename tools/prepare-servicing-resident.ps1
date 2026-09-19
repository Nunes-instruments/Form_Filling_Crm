param(
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = (Resolve-Path -LiteralPath $Root).ProviderPath
$sourceApp = Join-Path $Root 'apps\service_operations'
if (-not (Test-Path -LiteralPath $sourceApp -PathType Container)) { throw "Servicing source folder is missing: $sourceApp" }

$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir = Join-Path $stateRoot 'ServicingResident'
$sharedData = Join-Path $stateRoot 'ServiceData'
$runtimeBase = Join-Path $stateRoot 'ServicingRuntimeV5'
New-Item -ItemType Directory -Force -Path $stateRoot,$residentDir,$sharedData,$runtimeBase | Out-Null

# V6.6.1 STALE-RUNTIME FIX:
# Calculate the Servicing runtime identity from the ACTUAL source files whenever an
# update is prepared. Older builds trusted SOURCE_SIGNATURE.txt alone; if source code
# changed but that marker was not regenerated, Windows reused the previous local
# Servicing runtime and the Desktop icon appeared to open an older version.
$signatureFile = Join-Path $sourceApp 'SOURCE_SIGNATURE.txt'
$hashHelper = Join-Path $sourceApp 'scripts\get-source-hash.ps1'
$sourceSigRaw = ''

if (Test-Path -LiteralPath $hashHelper -PathType Leaf) {
  try {
    $computedLines = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hashHelper -AppDir $sourceApp 2>$null)
    if ($LASTEXITCODE -eq 0 -and $computedLines.Count -gt 0) {
      $sourceSigRaw = [string]($computedLines | Select-Object -Last 1)
    }
  } catch {}
}

# Compatibility fallback for older packages that do not contain the hash helper.
if ([string]::IsNullOrWhiteSpace($sourceSigRaw)) {
  try { $sourceSigRaw = [string](Get-Content -LiteralPath $signatureFile -Raw -ErrorAction Stop) }
  catch { throw 'Servicing source signature is missing or unreadable.' }
}
if ([string]::IsNullOrWhiteSpace($sourceSigRaw)) { throw 'Servicing source signature is missing.' }

$sourceSigCandidate = (($sourceSigRaw -replace "`0", '').Trim() -split "`r?`n")[0].Trim()
if ($sourceSigCandidate -match '^[0-9A-Fa-f]{40,128}$') {
  $sourceSig = $sourceSigCandidate.ToLowerInvariant()
} else {
  Write-Host '[Servicing] Repairing a malformed source signature into a safe local runtime key.' -ForegroundColor Yellow
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $sigBytes = [System.Text.Encoding]::UTF8.GetBytes($sourceSigRaw)
    $sourceSig = ([System.BitConverter]::ToString($sha256.ComputeHash($sigBytes))).Replace('-', '').ToLowerInvariant()
  } finally { $sha256.Dispose() }
}

# Diagnostic only: a stale marker no longer decides which build is used.
try {
  if (Test-Path -LiteralPath $signatureFile -PathType Leaf) {
    $declared = (([string](Get-Content -LiteralPath $signatureFile -Raw)).Trim() -split "`r?`n")[0].Trim().ToLowerInvariant()
    if ($declared -and $declared -ne $sourceSig) {
      Write-Host '[Servicing] Source changed since the saved signature. Building the latest runtime automatically.' -ForegroundColor Yellow
    }
  }
} catch {}

function Test-SafeFile([string]$Path) {
  try { return (-not [string]::IsNullOrWhiteSpace($Path)) -and [System.IO.File]::Exists($Path) } catch { return $false }
}
function Test-SafeDirectory([string]$Path) {
  try { return (-not [string]::IsNullOrWhiteSpace($Path)) -and [System.IO.Directory]::Exists($Path) } catch { return $false }
}

# NUNES_V2_7_8_PERMANENT_SERVICE_DATA_GUARD
function Test-ServiceDataJunction([string]$AppPath,[string]$ExpectedSharedData) {
  try {
    if ([string]::IsNullOrWhiteSpace($AppPath)) { return $false }
    $dataPath = Join-Path $AppPath 'data'
    $item = Get-Item -LiteralPath $dataPath -Force -ErrorAction Stop
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $false }
    $target = $item.Target
    if ($target -is [Array]) { $target = $target[0] }
    if ([string]::IsNullOrWhiteSpace([string]$target)) { return $false }
    $actual = ([IO.Path]::GetFullPath([string]$target)).TrimEnd('\')
    $expected = ([IO.Path]::GetFullPath($ExpectedSharedData)).TrimEnd('\')
    return ($actual -ieq $expected)
  } catch { return $false }
}


# Use only an exact-source, complete resident already prepared on this owner PC.
$configFile = Join-Path $residentDir 'servicing-resident.json'
$previous = $null
try { $previous = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json } catch { }
if ($previous -and [string]$previous.sourceSignature -eq $sourceSig) {
  $existingApp = [string]$previous.runtimeApp
  $complete = $false
  try {
    $complete = (Test-SafeFile ([string]$previous.nodeExe)) -and
      (Test-SafeFile ([string]$previous.serverEntry)) -and
      (Test-SafeFile (Join-Path $existingApp '.next\BUILD_ID')) -and
      (Test-SafeFile (Join-Path $existingApp '.next\routes-manifest.json')) -and
      (Test-SafeFile (Join-Path $existingApp '.next\prerender-manifest.json')) -and
      (Test-SafeFile (Join-Path $existingApp 'data\jobs.json')) -and
      (Test-ServiceDataJunction $existingApp $sharedData) -and
      (Test-ServiceDataJunction $existingApp $sharedData)
  } catch { $complete = $false }
  if ($complete) {
    Write-Host '[Servicing] Exact application build already prepared; skipping install, copy and build.' -ForegroundColor Green
    Copy-Item -LiteralPath (Join-Path $Root 'tools\start-servicing-resident.ps1') -Destination (Join-Path $residentDir 'start-servicing-resident.ps1') -Force
    & powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File (Join-Path $residentDir 'start-servicing-resident.ps1') -Port 5055
    if ($LASTEXITCODE -ne 0) { throw 'Prepared Servicing resident could not start.' }
    exit 0
  }
}
Write-Host '[Servicing] Preparing a new local application build. Existing data stays in ServiceData.' -ForegroundColor Cyan

# The runtime key is guaranteed to contain only hexadecimal characters. Keep the existing
# 64-character key format so prepared runtimes remain deterministic and Windows-safe.
$runtimeKey = if ($sourceSig.Length -gt 64) { $sourceSig.Substring(0,64) } else { $sourceSig }
$runtimeRoot = [System.IO.Path]::Combine($runtimeBase, $runtimeKey)
$runtimeApp = [System.IO.Path]::Combine($runtimeRoot, 'apps', 'service_operations')
$runtimeTools = [System.IO.Path]::Combine($runtimeRoot, 'tools')
$mirrorMarker = [System.IO.Path]::Combine($runtimeRoot, '.mirror-v5.ready')
try { [void][System.IO.Path]::GetFullPath($mirrorMarker) } catch { throw 'Could not create a safe Servicing runtime path.' }

$needMirror = -not (Test-SafeFile $mirrorMarker) -or -not (Test-SafeFile (Join-Path $runtimeApp 'START_EMBEDDED_FAST.bat')) -or -not (Test-SafeDirectory (Join-Path $runtimeApp 'src'))
if ($needMirror) {
  New-Item -ItemType Directory -Force -Path $runtimeApp,$runtimeTools | Out-Null
  & robocopy.exe $sourceApp $runtimeApp /E /XD data node_modules .next logs /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Could not create the local Servicing runtime (robocopy code $LASTEXITCODE)." }
  Copy-Item -LiteralPath (Join-Path $Root 'tools\bootstrap-node.ps1') -Destination (Join-Path $runtimeTools 'bootstrap-node.ps1') -Force
  Set-Content -LiteralPath $mirrorMarker -Value $sourceSig -Encoding ASCII
} else {
  foreach ($name in @('.env.local','VERSION.txt','SOURCE_SIGNATURE.txt','DEPENDENCY_SIGNATURE.txt','START_SERVICE_JOB_APP.bat')) {
    $src = Join-Path $sourceApp $name
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $runtimeApp $name) -Force -ErrorAction SilentlyContinue }
  }
  Copy-Item -LiteralPath (Join-Path $Root 'tools\bootstrap-node.ps1') -Destination (Join-Path $runtimeTools 'bootstrap-node.ps1') -Force -ErrorAction SilentlyContinue
}

# Persist real Servicing data outside every ZIP/runtime. Never replace a newer jobs.json.
$sourceData = Join-Path $sourceApp 'data'
$sharedJobs = Join-Path $sharedData 'jobs.json'
if (-not (Test-Path -LiteralPath $sharedJobs) -and (Test-Path -LiteralPath $sourceData)) {
  & robocopy.exe $sourceData $sharedData /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 /XF startup.lock server.pid | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Could not initialize persistent Servicing data.' }
}

$localData = Join-Path $runtimeApp 'data'
$junctionOk = $false
try {
  $item = Get-Item -LiteralPath $localData -Force -ErrorAction Stop
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    $target = $item.Target; if ($target -is [Array]) { $target = $target[0] }
    if ($target) { $junctionOk = ([IO.Path]::GetFullPath([string]$target)).TrimEnd('\') -ieq ([IO.Path]::GetFullPath($sharedData)).TrimEnd('\') }
  }
} catch {}
if (-not $junctionOk) {
  if (Test-Path -LiteralPath $localData) { cmd.exe /d /c ('rmdir /S /Q "{0}"' -f $localData) | Out-Null }
  cmd.exe /d /c ('mklink /J "{0}" "{1}"' -f $localData,$sharedData) | Out-Null
  if (-not (Test-Path -LiteralPath $localData)) { throw 'Could not connect local Servicing runtime to persistent ServiceData.' }
}

# Prepare one reusable Node runtime and remember its exact executable so daily starts
# never search PATH, recurse directories, download Node, or invoke the main NUNES launcher.
$nodeExe = ''
if ($previous -and (Test-SafeFile ([string]$previous.nodeExe))) {
  try {
    $major = [int](& ([string]$previous.nodeExe) -p "Number(process.versions.node.split('.')[0])")
    if ($major -ge 20) { $nodeExe = [string]$previous.nodeExe }
  } catch { }
}
if (-not $nodeExe) {
  $nodeOut = Join-Path $env:TEMP ("nunes_service_node_{0}.txt" -f ([guid]::NewGuid().ToString('N')))
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $runtimeTools 'bootstrap-node.ps1') -OutputFile $nodeOut
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nodeOut)) { throw 'Could not prepare the Servicing Node runtime.' }
  $nodeDir = (Get-Content -LiteralPath $nodeOut -Raw).Trim(); Remove-Item $nodeOut -Force -ErrorAction SilentlyContinue
  $nodeExe = Join-Path $nodeDir 'node.exe'
}
Write-Host '[Servicing] Reusing Node runtime and shared package cache.' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw 'Servicing Node executable is unavailable.' }

# The one-time setup is allowed to install/build. This cost must happen HERE, not when staff
# click Open Servicing. Repeat logins use the direct resident launcher below.
$needRuntime = -not (Test-Path -LiteralPath (Join-Path $runtimeApp 'node_modules\next\package.json')) -or
  -not (Test-Path -LiteralPath (Join-Path $runtimeApp '.next\BUILD_ID')) -or
  -not (Test-Path -LiteralPath (Join-Path $runtimeApp '.next\routes-manifest.json')) -or
  -not (Test-Path -LiteralPath (Join-Path $runtimeApp '.next\prerender-manifest.json')) -or
  -not (Test-Path -LiteralPath (Join-Path $runtimeApp '.next\standalone\server.js'))
if ($needRuntime) {
  $oldEmbedded = $env:NUNES_EMBEDDED; $oldPort = $env:PORT; $oldPrep = $env:NUNES_PREPARE_ONLY; $oldPath = $env:PATH
  try {
    $env:NUNES_PREPARE_ONLY = '1'; $env:PATH = (Split-Path -Parent $nodeExe) + ';' + $env:PATH
    $env:NUNES_EMBEDDED = '1'; $env:PORT = '5055'; $env:NEXT_TELEMETRY_DISABLED = '1'
    $starter = Join-Path $runtimeApp 'START_SERVICE_JOB_APP.bat'
    $stdout = Join-Path $residentDir 'setup-build.log'
    $stderr = Join-Path $residentDir 'setup-build-errors.log'
    Write-Host ('[Servicing] Build progress below. Log: ' + $stdout) -ForegroundColor Cyan
    $p = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c',('""{0}""' -f $starter)) -WorkingDirectory $runtimeApp -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $printed = 0; $heartbeat = [DateTime]::UtcNow
    while (-not $p.HasExited) {
      try {
        $lines = @(Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue)
        if ($lines.Count -gt $printed) { $lines | Select-Object -Skip $printed | ForEach-Object { Write-Host $_ }; $printed = $lines.Count }
      } catch { }
      if (([DateTime]::UtcNow - $heartbeat).TotalSeconds -ge 15) {
        Write-Host '[Servicing] Build is still running. Do not close setup.' -ForegroundColor DarkCyan
        $heartbeat = [DateTime]::UtcNow
      }
      Start-Sleep -Milliseconds 500
      $p.Refresh()
    }
    $p.WaitForExit()
    $p.Refresh()
    try { Get-Content -LiteralPath $stdout | Select-Object -Skip $printed | ForEach-Object { Write-Host $_ } } catch { }

    # NUNES_V2_8_6_3_BUILD_EXIT_GUARD
    # Windows PowerShell can expose a blank ExitCode after a redirected child has
    # actually completed. Accept it only when the full production artifact set proves success.
    $rawBuildExit = $null
    try { $rawBuildExit = $p.ExitCode } catch { $rawBuildExit = $null }
    $buildArtifactsReady =
      (Test-SafeFile (Join-Path $runtimeApp 'node_modules\next\package.json')) -and
      (Test-SafeFile (Join-Path $runtimeApp '.next\BUILD_ID')) -and
      (Test-SafeFile (Join-Path $runtimeApp '.next\routes-manifest.json')) -and
      (Test-SafeFile (Join-Path $runtimeApp '.next\prerender-manifest.json')) -and
      (Test-SafeFile (Join-Path $runtimeApp '.next\standalone\server.js'))
    $exitKnown = ($null -ne $rawBuildExit) -and (-not [string]::IsNullOrWhiteSpace([string]$rawBuildExit))
    if (-not $exitKnown) {
      if ($buildArtifactsReady) {
        Write-Host '[Servicing] Build exit code unavailable, but all required production artifacts are complete. Reusing this prepared runtime.' -ForegroundColor Yellow
        $buildExit = 0
      } else {
        try { Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ -ForegroundColor Red } } catch { }
        throw 'One-time Servicing runtime preparation ended without an exit code and required build artifacts are missing.'
      }
    } else { $buildExit = [int]$rawBuildExit }
    if ($buildExit -ne 0) {
      try { Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ -ForegroundColor Red } } catch { }
      throw "One-time Servicing runtime preparation failed (exit $buildExit)."
    }
    if (-not $buildArtifactsReady) { throw 'Servicing build process returned success but required production artifacts are incomplete.' }  } finally {
    $env:NUNES_EMBEDDED = $oldEmbedded; $env:PORT = $oldPort; $env:NUNES_PREPARE_ONLY = $oldPrep; $env:PATH = $oldPath
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimeApp 'node_modules\next\package.json'))) { throw 'Servicing dependency runtime was not prepared.' }
if (-not (Test-Path -LiteralPath (Join-Path $runtimeApp '.next\BUILD_ID'))) { throw 'Servicing production build was not prepared.' }

# SPEED-ONLY V6: Next standalone server is materially faster to launch on older office PCs
# because it avoids the normal `next start` CLI and broad node_modules resolution path.
$standaloneDir = Join-Path $runtimeApp '.next\standalone'
$standaloneServer = Join-Path $standaloneDir 'server.js'
if (-not (Test-Path -LiteralPath $standaloneServer -PathType Leaf)) {
  throw 'Servicing standalone production server was not generated. Run the one-time setup again.'
}
$staticSource = Join-Path $runtimeApp '.next\static'
$staticTarget = Join-Path $standaloneDir '.next\static'
if (Test-Path -LiteralPath $staticSource) {
  New-Item -ItemType Directory -Force -Path $staticTarget | Out-Null
  & robocopy.exe $staticSource $staticTarget /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Could not prepare Servicing standalone static assets.' }
}
$publicSource = Join-Path $runtimeApp 'public'
$publicTarget = Join-Path $standaloneDir 'public'
if (Test-Path -LiteralPath $publicSource) {
  New-Item -ItemType Directory -Force -Path $publicTarget | Out-Null
  & robocopy.exe $publicSource $publicTarget /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Could not prepare Servicing standalone public assets.' }
}

# Standalone builds do not automatically copy private runtime configuration.
$privateConfig = Join-Path $runtimeApp 'config'
if (Test-Path -LiteralPath $privateConfig) {
  Copy-Item -LiteralPath $privateConfig -Destination $standaloneDir -Recurse -Force
}

# Install the tiny resident launcher locally. Scheduled tasks will point here, not to the
# network/shared project folder, so login-time network availability cannot delay Servicing.
Copy-Item -LiteralPath (Join-Path $Root 'tools\start-servicing-resident.ps1') -Destination (Join-Path $residentDir 'start-servicing-resident.ps1') -Force
$config = [ordered]@{ runtimeApp=$runtimeApp; nodeExe=$nodeExe; serverEntry=$standaloneServer; sourceSignature=$sourceSig; port=5055; preparedAt=[DateTime]::UtcNow.ToString('o') }
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $residentDir 'servicing-resident.json') -Encoding UTF8

# Ensure the V6 standalone resident engine is the process that remains hot after setup.
try {
  $h = Invoke-RestMethod -TimeoutSec 1 'http://127.0.0.1:5055/api/health'
  if ($h.app -eq 'ServiceFlowJobCards') {
    $line = netstat -ano -p tcp | Select-String ':5055\s+.*LISTENING' | Select-Object -First 1
    if ($line) {
      $parts = ($line.ToString().Trim() -split '\s+')
      $pidToStop = [int]$parts[-1]
      if ($pidToStop -gt 0) { taskkill /PID $pidToStop /T /F | Out-Null; Start-Sleep -Milliseconds 180 }
    }
  }
} catch {}
& powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File (Join-Path $residentDir 'start-servicing-resident.ps1') -Port 5055
if ($LASTEXITCODE -ne 0) { throw 'Servicing resident launcher could not start the prepared runtime.' }
exit 0

