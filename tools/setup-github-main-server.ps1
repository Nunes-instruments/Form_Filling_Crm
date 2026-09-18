param(
  [Parameter(Mandatory=$true)][string]$Root
)

$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'

$received=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if([string]::IsNullOrWhiteSpace($received)){ throw 'NUNES master folder path is empty.' }
$Root=(Resolve-Path -LiteralPath $received -ErrorAction Stop).ProviderPath

function Step([string]$Text){ Write-Host ''; Write-Host $Text -ForegroundColor Cyan }
function Ok([string]$Text){ Write-Host ('[OK] ' + $Text) -ForegroundColor Green }

Step '[1/7] Checking complete NUNES source...'
$assert=Join-Path $Root 'tools\assert-full-source.ps1'
if(-not (Test-Path -LiteralPath $assert -PathType Leaf)){ throw 'Full-source checker is missing.' }
& $assert -Root $Root
if($LASTEXITCODE -ne 0){ throw 'This is not the complete NUNES source folder.' }
Ok 'Complete source confirmed.'

Step '[2/7] Checking Git for Windows...'
$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){
  foreach($candidate in @(
    (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe')
  )){
    if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)){
      $env:Path=(Split-Path -Parent $candidate) + ';' + $env:Path
      $git=Get-Command git.exe -ErrorAction SilentlyContinue
      if($git){break}
    }
  }
}
if(-not $git){
  $winget=Get-Command winget.exe -ErrorAction SilentlyContinue
  if($winget){
    Write-Host '[INFO] Git is missing. Installing Git for Windows once...' -ForegroundColor Yellow
    & $winget.Source install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements --silent
    if($LASTEXITCODE -eq 0){
      $machine=[Environment]::GetEnvironmentVariable('Path','Machine')
      $user=[Environment]::GetEnvironmentVariable('Path','User')
      $env:Path=$machine+';'+$user
      $git=Get-Command git.exe -ErrorAction SilentlyContinue
    }
  }
}
if(-not $git){
  Start-Process 'https://git-scm.com/download/win' -ErrorAction SilentlyContinue
  throw 'Git for Windows is required. Install Git, then run 0_NUNES_ALL_IN_ONE_SETUP.bat again.'
}
Ok ('Git ready: ' + $git.Source)

Step '[3/7] Connecting THIS folder to the one GitHub source...'
$ensureGit=Join-Path $Root 'tools\ensure-git-master.ps1'
& $ensureGit -Root $Root
if($LASTEXITCODE -ne 0){ throw 'GitHub master-folder setup failed.' }
Ok 'GitHub repository: Nunes-instruments/Form_Filling_Crm, branch main.'

Step '[4/7] Installing / updating the live main server on TCP 8795...'
$apply=Join-Path $Root 'tools\apply-main-server-update.ps1'
& $apply -Root $Root
if($LASTEXITCODE -ne 0){ throw 'Live main-server update failed.' }
Ok 'Main server is live on http://127.0.0.1:8795'

Step '[5/7] Enabling automatic GitHub pull + live apply...'
$auto=Join-Path $Root 'tools\install-github-auto-update.ps1'
& $auto -Root $Root -Quiet
if($LASTEXITCODE -ne 0){ throw 'Could not install the GitHub auto-update task.' }
Ok 'Main server checks GitHub main every 1 minute.'

Step '[6/7] Creating the MAIN SERVER desktop icon...'
$shortcut=Join-Path $Root 'tools\create-desktop-shortcut.ps1'
& $shortcut -Root $Root
if($LASTEXITCODE -ne 0){ throw 'Could not create the main-server desktop shortcut.' }
Ok 'Desktop icon: NUNES Operations'

Step '[7/7] Final verification...'
$healthy=$false
1..15 | ForEach-Object {
  try{
    $h=Invoke-RestMethod -TimeoutSec 2 ('http://127.0.0.1:8795/api/health?_setup=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    if($h.ok -eq $true -and [string]$h.product -eq 'NUNES Company Platform'){$healthy=$true; return}
  }catch{}
  Start-Sleep -Milliseconds 500
}
if(-not $healthy){ throw 'Server setup finished, but TCP 8795 health could not be confirmed.' }

$state=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
New-Item -ItemType Directory -Force -Path $state | Out-Null
Set-Content -LiteralPath (Join-Path $state 'deployment-mode.txt') -Value @(
  'Mode=GITHUB_SINGLE_SOURCE',
  'Role=MAIN_SERVER',
  ('Root=' + $Root),
  'Repository=https://github.com/Nunes-instruments/Form_Filling_Crm.git',
  'Branch=main',
  'DashboardPort=8795',
  'ClientUrl=http://100.97.196.17:8795',
  ('Installed=' + (Get-Date).ToString('s'))
) -Encoding UTF8

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' NUNES MAIN SERVER - GITHUB SINGLE SOURCE READY' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host 'Main PC       : http://127.0.0.1:8795'
Write-Host 'Owner / Staff : http://100.97.196.17:8795'
Write-Host 'GitHub        : Nunes-instruments/Form_Filling_Crm / main'
Write-Host 'Auto update   : every 1 minute'
Write-Host '8765          : untouched'
Write-Host ''
Write-Host 'IMPORTANT: Push this V6.6.0 folder once with:' -ForegroundColor Yellow
Write-Host '  1_PUSH_GITHUB_AND_GO_LIVE.bat' -ForegroundColor Yellow
Write-Host 'After that, ANY future push to main is pulled/applied automatically.' -ForegroundColor Green
Write-Host 'Staff/Owner PCs never need another source ZIP for normal app updates.' -ForegroundColor Green

try{ Start-Process 'http://127.0.0.1:8795' }catch{}
exit 0
