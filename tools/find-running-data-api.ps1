param([string]$Version='6.5.0',[int]$TimeoutMilliseconds=250)
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
$handler=New-Object System.Net.Http.HttpClientHandler
$client=New-Object System.Net.Http.HttpClient($handler)
$client.Timeout=[TimeSpan]::FromMilliseconds([Math]::Max(150,$TimeoutMilliseconds))
try{
  foreach($p in 8865,8866,8867,8868,8869,8870,8871,8872,8873,8874,8875){
    try{
      $text=$client.GetStringAsync("http://127.0.0.1:$p/api/health").GetAwaiter().GetResult()
      $j=$text|ConvertFrom-Json
      if($j.ok -eq $true -and [string]$j.product -eq 'NUNES Company Data API'){Write-Output $p; exit 0}
    }catch{}
  }
}finally{$client.Dispose();$handler.Dispose()}
exit 1
