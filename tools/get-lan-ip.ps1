$ErrorActionPreference = 'SilentlyContinue'

# Prefer the physical adapter used by Windows' active default route. This
# avoids showing VPN, Tailscale, VirtualBox, Hyper-V or disconnected addresses.
$routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
  Where-Object { $_.State -eq 'Alive' } |
  Sort-Object RouteMetric, InterfaceMetric

foreach ($route in $routes) {
  $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex
  if (-not $adapter -or $adapter.Status -ne 'Up') { continue }
  if ($adapter.InterfaceDescription -match 'Virtual|VPN|Tailscale|ZeroTier|Loopback|Hyper-V|VMware') { continue }
  $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex |
    Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) { $ip; exit 0 }
}

$ip = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -ne '127.0.0.1' -and
    $_.IPAddress -notlike '169.254*' -and
    ($_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
  } |
  Sort-Object InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress

if ($ip) { $ip } else { 'SERVER-PC-IP' }
