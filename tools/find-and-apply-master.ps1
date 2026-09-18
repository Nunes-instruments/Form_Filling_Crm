param(
  [Parameter(Mandatory=$true)][string]$PatchRoot
)

$ErrorActionPreference = 'Stop'
$expectedHttps = 'https://github.com/Nunes-instruments/Form_Filling_Crm.git'
$expectedHttpsNoGit = 'https://github.com/Nunes-instruments/Form_Filling_Crm'
$expectedSsh = 'git@github.com:Nunes-instruments/Form_Filling_Crm.git'

function Normalize-Path([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  try { return (Resolve-Path -LiteralPath $p -ErrorAction Stop).ProviderPath } catch { return $null }
}

function Is-ExpectedRemote([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return $false }
  $u = $url.Trim().TrimEnd('/')
  return ($u -ieq $expectedHttps.TrimEnd('/')) -or
         ($u -ieq $expectedHttpsNoGit.TrimEnd('/')) -or
         ($u -ieq $expectedSsh.TrimEnd('/'))
}

function Test-MasterRepo([string]$dir) {
  if ([string]::IsNullOrWhiteSpace($dir)) { return $false }
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return $false }
  $gitMarker = Join-Path $dir '.git'
  if (-not (Test-Path -LiteralPath $gitMarker)) { return $false }
  try {
    $oldPref=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    $names=@(& git -C $dir remote 2>&1 | ForEach-Object { [string]$_ })
    $namesRc=$LASTEXITCODE
    if($namesRc -ne 0 -or -not (@($names | ForEach-Object {$_.Trim()}) -contains 'origin')){ $ErrorActionPreference=$oldPref; return $false }
    $remoteLines=@(& git -C $dir remote get-url origin 2>&1 | ForEach-Object { [string]$_ })
    $remoteRc=$LASTEXITCODE
    $ErrorActionPreference=$oldPref
    if ($remoteRc -ne 0) { return $false }
    $remote=([string]($remoteLines | Select-Object -First 1)).Trim()
    return (Is-ExpectedRemote $remote)
  } catch { return $false }
}

function Add-Candidate([System.Collections.Generic.List[string]]$list,[string]$path) {
  $p = Normalize-Path $path
  if ($p -and -not $list.Contains($p)) { [void]$list.Add($p) }
}

$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) { throw 'Git for Windows is not installed or not in PATH.' }

$PatchRoot = Normalize-Path $PatchRoot
if (-not $PatchRoot) { throw 'Patch folder path could not be resolved.' }

# If this patch has already been copied into the real master folder, use it immediately.
if (Test-MasterRepo $PatchRoot) {
  $master = $PatchRoot
} else {
  $roots = New-Object 'System.Collections.Generic.List[string]'
  Add-Candidate $roots $env:NUNES_MASTER_ROOT
  Add-Candidate $roots (Split-Path -Parent $PatchRoot)
  Add-Candidate $roots ([Environment]::GetFolderPath('Desktop'))
  Add-Candidate $roots ([Environment]::GetFolderPath('MyDocuments'))
  Add-Candidate $roots (Join-Path $env:USERPROFILE 'Desktop')
  Add-Candidate $roots (Join-Path $env:USERPROFILE 'Documents')
  Add-Candidate $roots 'C:\NUNES'

  $matches = New-Object 'System.Collections.Generic.List[string]'
  foreach ($base in $roots) {
    if (-not (Test-Path -LiteralPath $base -PathType Container)) { continue }

    if (Test-MasterRepo $base) { if (-not $matches.Contains($base)) { [void]$matches.Add($base) } }

    # Search only a few folder levels so this remains fast and safe.
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($base,0))
    while ($queue.Count -gt 0) {
      $item = $queue.Dequeue()
      $dir = [string]$item[0]
      $depth = [int]$item[1]
      if ($depth -ge 3) { continue }
      try {
        $children = Get-ChildItem -LiteralPath $dir -Directory -Force -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -notin @('.git','node_modules','AppData','$Recycle.Bin','System Volume Information') }
      } catch { $children = @() }
      foreach ($child in $children) {
        $cp = $child.FullName
        if (Test-MasterRepo $cp) {
          if (-not $matches.Contains($cp)) { [void]$matches.Add($cp) }
        }
        $queue.Enqueue(@($cp,$depth+1))
      }
    }
  }

  if ($matches.Count -eq 0) {
    throw @'
Could not find the existing NUNES Git master folder for:
https://github.com/Nunes-instruments/Form_Filling_Crm.git

Do NOT run git init inside this patch folder.
Open your existing NUNES master folder (the one you previously pushed to GitHub) and copy this patch into that folder, or set NUNES_MASTER_ROOT to that folder and run again.
'@
  }

  if ($matches.Count -gt 1) {
    Write-Host ''
    Write-Host 'More than one Form_Filling_Crm working copy was found:' -ForegroundColor Yellow
    for ($i=0; $i -lt $matches.Count; $i++) { Write-Host ('  [{0}] {1}' -f ($i+1),$matches[$i]) }
    Write-Host ''
    $answer = Read-Host 'Enter the number of the MAIN SERVER master folder'
    $n = 0
    if (-not [int]::TryParse($answer,[ref]$n) -or $n -lt 1 -or $n -gt $matches.Count) {
      throw 'No valid master folder was selected.'
    }
    $master = $matches[$n-1]
  } else {
    $master = $matches[0]
  }
}

Write-Host ''
Write-Host ('[FOUND] NUNES master folder: ' + $master) -ForegroundColor Green

# Safety: verify the remote one more time before copying anything.
$oldPref=$ErrorActionPreference
try {
  $ErrorActionPreference='Continue'
  $originLines=@(& git -C $master remote get-url origin 2>&1 | ForEach-Object { [string]$_ })
  $originRc=$LASTEXITCODE
} finally { $ErrorActionPreference=$oldPref }
$origin=if($originRc -eq 0){([string]($originLines | Select-Object -First 1)).Trim()}else{''}
if (-not (Is-ExpectedRemote $origin)) {
  throw ('Unexpected Git origin in selected folder: ' + $origin)
}

# Copy only the auto-update control files. Never touch .git, data, secrets, databases or runtime folders.
$files = @(
  'I_ENABLE_GITHUB_AUTO_UPDATE.bat',
  'J_PUBLISH_LIVE_AND_GITHUB.bat',
  'CHECK_GITHUB_AUTO_UPDATE.bat'
)
foreach ($rel in $files) {
  $src = Join-Path $PatchRoot $rel
  if (Test-Path -LiteralPath $src -PathType Leaf) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $master $rel) -Force
  }
}

$targetTools = Join-Path $master 'tools'
New-Item -ItemType Directory -Force -Path $targetTools | Out-Null
foreach ($rel in @('github-auto-watcher.ps1','install-github-auto-update.ps1')) {
  $src = Join-Path (Join-Path $PatchRoot 'tools') $rel
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw ('Patch file missing: ' + $src) }
  Copy-Item -LiteralPath $src -Destination (Join-Path $targetTools $rel) -Force
}

# Register the watcher against the REAL Git master folder.
$installer = Join-Path $targetTools 'install-github-auto-update.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Root $master
if ($LASTEXITCODE -ne 0) { throw 'GitHub auto update registration failed.' }

$stateRoot = Join-Path $env:LOCALAPPDATA 'NUNES Operations'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
Set-Content -LiteralPath (Join-Path $stateRoot 'master-root.txt') -Value $master -Encoding UTF8

Write-Host ''
Write-Host '[OK] ONE-TIME AUTO UPDATE SETUP COMPLETE.' -ForegroundColor Green
Write-Host ('Master folder : ' + $master)
Write-Host ('GitHub repo   : ' + $expectedHttps)
Write-Host 'Staff/Owner   : no update files required'
Write-Host ''
