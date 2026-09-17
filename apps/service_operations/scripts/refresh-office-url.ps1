param(
  [Parameter(Mandatory=$true)][string]$AppDir,
  [int]$Port = 5055
)
$ErrorActionPreference = 'SilentlyContinue'
$local = "http://127.0.0.1:$Port"
$lines = @("Local PC: $local")
$x = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' } |
  Sort-Object InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress
if ($x) { $lines += "Office LAN: http://$x`:$Port" }
Set-Content -LiteralPath (Join-Path $AppDir 'OFFICE_URL.txt') -Value $lines -Encoding ASCII
