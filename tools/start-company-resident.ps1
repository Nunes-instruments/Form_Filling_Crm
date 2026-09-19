$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir = Join-Path $stateRoot 'CompanyResident'
$configPath = Join-Path $residentDir 'company-resident.json'
$readyStamp = Join-Path $residentDir 'ready.stamp'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { exit 3 }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

$root = [string]$config.root
$nodeExe = [string]$config.nodeExe
$pythonExe = [string]$config.pythonExe
$dashboardServer = [string]$config.dashboardServer
$dataServer = [string]$config.dataServer
$dashboardPort = [int]$config.dashboardPort
$apiPort = [int]$config.apiPort
$updateId = 'baseline'
try {
  $updateIdFile = Join-Path $root 'UPDATE_ID.txt'
  if (Test-Path -LiteralPath $updateIdFile -PathType Leaf) {
    $candidate = (Get-Content -LiteralPath $updateIdFile -Raw -ErrorAction Stop).Trim()
    if (-not [string]::IsNullOrWhiteSpace($candidate)) { $updateId = $candidate }
  }
} catch {}

if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { exit 3 }
if ([string]::IsNullOrWhiteSpace($nodeExe) -or -not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { exit 3 }
if ([string]::IsNullOrWhiteSpace($pythonExe) -or -not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) { exit 3 }
if ([string]::IsNullOrWhiteSpace($dashboardServer) -or -not (Test-Path -LiteralPath $dashboardServer -PathType Leaf)) { exit 3 }
if ([string]::IsNullOrWhiteSpace($dataServer) -or -not (Test-Path -LiteralPath $dataServer -PathType Leaf)) { exit 3 }

function Test-JsonHealth([string]$Url,[string]$Kind,[int]$TimeoutMs=160) {
  try {
    $req=[System.Net.HttpWebRequest]::Create($Url)
    $req.Method='GET'; $req.Timeout=$TimeoutMs; $req.ReadWriteTimeout=$TimeoutMs; $req.Proxy=$null
    $resp=$req.GetResponse()
    try {
      $reader=New-Object IO.StreamReader($resp.GetResponseStream()); $raw=$reader.ReadToEnd(); $reader.Dispose()
      $j=$raw | ConvertFrom-Json
      if($Kind -eq 'platform'){ return ($j.ok -eq $true -and [string]$j.product -eq 'NUNES Company Platform') }
      if($Kind -eq 'api'){ return ($j.ok -eq $true -and [string]$j.product -eq 'NUNES Company Data API') }
    } finally { $resp.Close() }
  } catch {}
  return $false
}
function Port-InUse([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1',$Port,$null,$null)
    if(-not $iar.AsyncWaitHandle.WaitOne(120,$false)){ return $false }
    try { $client.EndConnect($iar) } catch { return $false }
    return $client.Connected
  } catch { return $false } finally { try{$client.Close()}catch{} }
}
function Wait-Health([string]$Url,[string]$Kind,[int]$Milliseconds) {
  $deadline=[DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  while([DateTime]::UtcNow -lt $deadline){
    if(Test-JsonHealth $Url $Kind 140){return $true}
    Start-Sleep -Milliseconds 70
  }
  return $false
}
function Mark-CompanyReady {
  try { Set-Content -LiteralPath (Join-Path $stateRoot 'server-status.txt') -Value 'READY - NUNES dashboard is running.' -Encoding UTF8 } catch {}
  try {
    $linkFile=Join-Path $root 'OPEN_ON_OTHER_DEVICES.txt'
    if(-not (Test-Path -LiteralPath $linkFile -PathType Leaf)){
      $lan=''
      try {
        $helper=Join-Path $root 'tools\get-lan-ip.ps1'
        if(Test-Path -LiteralPath $helper -PathType Leaf){ $lan=(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper | Select-Object -First 1) }
      } catch {}
      if([string]::IsNullOrWhiteSpace([string]$lan)){ $lan=$env:COMPUTERNAME }
      @(
        'NUNES COMPANY PLATFORM V6.5.0',
        '========================================',
        ('This PC: http://127.0.0.1:'+$dashboardPort),
        ('Other devices: http://'+$lan+':'+$dashboardPort),
        ('PC-name link: http://'+$env:COMPUTERNAME+':'+$dashboardPort),
        '',
        'All devices use the SAME Purchasing and Servicing data from this server PC.',
        'Keep this server PC signed in and ON. Run 1_SETUP_ALWAYS_ON_SERVER.bat once.'
      ) | Set-Content -LiteralPath $linkFile -Encoding UTF8
    }
  } catch {}
  try { Set-Content -LiteralPath $readyStamp -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ASCII } catch {}
}

function Warm-Dashboard {
  try {
    $req=[System.Net.HttpWebRequest]::Create("http://127.0.0.1:$dashboardPort/")
    $req.Method='GET'; $req.Timeout=1800; $req.ReadWriteTimeout=1800; $req.Proxy=$null
    $resp=$req.GetResponse(); try{$null=$resp.StatusCode}finally{$resp.Close()}
  } catch {}
  try {
    $req=[System.Net.HttpWebRequest]::Create("http://127.0.0.1:$dashboardPort/forms")
    $req.Method='GET'; $req.Timeout=1800; $req.ReadWriteTimeout=1800; $req.Proxy=$null
    $resp=$req.GetResponse(); try{$null=$resp.StatusCode}finally{$resp.Close()}
  } catch {}
}

# NUNES_V2_8_2_SERVICING_ALWAYS_HOT
function Start-ServicingResidentFast {
  try {
    $launcher = Join-Path $stateRoot 'ServicingResident\start-servicing-resident.ps1'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { return }
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $ps -PathType Leaf)) { $ps = 'powershell.exe' }
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $ps
    $psi.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Port 5055'
    $psi.WorkingDirectory = Split-Path -Parent $launcher
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    [void][Diagnostics.Process]::Start($psi)
  } catch {}
}

# Start Servicing BEFORE the dashboard fast-ready shortcut can exit.
# This is non-blocking: Dashboard startup speed is not delayed.
Start-ServicingResidentFast

# NUNES_V2_8_3_ALWAYS_HOT_SILENT
function Start-ServicingResidentFast {
  try {
    $launcher = Join-Path $stateRoot 'ServicingResident\start-servicing-resident.ps1'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { return }
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $ps -PathType Leaf)) { $ps = 'powershell.exe' }
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $ps
    $psi.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Port 5055'
    $psi.WorkingDirectory = Split-Path -Parent $launcher
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    [void][Diagnostics.Process]::Start($psi)
  } catch {}
}

# Fire Servicing before the company fast-ready shortcut. Non-blocking and windowless.
Start-ServicingResidentFast

$platformUrl="http://127.0.0.1:$dashboardPort/api/health"
$apiUrl="http://127.0.0.1:$apiPort/api/health"
if((Test-JsonHealth $platformUrl 'platform' 110) -and (Test-JsonHealth $apiUrl 'api' 110)){
  Warm-Dashboard
  Mark-CompanyReady
  exit 0
}

$mutex=New-Object System.Threading.Mutex($false,'Local\NUNES_Company_Resident_V8')
$hasMutex=$false
try {
  try{$hasMutex=$mutex.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$hasMutex=$true}
  if(-not $hasMutex){exit 0}

  # API first. If its fixed fast port belongs to another app, return a special code so
  # the old flexible-port launcher can be used as a compatibility fallback.
  if(-not (Test-JsonHealth $apiUrl 'api' 110)){
    if(Port-InUse $apiPort){exit 10}
    $psi=New-Object Diagnostics.ProcessStartInfo
    $psi.FileName=$pythonExe; $psi.Arguments='"'+$dataServer+'"'; $psi.WorkingDirectory=$root
    $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true; $psi.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $psi.EnvironmentVariables['NUNES_API_PORT']=[string]$apiPort
    $psi.EnvironmentVariables['NUNES_PORT']=[string]$apiPort
    $psi.EnvironmentVariables['NUNES_HOST']='0.0.0.0'
    $psi.EnvironmentVariables['NUNES_SERVICE_DATA_FILE']=Join-Path $stateRoot 'ServiceData\jobs.json' # NUNES_FINAL_V2_6
    $p=[Diagnostics.Process]::Start($psi); if($null -eq $p){exit 4}
    try{$p.PriorityClass=[Diagnostics.ProcessPriorityClass]::AboveNormal}catch{}
    if(-not (Wait-Health $apiUrl 'api' 3500)){exit 5}
  }

  if(-not (Test-JsonHealth $platformUrl 'platform' 110)){
    if(Port-InUse $dashboardPort){exit 11}
    $standaloneDir=Split-Path -Parent $dashboardServer
    $psi=New-Object Diagnostics.ProcessStartInfo
    $psi.FileName=$nodeExe; $psi.Arguments='"'+$dashboardServer+'"'; $psi.WorkingDirectory=$standaloneDir
    $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true; $psi.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $psi.EnvironmentVariables['PORT']=[string]$dashboardPort
    $psi.EnvironmentVariables['HOSTNAME']='0.0.0.0'
    $psi.EnvironmentVariables['NUNES_PORT']=[string]$dashboardPort
    $psi.EnvironmentVariables['NUNES_HOST']='0.0.0.0'
    $psi.EnvironmentVariables['NUNES_API_PORT']=[string]$apiPort
    $psi.EnvironmentVariables['NUNES_API_INTERNAL_URL']="http://127.0.0.1:$apiPort"
    $psi.EnvironmentVariables['NUNES_UPDATE_ID']=$updateId
    $psi.EnvironmentVariables['NODE_ENV']='production'
    $psi.EnvironmentVariables['NEXT_TELEMETRY_DISABLED']='1'
    $p=[Diagnostics.Process]::Start($psi); if($null -eq $p){exit 6}
    try{$p.PriorityClass=[Diagnostics.ProcessPriorityClass]::AboveNormal}catch{}
    if(-not (Wait-Health $platformUrl 'platform' 4500)){exit 7}
  }

  Warm-Dashboard
  Mark-CompanyReady
  exit 0
} finally {
  if($hasMutex){try{$mutex.ReleaseMutex()}catch{}}
  try{$mutex.Dispose()}catch{}
}
