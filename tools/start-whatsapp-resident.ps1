param([int]$Port = 5056)
$ErrorActionPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'

$stateRoot=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir=Join-Path $stateRoot 'WhatsAppResident'
$configPath=Join-Path $residentDir 'whatsapp-resident.json'
$starterLog=Join-Path $residentDir 'resident-starter-v2898.log'

function Log([string]$Message){
  try{
    Add-Content -LiteralPath $starterLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Message) -Encoding UTF8
  }catch{}
}

function Test-Health([int]$TimeoutMs=350){
  try{
    $req=[Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/health")
    $req.Method='GET'
    $req.Timeout=$TimeoutMs
    $req.ReadWriteTimeout=$TimeoutMs
    $req.Proxy=$null
    $resp=$req.GetResponse()
    try{
      $reader=New-Object IO.StreamReader($resp.GetResponseStream())
      $raw=$reader.ReadToEnd()
      $reader.Dispose()
      $payload=$raw|ConvertFrom-Json
      return ($payload.ok -eq $true -and [string]$payload.engine -eq 'WhatsAppWebLink')
    }finally{
      $resp.Close()
    }
  }catch{
    return $false
  }
}

if(-not (Test-Path -LiteralPath $configPath -PathType Leaf)){
  Log ('Missing config: '+$configPath)
  exit 3
}

try{
  $cfg=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json
}catch{
  Log ('Config parse failed: '+$_.Exception.Message)
  exit 3
}

$node=[string]$cfg.nodeExe
$sidecar=[string]$cfg.sidecar
$nodeModules=[string]$cfg.nodeModules
$workDir=[string]$cfg.workDir
$browser=[string]$cfg.browserPath

if(-not (Test-Path -LiteralPath $node -PathType Leaf)){Log ('Missing node: '+$node);exit 3}
if(-not (Test-Path -LiteralPath $sidecar -PathType Leaf)){Log ('Missing sidecar: '+$sidecar);exit 3}
if(-not (Test-Path -LiteralPath $nodeModules -PathType Container)){Log ('Missing node_modules: '+$nodeModules);exit 3}
if(-not (Test-Path -LiteralPath $workDir -PathType Container)){Log ('Missing workDir: '+$workDir);exit 3}
if(-not (Test-Path -LiteralPath $browser -PathType Leaf)){Log ('Missing browser: '+$browser);exit 3}

if(Test-Health 220){exit 0}

# Only stop an existing 5056 listener if it is our WhatsApp sidecar.
try{
  $c=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop|Select-Object -First 1
  if($c){
    $procId=[int]$c.OwningProcess
    $cmd=''
    try{$cmd=[string](Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop).CommandLine}catch{}
    if($cmd -match 'whatsapp-sidecar\.js'){
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 300
    }else{
      Log ("Port $Port occupied by unexpected PID $procId : $cmd")
      exit 10
    }
  }
}catch{}

$mutex=New-Object Threading.Mutex($false,'Local\NUNES_WhatsApp_Resident_V2898')
$has=$false
try{
  try{$has=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$has=$true}

  if(-not $has){
    for($i=0;$i-lt 35;$i++){
      if(Test-Health 250){exit 0}
      Start-Sleep -Milliseconds 200
    }
    Log 'Another starter held the mutex but 5056 did not become healthy.'
    exit 7
  }

  if(Test-Health 220){exit 0}

  # Reliable launch: FileName is the exact node.exe path; Arguments is the exact JS path.
  # V2.8.9.8 also deploys the JS file into a NO-SPACE runtime path.
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=$node
  $psi.Arguments='"'+$sidecar+'"'
  $psi.WorkingDirectory=$workDir
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
  $psi.EnvironmentVariables['WHATSAPP_SIDECAR_PORT']=[string]$Port
  $psi.EnvironmentVariables['WHATSAPP_BROWSER_PATH']=$browser
  $psi.EnvironmentVariables['NODE_PATH']=$nodeModules
  $psi.EnvironmentVariables['PUPPETEER_SKIP_DOWNLOAD']='true'
  $psi.EnvironmentVariables['PUPPETEER_SKIP_CHROMIUM_DOWNLOAD']='true'

  try{
    $p=[Diagnostics.Process]::Start($psi)
  }catch{
    Log ('Process start failed: '+$_.Exception.Message)
    exit 4
  }

  if($null-eq $p){
    Log 'Process start returned null.'
    exit 4
  }

  Log ("Started PID "+$p.Id+" sidecar="+$sidecar)

  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  while([DateTime]::UtcNow-lt$deadline){
    if(Test-Health 350){
      Log '5056 health PASS.'
      exit 0
    }
    if($p.HasExited){
      Log ("Process exited early. ExitCode="+$p.ExitCode)
      exit 5
    }
    Start-Sleep -Milliseconds 180
  }

  Log 'Process stayed alive but 5056 health timed out.'
  exit 6
}finally{
  if($has){
    try{$mutex.ReleaseMutex()}catch{}
  }
  try{$mutex.Dispose()}catch{}
}
