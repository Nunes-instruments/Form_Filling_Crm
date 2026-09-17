param(
  [Parameter(Mandatory=$true)][string]$AppDir
)
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path

$items = New-Object System.Collections.Generic.List[string]
$src = Join-Path $AppDir 'src'
if (Test-Path -LiteralPath $src) {
  Get-ChildItem -LiteralPath $src -File -Recurse | Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($AppDir.Length).TrimStart([char]'\',[char]'/') -replace '\\','/'
    $fh = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $items.Add("$rel|$fh")
  }
}
foreach ($name in @('next.config.mjs','tsconfig.json')) {
  $p = Join-Path $AppDir $name
  if (Test-Path -LiteralPath $p) {
    $fh = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
    $items.Add("$name|$fh")
  }
}
$joined = [string]::Join("`n", $items)
$bytes = [Text.Encoding]::UTF8.GetBytes($joined)
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $hash = $sha.ComputeHash($bytes)
  ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
} finally {
  $sha.Dispose()
}
