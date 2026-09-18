param(
  [Parameter(Mandatory=$true)][ValidateSet('OWNER','STAFF')][string]$Role,
  [string]$ServerUrl='http://100.97.196.17:8795'
)

$ErrorActionPreference='Stop'
$ServerUrl=$ServerUrl.Trim().TrimEnd('/')
$state=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
New-Item -ItemType Directory -Force -Path $state | Out-Null

Write-Host ('NUNES ' + $Role + ' PC - ONE TIME SETUP') -ForegroundColor Cyan
Write-Host ('Server: ' + $ServerUrl)
Write-Host ''

$ts=$null
$cmd=Get-Command tailscale.exe -ErrorAction SilentlyContinue
if($cmd){$ts=$cmd.Source}
if(-not $ts){
  foreach($candidate in @(
    (Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Tailscale\tailscale.exe')
  )){
    if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)){$ts=$candidate;break}
  }
}
if(-not $ts){
  Start-Process 'https://tailscale.com/download/windows' -ErrorAction SilentlyContinue
  throw 'Tailscale is not installed. Install it, sign in to the company tailnet, then run this setup again.'
}

& $ts status *> $null
if($LASTEXITCODE -ne 0){ throw 'Tailscale is installed but not connected. Sign in to the company tailnet and retry.' }
Write-Host '[OK] Tailscale connected.' -ForegroundColor Green

$healthy=$false
1..5 | ForEach-Object {
  try{
    $h=Invoke-RestMethod -TimeoutSec 4 ($ServerUrl + '/api/health?_clientsetup=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    if($h.ok -eq $true -and [string]$h.product -eq 'NUNES Company Platform'){$healthy=$true; return}
  }catch{}
  Start-Sleep -Milliseconds 600
}
if(-not $healthy){
  try{ & $ts ping 100.97.196.17 }catch{}
  throw ('This PC cannot reach the NUNES main server at ' + $ServerUrl + '. Confirm the main-server PC is ON and TCP 8795 is running.')
}
Write-Host '[OK] Main server reachable.' -ForegroundColor Green

Set-Content -LiteralPath (Join-Path $state 'client-server-url.txt') -Value $ServerUrl -Encoding ASCII
Set-Content -LiteralPath (Join-Path $state 'client-role.txt') -Value $Role -Encoding ASCII
Set-Content -LiteralPath (Join-Path $state 'deployment-mode.txt') -Value @(
  'Mode=GITHUB_SINGLE_SOURCE_CLIENT',
  ('Role=' + $Role),
  ('Server=' + $ServerUrl),
  'LocalSourceRequired=NO',
  ('Installed=' + (Get-Date).ToString('s'))
) -Encoding UTF8

# Client shortcut is deliberately URL-based and permanent. App/source updates happen
# only on the main server, so owner/staff never need to replace local code files.
$desktop=[Environment]::GetFolderPath('Desktop')
if([string]::IsNullOrWhiteSpace($desktop)){throw 'Windows Desktop folder could not be resolved.'}
$urlPath=Join-Path $desktop 'NUNES Operations.url'
$icon=(Join-Path $env:SystemRoot 'System32\shell32.dll')
$content=@(
  '[InternetShortcut]',
  ('URL=' + $ServerUrl + '/?_nunes_client=' + $Role.ToLowerInvariant()),
  ('IconFile=' + $icon),
  'IconIndex=137'
)
Set-Content -LiteralPath $urlPath -Value $content -Encoding ASCII

# Remove an old stale .lnk with the same name so the user sees one reliable icon.
$oldLnk=Join-Path $desktop 'NUNES Operations.lnk'
if(Test-Path -LiteralPath $oldLnk){ Remove-Item -LiteralPath $oldLnk -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host '[READY] Desktop icon created: NUNES Operations' -ForegroundColor Green
Write-Host 'No Git, Node, npm, VS Code, server files, Gmail JSON or WhatsApp setup is required on this PC.' -ForegroundColor Green
Write-Host 'When GitHub main is pushed, the MAIN SERVER updates itself; this desktop icon automatically opens that latest app.' -ForegroundColor Green
Write-Host 'If the app is already open, the built-in rollout checker refreshes it after the new server version is live.' -ForegroundColor Green
try{ Start-Process ($ServerUrl + '/?_nunes_client=' + $Role.ToLowerInvariant()) }catch{}
exit 0
