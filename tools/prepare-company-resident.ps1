param(
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).ProviderPath
$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
$residentDir = Join-Path $stateRoot 'CompanyResident'
New-Item -ItemType Directory -Force -Path $residentDir | Out-Null

# Connect persistent Purchasing data once during setup. Daily startup must never scan/migrate it.
$purchasePrep = Join-Path $Root 'tools\prepare-purchasing-data.ps1'
if (-not (Test-Path -LiteralPath $purchasePrep -PathType Leaf)) { throw 'Purchasing data preparation script is missing.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $purchasePrep -WorkspaceRoot $Root -CurrentData (Join-Path $Root 'apps\order_forms\data') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Persistent Purchasing data could not be prepared.' }

# Resolve Node ONCE and keep the exact executable path in the resident config.
$nodeOut = Join-Path $env:TEMP ('nunes_company_node_' + [Guid]::NewGuid().ToString('N') + '.txt')
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\bootstrap-node.ps1') -OutputFile $nodeOut
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nodeOut)) { throw 'Node.js could not be prepared.' }
  $nodeDir = (Get-Content -LiteralPath $nodeOut -Raw).Trim()
} finally { Remove-Item -LiteralPath $nodeOut -Force -ErrorAction SilentlyContinue }
$nodeExe = Join-Path $nodeDir 'node.exe'
$npmCmd = Join-Path $nodeDir 'npm.cmd'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw 'Prepared Node executable is missing.' }
if (-not (Test-Path -LiteralPath $npmCmd -PathType Leaf)) { throw 'Prepared npm executable is missing.' }

# Resolve Python ONCE. platform/server.py uses only the Python standard library.
$pyOut = Join-Path $env:TEMP ('nunes_company_python_' + [Guid]::NewGuid().ToString('N') + '.txt')
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\bootstrap-python.ps1') -OutputFile $pyOut
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pyOut)) { throw 'Python could not be prepared.' }
  $pythonExe = (Get-Content -LiteralPath $pyOut -Raw).Trim()
} finally { Remove-Item -LiteralPath $pyOut -Force -ErrorAction SilentlyContinue }
if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) { throw 'Prepared Python executable is missing.' }

# Prepare the dashboard runtime/build ONCE during owner setup. Daily startup never hashes/builds.
$repair = Join-Path $Root 'tools\repair-web-source.ps1'
if (Test-Path -LiteralPath $repair -PathType Leaf) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $repair | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Dashboard source verification failed.' }
}
$prepareWeb = Join-Path $Root 'tools\prepare-platform-web.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $prepareWeb -Root $Root -NpmCmd $npmCmd | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Dashboard production runtime/build could not be prepared.' }

$dashboardServer = Join-Path $Root 'platform_web\.next\standalone\server.js'
if (-not (Test-Path -LiteralPath $dashboardServer -PathType Leaf)) { throw 'Dashboard standalone server.js is missing after preparation.' }
$dataServer = Join-Path $Root 'platform\server.py'
if (-not (Test-Path -LiteralPath $dataServer -PathType Leaf)) { throw 'NUNES data API server.py is missing.' }

# Install the tiny local launcher so normal login/open does not need to run the heavy startup BAT.
$sourceLauncher = Join-Path $Root 'tools\start-company-resident.ps1'
if (-not (Test-Path -LiteralPath $sourceLauncher -PathType Leaf)) { throw 'Company resident launcher is missing.' }
Copy-Item -LiteralPath $sourceLauncher -Destination (Join-Path $residentDir 'start-company-resident.ps1') -Force

$config = [ordered]@{
  root = $Root
  nodeExe = $nodeExe
  pythonExe = $pythonExe
  dashboardServer = $dashboardServer
  dataServer = $dataServer
  dashboardPort = 8795
  apiPort = 8865
  preparedAt = [DateTime]::UtcNow.ToString('o')
}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $residentDir 'company-resident.json') -Encoding UTF8

# Start immediately so setup finishes with the company dashboard already hot.
& powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File (Join-Path $residentDir 'start-company-resident.ps1')
if ($LASTEXITCODE -ne 0) { throw ('Company resident could not start (exit {0}).' -f $LASTEXITCODE) }
exit 0
