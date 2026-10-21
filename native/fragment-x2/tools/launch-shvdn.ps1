param([Parameter(Mandatory)][string]$GameRoot,[int]$TimeoutSeconds=300)
# SHVDN adaptation of Claude's GT4 restart: use the X1 Steam path without RPH.
$ErrorActionPreference='Stop'
$script=Join-Path $GameRoot 'scripts/WpsBreachLab.3.cs'
$sha=(Get-FileHash $script).Hash.ToLowerInvariant()
$start=[DateTime]::UtcNow
$launchAttempts=1
Start-Process 'steam://rungameid/3240220' -WindowStyle Hidden
while(([DateTime]::UtcNow-$start).TotalSeconds -lt $TimeoutSeconds){
 $path=Join-Path $GameRoot 'WpsBreachLab/status.json'
 if(Test-Path $path){try{$h=Get-Content $path -Raw | ConvertFrom-Json;if($h.scriptSha256 -eq $sha -and [DateTime]$h.loadedUtc -gt $start){$h | ConvertTo-Json;exit 0}}catch{}}
 # Steam can discard a request while its previous app session is still shutting down.
 # Retry only once, only when neither game nor Rockstar launch process exists.
 if($launchAttempts -eq 1 -and ([DateTime]::UtcNow-$start).TotalSeconds -gt 30 -and -not(Get-Process GTA5_Enhanced,PlayGTAV,Launcher -ErrorAction SilentlyContinue)){
  Start-Process 'steam://rungameid/3240220' -WindowStyle Hidden
  $launchAttempts++
 }
 Start-Sleep -Seconds 2
}
throw 'No fresh loaded SHVDN hash within timeout; inspect game window/log before retrying.'
