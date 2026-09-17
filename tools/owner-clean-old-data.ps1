param(
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference='Stop'
$Root=(Resolve-Path -LiteralPath $Root).ProviderPath
$script=Join-Path $Root 'tools\owner-clean-old-data.py'
if(-not (Test-Path -LiteralPath $script -PathType Leaf)){throw 'Owner cleanup script is missing.'}

$pythonExe=''
$config=Join-Path $env:LOCALAPPDATA 'NUNES Operations\CompanyResident\company-resident.json'
if(Test-Path -LiteralPath $config -PathType Leaf){
  try{$pythonExe=[string]((Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).pythonExe)}catch{}
}
if([string]::IsNullOrWhiteSpace($pythonExe) -or -not (Test-Path -LiteralPath $pythonExe -PathType Leaf)){
  $cmd=Get-Command python.exe -ErrorAction SilentlyContinue
  if($cmd){$pythonExe=$cmd.Source}
}
if([string]::IsNullOrWhiteSpace($pythonExe) -or -not (Test-Path -LiteralPath $pythonExe -PathType Leaf)){
  throw 'Python is not prepared yet. Run 1_SETUP_ALWAYS_ON_SERVER.bat once, then run this cleanup again.'
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '       NUNES OWNER - REMOVE OLD DATA BEFORE A DATE' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'This is OWNER ONLY.' -ForegroundColor Yellow
Write-Host 'The date you enter is the FIRST DATE TO KEEP.'
Write-Host 'Everything older than that date is removed from active Purchasing/Servicing data.'
Write-Host 'A recovery backup is created automatically before deletion.' -ForegroundColor Green
Write-Host ''
$cutoff=Read-Host 'Start date to KEEP (YYYY-MM-DD)'
if($cutoff -notmatch '^\d{4}-\d{2}-\d{2}$'){throw 'Invalid date. Use YYYY-MM-DD, for example 2026-09-01.'}

Write-Host ''
& $pythonExe $script --cutoff $cutoff
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}

Write-Host ''
Write-Host ('DANGER: Records BEFORE {0} will be removed from the active system.' -f $cutoff) -ForegroundColor Red
$confirm=Read-Host ('Type DELETE BEFORE {0} to continue' -f $cutoff)
if($confirm -cne ('DELETE BEFORE {0}' -f $cutoff)){
  Write-Host 'Cancelled. Nothing was deleted.' -ForegroundColor Yellow
  exit 0
}

Write-Host ''
& $pythonExe $script --cutoff $cutoff --yes
exit $LASTEXITCODE
