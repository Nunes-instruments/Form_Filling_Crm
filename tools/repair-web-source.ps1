$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cssPath = Join-Path $root 'platform_web\src\app\globals.css'
if (-not (Test-Path $cssPath)) { throw "globals.css not found: $cssPath" }

$text = [IO.File]::ReadAllText($cssPath, [Text.Encoding]::UTF8)
$changed = $false

# Repair the exact malformed pattern that caused V6.4.3 PostCSS "Unknown word":
# a whole CSS block accidentally stored with literal backslash+n characters.
$needle = '\n\n/* =========================================================\n'
$idx = $text.IndexOf($needle, [StringComparison]::Ordinal)
if ($idx -ge 0) {
    $endNeedle = '\n.live-pill.offline'
    $end = $text.IndexOf($endNeedle, $idx, [StringComparison]::Ordinal)
    if ($end -gt $idx) {
        $segment = $text.Substring($idx, $end - $idx)
        $segment = $segment.Replace('\n', [Environment]::NewLine)
        $text = $text.Substring(0, $idx) + $segment + $text.Substring($end)
        $changed = $true
    }
}

# A literal backslash+n before a CSS comment/rule at top level is invalid CSS.
if ($text -match '(?m)^\\n') {
    throw 'globals.css still contains a literal \\n token at the beginning of a CSS line. Source validation stopped before npm build.'
}

if ($changed) {
    [IO.File]::WriteAllText($cssPath, $text, (New-Object Text.UTF8Encoding($false)))
    Write-Host '[WEB SOURCE] Repaired malformed escaped newlines in globals.css.' -ForegroundColor Yellow
} else {
    Write-Host '[WEB SOURCE] globals.css source check OK.' -ForegroundColor Green
}
