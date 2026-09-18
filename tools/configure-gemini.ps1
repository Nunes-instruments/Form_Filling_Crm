param(
  [Parameter(Mandatory=$true)][string]$Root,
  [string]$DefaultKeyFile = '',
  [switch]$NonInteractive,
  [switch]$ForceDefault
)
$ErrorActionPreference = 'Stop'

function Convert-SecureToPlain([Security.SecureString]$secure) {
  if ($null -eq $secure) { return '' }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-JsonSafe([string]$Path) {
  try {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
      if (-not [string]::IsNullOrWhiteSpace($raw)) { return ($raw | ConvertFrom-Json) }
    }
  } catch {}
  return $null
}

function Get-KeyFromSettings([string]$Path) {
  $obj = Read-JsonSafe $Path
  if ($null -eq $obj) { return '' }
  try { return [string]$obj.geminiApiKey } catch { return '' }
}

function Get-DpapiKey([string]$Path) {
  try {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    $cipher = (Get-Content -LiteralPath $Path -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($cipher)) { return '' }
    $secure = ConvertTo-SecureString $cipher
    return Convert-SecureToPlain $secure
  } catch { return '' }
}

function Get-PlainKeyFile([string]$Path) {
  try {
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    return ([string](Get-Content -LiteralPath $Path -Raw -ErrorAction Stop)).Trim()
  } catch { return '' }
}

$Root = (Resolve-Path -LiteralPath $Root).ProviderPath
$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$dataDir = Join-Path $stateRoot 'ServiceData'
$settingsPath = Join-Path $dataDir 'settings.json'
$secretDir = Join-Path $stateRoot 'Secrets'
$secretPath = Join-Path $secretDir 'gemini-api-key.dpapi'
New-Item -ItemType Directory -Force -Path $dataDir,$secretDir | Out-Null

# Prefer the permanent local DPAPI secret, then the shared settings file.
$existingKey = Get-DpapiKey $secretPath
if ([string]::IsNullOrWhiteSpace($existingKey)) { $existingKey = Get-KeyFromSettings $settingsPath }

# V6.6.3 migration: recover a previously configured key from any older Servicing
# runtime or update backup. The key is copied only to LOCALAPPDATA and is never
# written to the Git source tree.
if ([string]::IsNullOrWhiteSpace($existingKey)) {
  $candidates = @()
  $runtimeBase = Join-Path $stateRoot 'ServicingRuntimeV5'
  if (Test-Path -LiteralPath $runtimeBase -PathType Container) {
    $candidates += @(Get-ChildItem -LiteralPath $runtimeBase -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName 'apps\service_operations\data\settings.json' })
  }
  $backupRoot = Join-Path $stateRoot 'MainServerBackups'
  if (Test-Path -LiteralPath $backupRoot -PathType Container) {
    foreach ($stamp in @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue)) {
      foreach ($folder in @('ServiceData','Servicing_Gmail_settings_data','Servicing___Gmail_settings_data')) {
        $candidates += (Join-Path $stamp.FullName ($folder + '\settings.json'))
      }
    }
  }
  $valid = foreach ($candidate in $candidates) {
    try {
      $key = Get-KeyFromSettings $candidate
      if (-not [string]::IsNullOrWhiteSpace($key)) {
        $st = Get-Item -LiteralPath $candidate -ErrorAction Stop
        [pscustomobject]@{ Key=$key.Trim(); Time=$st.LastWriteTimeUtc; Path=$candidate }
      }
    } catch {}
  }
  $picked = $valid | Sort-Object Time -Descending | Select-Object -First 1
  if ($picked) {
    $existingKey = [string]$picked.Key
    Write-Host 'Recovered the previously configured Gemini key from an older NUNES runtime.' -ForegroundColor Green
  }
}

$bundledKey = Get-PlainKeyFile $DefaultKeyFile
if ($ForceDefault -and -not [string]::IsNullOrWhiteSpace($bundledKey)) {
  $key = $bundledKey
  Write-Host ''
  Write-Host 'Applying the owner-provided default Gemini key to this main-server profile.' -ForegroundColor Green
} elseif (-not [string]::IsNullOrWhiteSpace($existingKey)) {
  if ($NonInteractive) {
    $key = $existingKey
    Write-Host ''
    Write-Host 'Existing local Gemini key retained.' -ForegroundColor Green
  } else {
    Write-Host ''
    Write-Host 'A Gemini API key is already available locally.' -ForegroundColor Green
    Write-Host 'Press ENTER to keep it, or paste a NEW key to replace it.'
    $secure = Read-Host 'Gemini API key' -AsSecureString
    $entered = Convert-SecureToPlain $secure
    $key = if ([string]::IsNullOrWhiteSpace($entered)) { $existingKey } else { $entered.Trim() }
  }
} elseif (-not [string]::IsNullOrWhiteSpace($bundledKey)) {
  $key = $bundledKey
  Write-Host ''
  Write-Host 'Applying the owner-provided default Gemini key to this main-server profile.' -ForegroundColor Green
} elseif ($NonInteractive) {
  throw 'No Gemini API key is available for non-interactive setup.'
} else {
  Write-Host ''
  Write-Host 'No Gemini API key could be recovered.' -ForegroundColor Yellow
  Write-Host 'Paste a Gemini API key. It will be saved only on this Windows main-server user profile.'
  $secure = Read-Host 'Gemini API key' -AsSecureString
  $key = (Convert-SecureToPlain $secure).Trim()
}
if ([string]::IsNullOrWhiteSpace($key)) { throw 'No Gemini API key is available.' }

# Save an encrypted Windows-user-local fallback so future code/runtime rebuilds cannot
# lose the key. This file is outside Git and can only be decrypted by this Windows user.
$secureKey = ConvertTo-SecureString $key -AsPlainText -Force
$cipher = ConvertFrom-SecureString $secureKey
Set-Content -LiteralPath $secretPath -Value $cipher -Encoding ASCII

# Keep the application's existing settings contract too. Preserve all other settings.
$obj = Read-JsonSafe $settingsPath
if ($null -eq $obj) { $obj = [pscustomobject]@{} }
$obj | Add-Member -NotePropertyName geminiApiKey -NotePropertyValue $key -Force
$obj | Add-Member -NotePropertyName formVisionEnabled -NotePropertyValue $true -Force
# Owner default for the Service Form reader. Keep one stable model across rebuilds.
$obj | Add-Member -NotePropertyName formVisionModel -NotePropertyValue 'gemini-3.6-flash' -Force
foreach ($name in @('groqApiKey','formVlmEnabled','formVlmModel')) {
  if ($obj.PSObject.Properties.Name -contains $name) { $obj.PSObject.Properties.Remove($name) }
}
$obj | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

Write-Host ''
Write-Host 'Gemini key saved permanently for this NUNES main-server Windows user.' -ForegroundColor Green
Write-Host ('Settings : ' + $settingsPath)
Write-Host ('Secret   : ' + $secretPath + '  [Windows DPAPI encrypted]')
Write-Host 'The key is NOT written into the Git project or GitHub.' -ForegroundColor Cyan
