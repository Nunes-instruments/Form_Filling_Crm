param(
  [Parameter(Mandatory=$true)][string]$Url,
  [int]$TimeoutMilliseconds=12000,
  [string]$Product='',
  [string]$Version=''
)
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
$deadline=[DateTime]::UtcNow.AddMilliseconds([Math]::Max(500,$TimeoutMilliseconds))
$handler=New-Object System.Net.Http.HttpClientHandler
$client=New-Object System.Net.Http.HttpClient($handler)
$client.Timeout=[TimeSpan]::FromMilliseconds(650)
try {
  do {
    try {
      $text=$client.GetStringAsync($Url).GetAwaiter().GetResult()
      if($text){
        $ok=$true
        if($Product -or $Version){
          try{$j=$text|ConvertFrom-Json}catch{$j=$null}
          if($Product -and ([string]$j.product -ne $Product) -and ([string]$j.app -ne $Product)){$ok=$false}
          if($Version -and [string]$j.version -ne $Version){$ok=$false}
        }
        if($ok){Write-Output 'YES'; exit 0}
      }
    } catch {}
    Start-Sleep -Milliseconds 140
  } while([DateTime]::UtcNow -lt $deadline)
} finally { $client.Dispose(); $handler.Dispose() }
Write-Output 'NO'; exit 1
