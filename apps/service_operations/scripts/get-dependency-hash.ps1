param(
  [Parameter(Mandatory=$true)][string]$PackageJson
)
$ErrorActionPreference = 'Stop'

function Ordered-Object($obj) {
  $ordered = [ordered]@{}
  if ($null -eq $obj) { return $ordered }
  $obj.PSObject.Properties.Name | Sort-Object | ForEach-Object {
    $ordered[$_] = [string]$obj.$_
  }
  return $ordered
}

$pkg = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
$payload = [ordered]@{
  engines = Ordered-Object $pkg.engines
  dependencies = Ordered-Object $pkg.dependencies
  devDependencies = Ordered-Object $pkg.devDependencies
}
$json = $payload | ConvertTo-Json -Depth 10 -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes($json)
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $hash = $sha.ComputeHash($bytes)
  ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
} finally {
  $sha.Dispose()
}
