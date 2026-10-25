param(
    [Parameter(Mandatory=$true)][string]$GeometryJson,
    [Parameter(Mandatory=$true)][string]$GameRoot,
    [string]$Model='buffalo',
    [switch]$Force
)
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($GeometryJson)
$game=[IO.Path]::GetFullPath($GameRoot).TrimEnd('\')
if(-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing locally generated geometry file: $source"
}
if(-not (Test-Path -LiteralPath $game -PathType Container)) {
    throw "GTA installation folder not found: $game"
}
if($Model -notmatch '^[A-Za-z0-9_]{1,32}$') {
    throw "Invalid vehicle model identifier"
}
if((Get-Item -LiteralPath $source).Length -gt 262144) {
    throw "Geometry JSON exceeds runtime safety limit of 256 KiB"
}
$parsed=Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
if($parsed.schemaVersion -ne 'vh6.vehicle-geometry.v1' -or
   $parsed.model -ine $Model -or
   $parsed.coordinateSystem.gtaFront -ne '+Y' -or
   $parsed.contour.vertices.Count -lt 6 -or
   $parsed.wheels.lf -eq $null -or $parsed.wheels.rf -eq $null -or
   $parsed.wheels.lr -eq $null -or $parsed.wheels.rr -eq $null) {
    throw "Not a valid VH6 vehicle geometry payload for $Model"
}
$directory=Join-Path $game 'Plugins\LSA\VehicleGeometry'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$destination=Join-Path $directory ($Model.ToLowerInvariant()+'.json')
if((Test-Path -LiteralPath $destination) -and -not $Force) {
    throw "Existing local geometry found. Use -Force only if you intend to replace $destination"
}
# The source file remains private and stays in its existing research directory.
# This copies ONLY the compact 2D derived payload, never a source GLB/YFT/RPF.
Copy-Item -LiteralPath $source -Destination $destination -Force:$Force
Write-Output "VH6_LOCAL_INSTALLED: $destination"
Write-Output "Start the current LSA build, drive the vehicle, open F11 -> Vehicle Diagnostics."
Write-Output "Expect: EXTRACTED $Model ... points. No GTA archive was modified."
