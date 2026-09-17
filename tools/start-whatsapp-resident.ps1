param([int]$Port = 5056)
$ErrorActionPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
$stateRoot=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir=Join-Path $stateRoot 'WhatsAppResident'
$configPath=Join-Path $residentDir 'whatsapp-resident.json'
if(-not (Test-Path -LiteralPath $configPath -PathType Leaf)){exit 3}
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$nodeExe=[string]$config.nodeExe
$sidecar=[string]$config.sidecar
$nodeModules=[string]$config.nodeModules
$workDir=[string]$config.workDir
$browserPath=[string]$config.browserPath
$expectedSidecarVersion=[string]$config.sidecarVersion
if(-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)){exit 3}
if(-not (Test-Path -LiteralPath $sidecar -PathType Leaf)){exit 3}
if(-not (Test-Path -LiteralPath $nodeModules -PathType Container)){exit 3}
if(-not (Test-Path -LiteralPath $browserPath -PathType Leaf)){exit 3}

function Get-Health([int]$TimeoutMs=180){
  try{
    $req=[Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/health")
    $req.Method='GET';$req.Timeout=$TimeoutMs;$req.ReadWriteTimeout=$TimeoutMs;$req.Proxy=$null
    $resp=$req.GetResponse()
    try{
      $reader=New-Object IO.StreamReader($resp.GetResponseStream());$raw=$reader.ReadToEnd();$reader.Dispose()
      $j=$raw|ConvertFrom-Json
      return ($j.ok -eq $true -and [string]$j.engine -eq 'WhatsAppWebLink' -and ([string]::IsNullOrWhiteSpace($expectedSidecarVersion) -or [string]$j.version -eq $expectedSidecarVersion))
    }finally{$resp.Close()}
  }catch{return $false}
}
if(Get-Health 120){exit 0}

$mutex=New-Object Threading.Mutex($false,'Local\NUNES_WhatsApp_Resident_V21')
$has=$false
try{
  try{$has=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$has=$true}
  if(-not $has){exit 0}
  if(Get-Health 120){exit 0}

  try{
    $line=netstat -ano -p tcp | Select-String (':'+$Port+'\s+.*LISTENING') | Select-Object -First 1
    if($line){
      $parts=($line.ToString().Trim() -split '\s+')
      $pidToStop=[int]$parts[-1]
      if($pidToStop -gt 0){
        $cmd=(Get-CimInstance Win32_Process -Filter "ProcessId=$pidToStop" -ErrorAction SilentlyContinue).CommandLine
        if([string]$cmd -match 'whatsapp-sidecar\.js'){ Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 120 }
        else{exit 10}
      }
    }
  }catch{}

  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=$nodeExe
  $psi.Arguments='"'+$sidecar+'"'
  $psi.WorkingDirectory=$workDir
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
  $psi.EnvironmentVariables['WHATSAPP_SIDECAR_PORT']=[string]$Port
  $psi.EnvironmentVariables['WHATSAPP_BROWSER_PATH']=$browserPath
  $psi.EnvironmentVariables['NODE_PATH']=$nodeModules
  $psi.EnvironmentVariables['PUPPETEER_SKIP_DOWNLOAD']='true'
  $psi.RedirectStandardOutput=$false
  $psi.RedirectStandardError=$false
  $p=[Diagnostics.Process]::Start($psi)
  if($null -eq $p){exit 4}
  try{$p.PriorityClass=[Diagnostics.ProcessPriorityClass]::Normal}catch{}

  $deadline=[DateTime]::UtcNow.AddSeconds(7)
  while([DateTime]::UtcNow -lt $deadline){
    if(Get-Health 180){exit 0}
    if($p.HasExited){exit 5}
    Start-Sleep -Milliseconds 80
  }
  exit 6
}finally{
  if($has){try{$mutex.ReleaseMutex()}catch{}}
  try{$mutex.Dispose()}catch{}
}
