param(
  [string]$Version='6.5.0',
  [int]$TimeoutMilliseconds=300,
  [int]$WaitMilliseconds=0
)
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
$handler=New-Object System.Net.Http.HttpClientHandler
$client=New-Object System.Net.Http.HttpClient($handler)
$client.Timeout=[TimeSpan]::FromMilliseconds([Math]::Max(120,$TimeoutMilliseconds))
$deadline=[DateTime]::UtcNow.AddMilliseconds([Math]::Max(0,$WaitMilliseconds))
try{
  do {
    foreach($p in 8795){
      try{
        $text=$client.GetStringAsync("http://127.0.0.1:$p/api/health").GetAwaiter().GetResult()
        $j=$text|ConvertFrom-Json
        if($j.ok -eq $true -and [string]$j.product -eq 'NUNES Company Platform' -and [string]$j.version -eq $Version){Write-Output $p; exit 0}
      }catch{}
    }
    if($WaitMilliseconds -le 0){break}
    Start-Sleep -Milliseconds 180
  } while([DateTime]::UtcNow -lt $deadline)
}finally{$client.Dispose();$handler.Dispose()}
exit 1
