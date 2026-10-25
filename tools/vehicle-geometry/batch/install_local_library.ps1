param(
    [Parameter(Mandatory=$true)][string]$GeneratedLibrary,
    [Parameter(Mandatory=$true)][string]$GameRoot,
    [switch]$Force
)
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($GeneratedLibrary).TrimEnd('\')
$game=[IO.Path]::GetFullPath($GameRoot).TrimEnd('\')
$manifest=Join-Path $source '_vh8-batch-manifest.json'
if(!(Test-Path -LiteralPath $manifest -PathType Leaf)){throw 'Missing private batch manifest.'}
if(!(Test-Path -LiteralPath $game -PathType Container)){throw 'Missing GTA root.'}
$data=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
if($data.schemaVersion -ne 'vh8.local-vehicle-batch.v1'){throw 'Wrong manifest version.'}
$destination=Join-Path $game 'Plugins\LSA\VehicleGeometry'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$installed=0;$skipped=0
foreach($entry in $data.results){
    $name=[string]$entry.model
    if($entry.status -ne 'ok' -or $name -cnotmatch '^[a-z][a-z0-9_]{0,31}$'){$skipped++;continue}
    $json=Join-Path $source ($name+'.json')
    $png=Join-Path $source ($name+'-shaded.png')
    if(!(Test-Path -LiteralPath $json -PathType Leaf) -or
       !(Test-Path -LiteralPath $png -PathType Leaf)){$skipped++;continue}
    $obj=Get-Content -LiteralPath $json -Raw | ConvertFrom-Json
    if($obj.schemaVersion -ne 'vh6.vehicle-geometry.v1' -or $obj.model -ine $name -or
       (Get-Item $json).Length -gt 262144 -or (Get-Item $png).Length -gt 4194304) {
        $skipped++;continue
    }
    if(-not $Force -and ((Test-Path (Join-Path $destination ($name+'.json'))) -or
                        (Test-Path (Join-Path $destination ($name+'-shaded.png'))))) {
        Write-Host "SKIP existing: $name";$skipped++;continue
    }
    Copy-Item -LiteralPath $json -Destination $destination -Force
    Copy-Item -LiteralPath $png -Destination $destination -Force
    $installed++
}
Write-Host "VH8_LOCAL_INSTALL: $installed installed; $skipped skipped."
Write-Host "GTA location: $destination"
Write-Host 'Restart the LSA plugin to load new vehicle models.'
