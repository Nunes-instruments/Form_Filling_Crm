param(
  [Parameter(Mandatory=$true)][string]$Root,
  [switch]$ClientOnly
)
$ErrorActionPreference='Stop'
$received=[Environment]::ExpandEnvironmentVariables([string]$Root).Trim().Trim([char]34).Trim([char]39).Trim()
if ([string]::IsNullOrWhiteSpace($received)) { throw 'NUNES folder path is empty.' }
$resolved=(Resolve-Path -LiteralPath $received -ErrorAction Stop).ProviderPath

$sourceLauncher=Join-Path $resolved 'tools\open-nunes-desktop.ps1'
if (-not (Test-Path -LiteralPath $sourceLauncher)) { throw "Desktop launcher is missing: $sourceLauncher" }

# Keep the desktop launcher itself in a stable LocalAppData location. The user can
# replace/extract a newer ZIP without Windows retaining a stale shortcut to an old BAT.
$stateDir=Join-Path $env:LOCALAPPDATA 'NUNES Operations'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$stableLauncher=Join-Path $stateDir 'open-nunes-desktop.ps1'
$rootFile=Join-Path $stateDir 'workspace-root.txt'
Copy-Item -LiteralPath $sourceLauncher -Destination $stableLauncher -Force
Set-Content -LiteralPath $rootFile -Value $resolved -Encoding UTF8

$desktop=[Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Windows Desktop folder could not be resolved.' }
$linkPath=Join-Path $desktop 'NUNES Operations.lnk'
$powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell)) { $powershell='powershell.exe' }
$wscript=Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscript)) { $wscript='wscript.exe' }

# Run the normal PowerShell launcher through WScript with window style 0. This keeps
# daily owner/staff opening completely silent: no black console flash. Real failures
# are still written to desktop-launcher.log and shown as a small Windows message box.
$stableVbs=Join-Path $stateDir 'open-nunes-desktop.vbs'
$psForVbs=$powershell.Replace('"','""')
$launcherForVbs=$stableLauncher.Replace('"','""')
$logForVbs=(Join-Path $stateDir 'desktop-launcher.log').Replace('"','""')
$vbs=@"
Option Explicit
Dim sh, rc, cmd
Set sh = CreateObject("WScript.Shell")
cmd = "$psForVbs -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$launcherForVbs"""
rc = sh.Run(cmd, 0, True)
If rc <> 0 Then
  MsgBox "NUNES Operations could not open. Details are saved in:" & vbCrLf & "$logForVbs", 48, "NUNES Operations"
End If
"@
Set-Content -LiteralPath $stableVbs -Value $vbs -Encoding ASCII

$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($linkPath)
$shortcut.TargetPath=$wscript
$shortcut.Arguments=('"{0}"' -f $stableVbs)
$shortcut.WorkingDirectory=$resolved
$shortcut.WindowStyle=7
try { $shortcut.IconLocation=(Join-Path $env:SystemRoot 'System32\shell32.dll') + ',137' } catch {}
$shortcut.Description='Open NUNES Operations dashboard silently'
$shortcut.Save()

if (-not (Test-Path -LiteralPath $linkPath)) { throw 'NUNES Operations desktop shortcut was not created.' }
Write-Host "Desktop shortcut ready: $linkPath" -ForegroundColor Green
