param(
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference='Stop'
$received=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39)
if([string]::IsNullOrWhiteSpace($received)){ throw 'NUNES master folder path is empty.' }
$Root=(Resolve-Path -LiteralPath $received -ErrorAction Stop).ProviderPath.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
$required=@(
  'tools\\apply-main-server-update.ps1',
  'platform_web\\package.json',
  'apps\\service_operations\\package.json',
  'apps\\order_forms\\app.py'
)
$missing=New-Object System.Collections.Generic.List[string]
foreach($rel in $required){
  if(-not (Test-Path -LiteralPath (Join-Path $Root $rel) -PathType Leaf)){ $missing.Add($rel) }
}
if($missing.Count -gt 0){
  Write-Host '[BLOCKED] This is not the complete NUNES product folder.' -ForegroundColor Red
  Write-Host 'Do NOT initialize/publish Git from this folder.' -ForegroundColor Red
  Write-Host 'Missing full-source file(s):' -ForegroundColor Yellow
  foreach($m in $missing){ Write-Host ('  - ' + $m) -ForegroundColor Yellow }
  Write-Host ''
  Write-Host 'Use the FULL V6.5.9 folder as the permanent master folder.' -ForegroundColor Yellow
  exit 12
}
Write-Host '[OK] Complete NUNES product source detected.' -ForegroundColor Green
exit 0
