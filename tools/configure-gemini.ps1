param(
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = 'Stop'

function Convert-SecureToPlain([Security.SecureString]$secure) {
  if ($null -eq $secure) { return '' }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$envFile = Join-Path $Root 'apps\service_operations\.env.local'
$defaultKey = ''
if (Test-Path $envFile) {
  foreach ($line in Get-Content -Path $envFile) {
    if ($line -match '^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$') {
      $defaultKey = $Matches[1].Trim()
      break
    }
  }
}

Write-Host ''
if ($defaultKey) {
  $tail = if ($defaultKey.Length -ge 4) { $defaultKey.Substring($defaultKey.Length - 4) } else { '****' }
  Write-Host ("Default Gemini key is already included in this build (ends with {0})." -f $tail) -ForegroundColor Green
  Write-Host 'Press ENTER to keep/use the included default key, or paste a replacement key.'
} else {
  Write-Host 'No default key is present. Paste a Gemini API key.' -ForegroundColor Yellow
}

$secure = Read-Host 'Gemini API key' -AsSecureString
$entered = Convert-SecureToPlain $secure
$key = if ([string]::IsNullOrWhiteSpace($entered)) { $defaultKey } else { $entered.Trim() }
if ([string]::IsNullOrWhiteSpace($key)) { throw 'No Gemini API key is available.' }

$dataDir = Join-Path $env:LOCALAPPDATA 'NUNES Operations\ServiceData'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$settingsPath = Join-Path $dataDir 'settings.json'

$obj = $null
if (Test-Path $settingsPath) {
  try { $obj = Get-Content -Path $settingsPath -Raw | ConvertFrom-Json }
  catch { $obj = [pscustomobject]@{} }
}
if ($null -eq $obj) { $obj = [pscustomobject]@{} }

$obj | Add-Member -NotePropertyName geminiApiKey -NotePropertyValue $key -Force
$obj | Add-Member -NotePropertyName formVisionEnabled -NotePropertyValue $true -Force
$savedModel = if ($obj.PSObject.Properties.Name -contains 'formVisionModel') { [string]$obj.formVisionModel } else { '' }
if ([string]::IsNullOrWhiteSpace($savedModel) -or $savedModel -eq 'gemini-2.5-flash') {
  $obj | Add-Member -NotePropertyName formVisionModel -NotePropertyValue 'gemini-3.6-flash' -Force
} elseif ($savedModel -eq 'gemini-2.5-flash-lite') {
  $obj | Add-Member -NotePropertyName formVisionModel -NotePropertyValue 'gemini-3.5-flash-lite' -Force
}
foreach ($name in @('groqApiKey','formVlmEnabled','formVlmModel')) {
  if ($obj.PSObject.Properties.Name -contains $name) { $obj.PSObject.Properties.Remove($name) }
}

$obj | ConvertTo-Json -Depth 20 | Set-Content -Path $settingsPath -Encoding UTF8
$tail = if ($key.Length -ge 4) { $key.Substring($key.Length - 4) } else { '****' }
Write-Host ''
Write-Host ("Gemini form reader configured successfully (key ends with {0})." -f $tail) -ForegroundColor Green
Write-Host ("Saved in: {0}" -f $settingsPath)
Write-Host 'You can replace this key later from Servicing > Settings or by running CONFIGURE_GEMINI.bat again.'
