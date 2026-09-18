param(
  [Parameter(Mandatory=$true)][string]$Root,
  [switch]$Quiet
)

$ErrorActionPreference='Stop'
$expected='https://github.com/Nunes-instruments/Form_Filling_Crm.git'
$received=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if([string]::IsNullOrWhiteSpace($received)){ throw 'NUNES master folder path is empty.' }
$resolved=Resolve-Path -LiteralPath $received -ErrorAction Stop
$Root=$resolved.ProviderPath.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)

# Never turn a small patch folder into the product repository.
$fullSourceRequired=@(
  'tools\apply-main-server-update.ps1',
  'platform_web\package.json',
  'apps\service_operations\package.json',
  'apps\order_forms\app.py'
)
$missingFullSource=@($fullSourceRequired | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Root $_) -PathType Leaf) })
if($missingFullSource.Count -gt 0){
  throw ('This is an incomplete/patch folder, not the NUNES master source. Missing: ' + ($missingFullSource -join ', ') + '. Use the FULL product folder; Git was not initialized by this check.')
}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){ throw 'Git for Windows is not installed or not in PATH.' }
$gitExe=$git.Source

# IMPORTANT: Windows PowerShell 5 can convert native STDERR into a terminating
# NativeCommandError when $ErrorActionPreference='Stop'. Git legitimately writes
# to STDERR for probes such as "rev-parse --verify" or a missing remote. This
# wrapper temporarily uses Continue, captures output, then decides only from the
# real Git exit code.
function RunGit {
  param([Parameter(Mandatory=$true)][string[]]$Args,[switch]$AllowFail,[switch]$Capture)
  $oldPreference=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    $lines=@(& $gitExe -C $Root @Args 2>&1)
    $code=$LASTEXITCODE
  } finally {
    $ErrorActionPreference=$oldPreference
  }
  $text=@($lines | ForEach-Object {
    if($_ -is [System.Management.Automation.ErrorRecord]){ [string]$_.Exception.Message }
    else { [string]$_ }
  })
  if($code -ne 0 -and -not $AllowFail){
    $detail=($text | Select-Object -Last 3) -join ' | '
    if([string]::IsNullOrWhiteSpace($detail)){ $detail='exit code ' + $code }
    throw ('Git command failed: git ' + ($Args -join ' ') + ' :: ' + $detail)
  }
  if($Capture){ return [pscustomobject]@{Code=$code;Output=$text} }
  foreach($line in $text){ if(-not [string]::IsNullOrWhiteSpace($line)){ Write-Host $line } }
  return $code
}

# Keep secrets/company data out of Git even when this folder was freshly extracted.
$ignorePath=Join-Path $Root '.gitignore'
$required=@(
  '',
  '# NUNES local-only safety',
  'LOCAL_ONLY_SECRETS/',
  'apps/service_operations/config/google_oauth_client.json',
  'apps/order_forms/data/*',
  '!apps/order_forms/data/.keep',
  'apps/service_operations/data/*',
  '!apps/service_operations/data/.gitkeep',
  'backups/',
  '.env',
  '.env.*',
  '!.env.example',
  '*.token.json',
  '*oauth*token*.json',
  '*.db',
  '*.db-wal',
  '*.db-shm',
  '*.sqlite',
  '*.sqlite3',
  'UPDATE_ID.txt',
  'OPEN_ON_OTHER_DEVICES.txt',
  'server-startup.log'
)
if(-not (Test-Path -LiteralPath $ignorePath -PathType Leaf)){
  Set-Content -LiteralPath $ignorePath -Value $required -Encoding UTF8
}else{
  $existing=Get-Content -LiteralPath $ignorePath -Raw -ErrorAction SilentlyContinue
  $append=New-Object System.Collections.Generic.List[string]
  foreach($line in $required){
    if([string]::IsNullOrWhiteSpace($line)){ continue }
    if($existing -notmatch ('(?m)^' + [regex]::Escape($line) + '$')){ $append.Add($line) }
  }
  if($append.Count -gt 0){
    Add-Content -LiteralPath $ignorePath -Value @('','# NUNES safety additions') -Encoding UTF8
    Add-Content -LiteralPath $ignorePath -Value $append -Encoding UTF8
  }
}

$newRepo=$false
if(-not (Test-Path -LiteralPath (Join-Path $Root '.git') -PathType Container)){
  $newRepo=$true
  if(-not $Quiet){ Write-Host '[GIT] This extracted folder is not yet a Git repository. Connecting it safely now...' -ForegroundColor Yellow }
  $init=RunGit -Args @('init','-b','main') -AllowFail -Capture
  if($init.Code -ne 0){
    RunGit -Args @('init') | Out-Null
    RunGit -Args @('branch','-M','main') | Out-Null
  }
}

# Local commit identity only if missing.
$name=(RunGit -Args @('config','user.name') -AllowFail -Capture).Output | Select-Object -First 1
if([string]::IsNullOrWhiteSpace([string]$name)){ RunGit -Args @('config','user.name','Nunes Instruments') | Out-Null }
$mail=(RunGit -Args @('config','user.email') -AllowFail -Capture).Output | Select-Object -First 1
if([string]::IsNullOrWhiteSpace([string]$mail)){ RunGit -Args @('config','user.email','307533164+Nunes-instruments@users.noreply.github.com') | Out-Null }

# Do NOT call "git remote get-url origin" until we know origin exists.
# A missing origin is normal on a freshly extracted folder and must not abort setup.
$remoteNames=@((RunGit -Args @('remote') -Capture).Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
$origin=''
if($remoteNames -contains 'origin'){
  $origin=([string]((RunGit -Args @('remote','get-url','origin') -Capture).Output | Select-Object -First 1)).Trim()
}
if([string]::IsNullOrWhiteSpace($origin)){
  RunGit -Args @('remote','add','origin',$expected) | Out-Null
  $origin=$expected
}elseif($origin.TrimEnd('/').ToLowerInvariant() -ne $expected.TrimEnd('/').ToLowerInvariant()){
  if(-not $Quiet){ Write-Host ('[GIT] Replacing old origin: ' + $origin) -ForegroundColor Yellow }
  RunGit -Args @('remote','set-url','origin',$expected) | Out-Null
  $origin=$expected
}

# Fetch the existing main history. Public read works even before a push login is needed.
$fetch=RunGit -Args @('fetch','origin','main','--prune') -AllowFail -Capture
$remoteMainCheck=RunGit -Args @('rev-parse','--verify','refs/remotes/origin/main') -AllowFail -Capture
$remoteMain=($remoteMainCheck.Code -eq 0)

if($newRepo -and $remoteMain){
  # Attach this extracted working tree to the real GitHub history WITHOUT replacing local product files.
  # --mixed moves HEAD/index only; the working tree stays exactly as extracted.
  RunGit -Args @('reset','--mixed','origin/main') -Capture | Out-Null
  RunGit -Args @('branch','-M','main') | Out-Null
  RunGit -Args @('branch','--set-upstream-to=origin/main','main') -AllowFail -Capture | Out-Null
  if(-not $Quiet){ Write-Host '[GIT] Existing Form_Filling_Crm history attached. Local full product files were kept.' -ForegroundColor Green }
}elseif(-not $remoteMain){
  RunGit -Args @('branch','-M','main') -AllowFail -Capture | Out-Null
  if($fetch.Code -ne 0 -and -not $Quiet){ Write-Host '[GIT] GitHub fetch could not complete now. Local repository is ready; push may request login later.' -ForegroundColor Yellow }
}else{
  $branch=([string]((RunGit -Args @('branch','--show-current') -AllowFail -Capture).Output | Select-Object -First 1)).Trim()
  if($branch -ne 'main'){
    $dirty=((RunGit -Args @('status','--porcelain') -Capture).Output).Count -gt 0
    if($dirty){ throw "Git repository is on '$branch' with uncommitted changes. Save/commit them before switching to main." }
    $checkout=RunGit -Args @('checkout','main') -AllowFail -Capture
    $branch=([string]((RunGit -Args @('branch','--show-current') -AllowFail -Capture).Output | Select-Object -First 1)).Trim()
    if($branch -ne 'main'){ RunGit -Args @('checkout','-B','main','origin/main') | Out-Null }
  }
  RunGit -Args @('branch','--set-upstream-to=origin/main','main') -AllowFail -Capture | Out-Null
}

# Final safety: a secret must never already be tracked.
$tracked=RunGit -Args @('ls-files') -Capture
$bad=@($tracked.Output | Where-Object {
  $path=([string]$_).Replace('\','/').Trim()
  $isEnv=($path -match '(^|/)\.env($|\.)')
  $isSafeEnvExample=($path -match '(^|/)\.env\.example$')
  $path -match '(^|/)LOCAL_ONLY_SECRETS/' -or
  $path -match '(^|/)client_secret.*\.json$' -or
  $path -match 'google_oauth_client\.json$' -or
  ($isEnv -and -not $isSafeEnvExample) -or
  $path -match 'oauth.*token.*\.json$'
})
if($bad.Count -gt 0){
  throw ('A private credential is already tracked by Git: ' + ($bad -join ', ') + '. Remove it from Git history/index before publishing.')
}

$ignoreCheck=RunGit -Args @('check-ignore','-q','--no-index','LOCAL_ONLY_SECRETS/google_oauth_client.json') -AllowFail -Capture
if($ignoreCheck.Code -ne 0){ throw 'Secret protection is not active in .gitignore.' }

if(-not $Quiet){
  Write-Host '[OK] Git master folder is ready.' -ForegroundColor Green
  Write-Host ('     Root   : ' + $Root)
  Write-Host ('     Remote : ' + $expected)
  Write-Host '     Branch : main'
}
exit 0
