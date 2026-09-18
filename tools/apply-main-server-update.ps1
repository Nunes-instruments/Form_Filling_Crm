param([Parameter(Mandatory=$true)][string]$Root)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$received = [Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if ([string]::IsNullOrWhiteSpace($received)) { throw 'NUNES update folder path is empty.' }
$Root = (Resolve-Path -LiteralPath $received -ErrorAction Stop).ProviderPath
$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

# Keep the private default Google OAuth JSON outside the Git repository.
$secretInstaller = Join-Path $Root 'tools\install-local-google-secret.ps1'
if (Test-Path -LiteralPath $secretInstaller -PathType Leaf) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $secretInstaller -Root $Root -Quiet
  if ($LASTEXITCODE -ne 0) { throw 'Private Google OAuth JSON could not be installed locally.' }
}

function Copy-BackupFolder([string]$Source,[string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /XJ /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  $rc = $LASTEXITCODE
  if ($rc -ge 8) { throw "Backup failed for $Source (robocopy code $rc). No update was applied." }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $stateRoot ("UpdateBackups\UPDATE_" + $stamp)
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

Write-Host '[1/5] Backing up persistent company data...' -ForegroundColor Cyan
Copy-BackupFolder (Join-Path $stateRoot 'PurchasingData') (Join-Path $backupRoot 'PurchasingData')
Copy-BackupFolder (Join-Path $stateRoot 'ServiceData') (Join-Path $backupRoot 'ServiceData')

# Create a new rollout ID every time a new package is applied. Existing browser pages
# keep their old ID and automatically reload when /api/health reports this new value.
$version = 'unknown'
try {
  $vf = Join-Path $Root 'VERSION.txt'
  if (Test-Path -LiteralPath $vf) { $version = (Get-Content -LiteralPath $vf -Raw).Trim() }
} catch {}
$hashSource = @(
  (Join-Path $Root 'VERSION.txt'),
  (Join-Path $Root 'platform_web\src\app\api\health\route.ts'),
  (Join-Path $Root 'platform_web\src\app\layout.tsx')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
$hashText = ''
foreach ($file in $hashSource) {
  try { $hashText += (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash } catch {}
}
$shortHash = 'package'
if (-not [string]::IsNullOrWhiteSpace($hashText)) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($hashText)
    $shortHash = (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0,8)
  } finally { $sha.Dispose() }
}
$updateId = ((Get-Date -Format 'yyyyMMddHHmmss') + '-' + $version + '-' + $shortHash).Replace(' ','')
Set-Content -LiteralPath (Join-Path $Root 'UPDATE_ID.txt') -Value $updateId -Encoding ASCII
$rolloutSource = Join-Path $Root 'platform_web\src\lib\rollout-id.ts'
$escapedUpdateId = $updateId.Replace('\','\\').Replace('"','\"')
$rolloutBody = @(
  '// Build-time rollout ID. The live update engine temporarily replaces this file, builds, then restores it so Git stays clean.',
  ('export const NUNES_ROLLOUT_ID = "' + $escapedUpdateId + '";')
)
$originalRolloutBytes = $null
if (Test-Path -LiteralPath $rolloutSource -PathType Leaf) {
  $originalRolloutBytes = [IO.File]::ReadAllBytes($rolloutSource)
}
Set-Content -LiteralPath (Join-Path $stateRoot 'pending-update-id.txt') -Value $updateId -Encoding ASCII

Write-Host '[2/5] Installing the new code on THIS main-server PC...' -ForegroundColor Cyan
$configure = Join-Path $Root 'tools\configure-office-server.ps1'
if (-not (Test-Path -LiteralPath $configure -PathType Leaf)) { throw "Server setup engine is missing: $configure" }
try {
  Set-Content -LiteralPath $rolloutSource -Value $rolloutBody -Encoding UTF8
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $configure -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'The new main-server code could not be installed. Existing persistent data remains backed up.' }
} finally {
  # The generated rollout value is baked into .next. Restore the tracked source so
  # every VS Code live update does not create a fake Git change.
  if ($null -ne $originalRolloutBytes) {
    [IO.File]::WriteAllBytes($rolloutSource, $originalRolloutBytes)
  } else {
    Remove-Item -LiteralPath $rolloutSource -Force -ErrorAction SilentlyContinue
  }
}

Write-Host '[3/5] Verifying the updated dashboard...' -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(45)
$ready = $false
$seenId = ''
while ((Get-Date) -lt $deadline) {
  try {
    $h = Invoke-RestMethod -TimeoutSec 2 ('http://127.0.0.1:8795/api/health?_verify=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    if ($h.ok -eq $true -and [string]$h.product -eq 'NUNES Company Platform') {
      $seenId = [string]$h.update_id
      if ($seenId -eq $updateId) { $ready = $true; break }
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $ready) {
  throw ("The server restarted but the new rollout ID was not confirmed. Expected: {0}; Seen: {1}" -f $updateId,$seenId)
}

Write-Host '[4/5] Confirming staff/owner Tailscale firewall access...' -ForegroundColor Cyan
$ports = @(5055,5056,8770,8795)
foreach ($port in ($ports | Sort-Object -Unique)) {
  $ruleName = "NUNES Operations TCP $port"
  try {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort ([string]$port) -Profile Any -RemoteAddress @('LocalSubnet','100.64.0.0/10') -ErrorAction Stop | Out-Null
  } catch {
    & netsh.exe advfirewall firewall delete rule name="$ruleName" | Out-Null
    & netsh.exe advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$port profile=any remoteip=localsubnet,100.64.0.0/10 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not enable staff/owner access for TCP $port." }
  }
}

Write-Host '[5/5] Auto rollout is active.' -ForegroundColor Green
Set-Content -LiteralPath (Join-Path $stateRoot 'last-update-id.txt') -Value $updateId -Encoding ASCII
Remove-Item -LiteralPath (Join-Path $stateRoot 'pending-update-id.txt') -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'UPDATE COMPLETE' -ForegroundColor Green
Write-Host ("Update ID : {0}" -f $updateId)
Write-Host ("Backup    : {0}" -f $backupRoot)
Write-Host 'Staff and owner PCs do NOT need this ZIP.' -ForegroundColor Green
Write-Host 'Open dashboards detect this rollout automatically and refresh themselves.' -ForegroundColor Green
Write-Host 'Closed PCs receive the latest version the next time they open NUNES Operations.' -ForegroundColor Green
Write-Host 'Port 8765 was not assigned to this NUNES server.' -ForegroundColor Green

try { Start-Process 'http://127.0.0.1:8795' } catch {}
exit 0
