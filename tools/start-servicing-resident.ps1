param(
  [int]$Port = 5055
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir = Join-Path $stateRoot 'ServicingResident'
$configPath = Join-Path $residentDir 'servicing-resident.json'
$readyStamp = Join-Path $residentDir 'ready.stamp'
$startLock = Join-Path $residentDir 'starting.lock'

function Test-ServiceReady([int]$TimeoutMs = 180, [string]$ExpectedSignature = '') {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/health")
    $req.Method = 'GET'
    $req.Timeout = $TimeoutMs
    $req.ReadWriteTimeout = $TimeoutMs
    $req.Proxy = $null
    $resp = $req.GetResponse()
    try {
      $reader = New-Object IO.StreamReader($resp.GetResponseStream())
      $raw = $reader.ReadToEnd()
      $payload = $raw | ConvertFrom-Json
      if (-not ($payload.app -eq 'ServiceFlowJobCards' -and $payload.ok -eq $true)) { return $false }
      if (-not [string]::IsNullOrWhiteSpace($ExpectedSignature)) {
        $actual = ''
        try { $actual = [string]$payload.source_signature } catch {}
        if (-not [string]::IsNullOrWhiteSpace($actual)) { return ($actual -eq $ExpectedSignature) }
      }
      return $true
    } finally { $resp.Close() }
  } catch { return $false }
}

function Warm-ServiceForm {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/jobs/new")
    $req.Method = 'GET'
    $req.Timeout = 2500
    $req.ReadWriteTimeout = 2500
    $req.Proxy = $null
    $resp = $req.GetResponse()
    try { $null = $resp.StatusCode } finally { $resp.Close() }
  } catch {}
}


function Test-GeminiConfigured([int]$TimeoutMs = 450) {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/forms/gemini-status?_=" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $req.Method = 'GET'
    $req.Timeout = $TimeoutMs
    $req.ReadWriteTimeout = $TimeoutMs
    $req.Proxy = $null
    $resp = $req.GetResponse()
    try {
      $reader = New-Object IO.StreamReader($resp.GetResponseStream())
      $raw = $reader.ReadToEnd()
      $payload = $raw | ConvertFrom-Json
      return ($payload.configured -eq $true)
    } finally { $resp.Close() }
  } catch { return $false }
}

function Stop-PortListener([int]$TargetPort) {
  $pidToStop = 0
  try {
    $c = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($c) { $pidToStop = [int]$c.OwningProcess }
  } catch {}
  if ($pidToStop -le 0) {
    try {
      $lines = & $env:SystemRoot\System32\netstat.exe -ano -p tcp 2>$null
      foreach ($line in $lines) {
        if ($line -match ('^\s*TCP\s+\S+:' + $TargetPort + '\s+\S+\s+LISTENING\s+(\d+)\s*$')) {
          $pidToStop = [int]$Matches[1]
          break
        }
      }
    } catch {}
  }
  if ($pidToStop -gt 0 -and $pidToStop -ne $PID) {
    try { Stop-Process -Id $pidToStop -Force -ErrorAction Stop }
    catch { try { & taskkill.exe /PID $pidToStop /T /F | Out-Null } catch {} }
    Start-Sleep -Milliseconds 350
  }
}

function Test-LocalGeminiSecretExists {
  try {
    $secret = Join-Path $stateRoot 'Secrets\gemini-api-key.dpapi'
    return (Test-Path -LiteralPath $secret -PathType Leaf) -and ((Get-Item -LiteralPath $secret).Length -gt 0)
  } catch { return $false }
}

if (-not (Test-Path -LiteralPath $configPath)) { exit 3 }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$expectedSignature = ''
try { $expectedSignature = [string]$config.sourceSignature } catch {}
if (Test-ServiceReady 120 $expectedSignature) {
  # V6.6.5 self-heal: if a permanent local Gemini secret exists but the already-running
  # process was started before that secret was installed, force one clean restart so the
  # child process receives GEMINI_API_KEY. This prevents an old hot resident from keeping
  # `configured:false` forever after the key is saved.
  if ((Test-LocalGeminiSecretExists) -and -not (Test-GeminiConfigured 500)) {
    Stop-PortListener $Port
  } else {
    Warm-ServiceForm
    Set-Content -LiteralPath $readyStamp -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ASCII -ErrorAction SilentlyContinue
    exit 0
  }
}

$runtimeApp = [string]$config.runtimeApp
$nodeExe = [string]$config.nodeExe
if ([string]::IsNullOrWhiteSpace($runtimeApp) -or -not (Test-Path -LiteralPath $runtimeApp -PathType Container)) { exit 3 }
if ([string]::IsNullOrWhiteSpace($nodeExe) -or -not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { exit 3 }
$nextCli = Join-Path $runtimeApp 'node_modules\next\dist\bin\next'
$buildId = Join-Path $runtimeApp '.next\BUILD_ID'
$serverEntry = ''
try { $serverEntry = [string]$config.serverEntry } catch {}
if ([string]::IsNullOrWhiteSpace($serverEntry)) { $serverEntry = Join-Path $runtimeApp '.next\standalone\server.js' }
$standaloneReady = Test-Path -LiteralPath $serverEntry -PathType Leaf
if (-not $standaloneReady -and (-not (Test-Path -LiteralPath $nextCli -PathType Leaf) -or -not (Test-Path -LiteralPath $buildId -PathType Leaf))) { exit 3 }

$mutex = New-Object System.Threading.Mutex($false, 'Local\NUNES_Servicing_Resident_V5')
$hasMutex = $false
try {
  try { $hasMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $hasMutex = $true }
  if (-not $hasMutex) { exit 0 }
  if (Test-ServiceReady 120 $expectedSignature) {
    if ((Test-LocalGeminiSecretExists) -and -not (Test-GeminiConfigured 500)) {
      Stop-PortListener $Port
    } else {
      Warm-ServiceForm
      exit 0
    }
  }

  New-Item -ItemType Directory -Force -Path $residentDir | Out-Null
  Set-Content -LiteralPath $startLock -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ASCII -ErrorAction SilentlyContinue

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $nodeExe
  if ($standaloneReady) {
    # SPEED-ONLY V6: direct standalone server avoids the slower `next start` CLI/module scan.
    $psi.Arguments = '"' + $serverEntry + '"'
  } else {
    $psi.Arguments = '"' + $nextCli + '" start -H 0.0.0.0 -p ' + $Port
  }
  # Keep process.cwd() at the real runtime app because existing Gmail/WhatsApp/data code
  # intentionally resolves assets and scripts from the application root.
  $psi.WorkingDirectory = $runtimeApp
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $psi.EnvironmentVariables['NEXT_TELEMETRY_DISABLED'] = '1'
  $psi.EnvironmentVariables['NODE_ENV'] = 'production'
  $psi.EnvironmentVariables['HOSTNAME'] = '0.0.0.0'
  $psi.EnvironmentVariables['PORT'] = [string]$Port

  # V6.6.3: permanent local Gemini fallback. The secret is encrypted with Windows
  # DPAPI in LOCALAPPDATA and injected only into the Servicing child process.
  # This keeps Gemini configured across source/runtime rebuilds without ever
  # committing the API key to GitHub.
  try {
    $geminiSecret = Join-Path $stateRoot 'Secrets\gemini-api-key.dpapi'
    if (Test-Path -LiteralPath $geminiSecret -PathType Leaf) {
      $cipher = (Get-Content -LiteralPath $geminiSecret -Raw).Trim()
      if (-not [string]::IsNullOrWhiteSpace($cipher)) {
        $secureGemini = ConvertTo-SecureString $cipher
        $ptrGemini = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureGemini)
        try {
          $plainGemini = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptrGemini)
          if (-not [string]::IsNullOrWhiteSpace($plainGemini)) { $psi.EnvironmentVariables['GEMINI_API_KEY'] = $plainGemini }
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptrGemini) }
      }
    }
  } catch {}
  if (-not [string]::IsNullOrWhiteSpace($expectedSignature)) { $psi.EnvironmentVariables['NUNES_SOURCE_SIGNATURE'] = $expectedSignature }
  $p = [System.Diagnostics.Process]::Start($psi)
  try { $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::AboveNormal } catch {}
  if ($null -eq $p) { exit 4 }

  # Hot cached Next.js normally becomes healthy in well under two seconds. Probe at
  # 80 ms intervals so the route is warmed immediately instead of waiting on 1-second timers.
  $deadline = [DateTime]::UtcNow.AddSeconds(8)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-ServiceReady 150 $expectedSignature) {
      Warm-ServiceForm
      Set-Content -LiteralPath $readyStamp -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ASCII -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $startLock -Force -ErrorAction SilentlyContinue
      exit 0
    }
    if ($p.HasExited) { break }
    Start-Sleep -Milliseconds 80
  }
  exit 5
} finally {
  Remove-Item -LiteralPath $startLock -Force -ErrorAction SilentlyContinue
  if ($hasMutex) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
