param(
  [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference='SilentlyContinue'
try {
  $Root=(Resolve-Path -LiteralPath $Root).ProviderPath
  $bat=Join-Path $Root 'NUNES_SERVER_WATCHDOG.bat'
  if(-not (Test-Path -LiteralPath $bat -PathType Leaf)){exit 1}
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName=$env:ComSpec
  $psi.Arguments=('/d /s /c ""{0}""' -f $bat)
  $psi.WorkingDirectory=$Root
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden
  $p=[System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  exit $p.ExitCode
} catch { exit 1 }
