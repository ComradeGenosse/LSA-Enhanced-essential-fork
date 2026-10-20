param([Parameter(Mandatory)][string]$GameRoot,[Parameter(Mandatory)][string]$Destination,[string]$RunId)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$status=Get-Content (Join-Path $GameRoot 'WpsBreachLab/status.json') -Raw | ConvertFrom-Json
if($status.version -notlike 'X2-*'){throw 'Expected X2 runtime'}
if($RunId){if($RunId -notmatch '^\d{8}-\d{6}-[0-9a-f]{6}$'){throw 'Invalid run id'};$status.runId=$RunId}
$source=Join-Path $GameRoot ('WpsBreachLab/'+$status.runId+'/trials.jsonl')
$out=Join-Path $Destination ($status.runId+'.jsonl')
$published=foreach($line in Get-Content $source){$row=$line | ConvertFrom-Json
 # Keep public measurements, remove absolute stack paths, process ids, and private site coordinates.
 if($row.kind -in 'site_candidate','site') {continue}
 $row.PSObject.Properties.Remove('pid');$row.PSObject.Properties.Remove('stack');$row.PSObject.Properties.Remove('pos')
 $row | ConvertTo-Json -Compress -Depth 20
}
[IO.File]::WriteAllLines($out,$published,[Text.UTF8Encoding]::new($false))
if(-not $RunId){$status.PSObject.Properties.Remove('pid');$status | ConvertTo-Json | Set-Content (Join-Path $Destination ($status.runId+'-status.json'))}
Get-FileHash $out



