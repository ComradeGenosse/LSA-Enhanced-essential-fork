param([Parameter(Mandatory)][string]$GameRoot,[Parameter(Mandatory)][string]$Destination,[string]$RunId)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$status=Get-Content (Join-Path $GameRoot 'WpsBreachLab/status.json') -Raw | ConvertFrom-Json
if($status.version -notlike 'X7-*'){throw 'Expected X7 runtime'}
if($RunId){
 if($RunId -notmatch '^\d{8}-\d{6}-[0-9a-f]{6}$'){throw 'Invalid run id'}
 $status.runId=$RunId
}
$source=Join-Path $GameRoot ('WpsBreachLab/'+$status.runId+'/trials.jsonl')
$out=Join-Path $Destination ($status.runId+'.jsonl')
$published=foreach($line in Get-Content $source){
 $row=$line | ConvertFrom-Json
 if($row.kind -in 'site_candidate','site'){continue}
 foreach($k in @('pid','stack','pos')){$row.PSObject.Properties.Remove($k)}
 if($row.kind -eq 'anchor_baseline' -and @($row.offset | Where-Object {[Math]::Abs($_) -gt 10}).Count -gt 0){
    $row.offset=$null;$row | Add-Member NoteProperty offsetOutsideAuthoredBounds $true
 }
 $row | ConvertTo-Json -Compress -Depth 20
}
[IO.File]::WriteAllLines($out,$published,[Text.UTF8Encoding]::new($false))
Get-FileHash $out
