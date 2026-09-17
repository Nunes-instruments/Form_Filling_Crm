param([Parameter(Mandatory=$true)][AllowEmptyString()][string]$OutputFile)
$ErrorActionPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
if ([string]::IsNullOrWhiteSpace($OutputFile)) {
  Write-Host '[ERROR] Python bootstrap output path was empty.' -ForegroundColor Red
  exit 2
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function ValidPython([string]$p){
  if(-not $p -or -not (Test-Path -LiteralPath $p)){ return $false }
  try {
    & $p -c "import sys; raise SystemExit(0 if (sys.version_info.major == 3 and sys.version_info.minor >= 10) else 1)" *> $null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function NormalizePython([string]$p){
  if([string]::IsNullOrWhiteSpace($p)){ return $null }
  $v=$p.Trim().Trim([char]34).Trim([char]39)
  if(ValidPython $v){ try { return (Resolve-Path -LiteralPath $v).Path } catch { return $v } }
  return $null
}

function FindPython {
  $p=NormalizePython $env:NUNES_PYTHON
  if($p){ return $p }

  # The user's current NUNES PCs may already have Python 3.14. The old V6.5.0
  # bootstrap rejected it and tried to install another Python, which could stall startup.
  $known=@(
    "$env:LOCALAPPDATA\Programs\Python\Python315\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
    "$env:SystemDrive\Python315\python.exe",
    "$env:SystemDrive\Python314\python.exe",
    "$env:SystemDrive\Python313\python.exe",
    "$env:SystemDrive\Python312\python.exe",
    "$env:SystemDrive\Python311\python.exe",
    "$env:SystemDrive\Python310\python.exe",
    "$env:ProgramFiles\Python315\python.exe",
    "$env:ProgramFiles\Python314\python.exe",
    "$env:ProgramFiles\Python313\python.exe",
    "$env:ProgramFiles\Python312\python.exe",
    "$env:ProgramFiles\Python311\python.exe",
    "$env:ProgramFiles\Python310\python.exe"
  )
  foreach($candidate in $known){ $p=NormalizePython $candidate; if($p){ return $p } }

  # py.exe is the most reliable way to discover side-by-side Windows Python installs.
  $py=Get-Command py.exe -ErrorAction SilentlyContinue
  if($py){
    foreach($v in @('3.15','3.14','3.13','3.12','3.11','3.10')){
      try {
        $candidate=& $py.Source "-$v" -c "import sys; print(sys.executable)" 2>$null
        if($candidate){ $p=NormalizePython ([string]$candidate); if($p){ return $p } }
      } catch {}
    }
  }

  foreach($name in @('python.exe','python3.exe')){
    $c=Get-Command $name -ErrorAction SilentlyContinue
    if($c){ $p=NormalizePython $c.Source; if($p){ return $p } }
  }
  return $null
}

$p=FindPython
if($p){
  Write-Host ("[OK] Using installed Python: {0}" -f $p)
  Set-Content -LiteralPath $OutputFile -Value $p -Encoding Default
  exit 0
}

# Install only when this PC truly has no usable Python 3.10+ runtime.
Write-Host '[Setup] No usable Python 3.10+ runtime was found. Installing Python 3.13 for this Windows user...'
$winget=Get-Command winget.exe -ErrorAction SilentlyContinue
if($winget){
  try {
    & $winget.Source install --id Python.Python.3.13 -e --scope user --silent --accept-package-agreements --accept-source-agreements *> $null
  } catch {}
  $p=FindPython
}

if(-not $p){
  $arch=$env:PROCESSOR_ARCHITECTURE
  if($env:PROCESSOR_ARCHITEW6432){$arch=$env:PROCESSOR_ARCHITEW6432}
  $suffix='amd64'
  if($arch -match 'ARM64'){$suffix='arm64'} elseif($arch -match '86'){$suffix=''}
  $name= if($suffix){"python-3.13.14-$suffix.exe"}else{"python-3.13.14.exe"}
  $url="https://www.python.org/ftp/python/3.13.14/$name"
  $tmp=Join-Path $env:TEMP $name
  try{
    Write-Host '[Setup] Downloading the official Python runtime...'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
    $args='/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_launcher=1 Include_test=0 Include_doc=0 Shortcuts=0'
    Start-Process -FilePath $tmp -ArgumentList $args -Wait
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }catch{}
  $p=FindPython
}

if($p){
  Write-Host ("[OK] Python ready: {0}" -f $p)
  Set-Content -LiteralPath $OutputFile -Value $p -Encoding Default
  exit 0
}
Set-Content -LiteralPath $OutputFile -Value '' -Encoding Default
exit 1
