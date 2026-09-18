param(
  [Parameter(Mandatory=$true)][string]$Root
)

$ErrorActionPreference='Stop'
$received=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if([string]::IsNullOrWhiteSpace($received)){ throw 'NUNES master folder path is empty.' }
$resolved=Resolve-Path -LiteralPath $received -ErrorAction Stop
$Root=$resolved.ProviderPath.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){ throw 'Git for Windows is not installed or not in PATH.' }

$oldPreference=$ErrorActionPreference
try {
  $ErrorActionPreference='Continue'
  $lines=@(& $git.Source -C $Root diff --cached --name-only 2>&1)
  $rc=$LASTEXITCODE
} finally {
  $ErrorActionPreference=$oldPreference
}
if($rc -ne 0){ throw 'Could not inspect the staged Git files.' }

$bad=New-Object System.Collections.Generic.List[string]
foreach($line in $lines){
  if($line -is [System.Management.Automation.ErrorRecord]){ continue }
  $p=([string]$line).Replace('\','/').Trim()
  if([string]::IsNullOrWhiteSpace($p)){ continue }

  $isEnv=($p -match '(?i)(^|/)\.env($|\.)')
  $isSafeEnvExample=($p -match '(?i)(^|/)\.env\.example$')
  $isSafeDataPlaceholder=($p -ieq 'apps/order_forms/data/.keep' -or $p -ieq 'apps/service_operations/data/.gitkeep')

  if($p -match '^(?i:LOCAL_ONLY_SECRETS)/' -or
     (($p -match '^(?i:apps/order_forms/data)/' -or $p -match '^(?i:apps/service_operations/data)/') -and -not $isSafeDataPlaceholder) -or
     $p -match '^(?i:backups)/' -or
     $p -match '(?i)(^|/)google_oauth_client\.json$' -or
     $p -match '(?i)(^|/)client_secret[^/]*\.json$' -or
     $p -match '(?i)(^|/).*oauth.*token.*\.json$' -or
     ($isEnv -and -not $isSafeEnvExample) -or
     $p -match '(?i)\.(db|db-wal|db-shm|sqlite|sqlite3)$'){
    $bad.Add($p)
  }
}
if($bad.Count -gt 0){
  Write-Host '[BLOCKED] Private data or credential file(s) are staged:' -ForegroundColor Red
  foreach($item in $bad){ Write-Host ('  - ' + $item) -ForegroundColor Red }
  exit 3
}

Write-Host '[OK] Git staging safety check passed. .env.example and empty .keep/.gitkeep placeholders are allowed.' -ForegroundColor Green
exit 0
