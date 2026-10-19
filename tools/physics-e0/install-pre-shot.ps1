# Run on the user's Windows PC. Installs only the isolated E0 lab and private sample JSON.
# Never uploads GTA files, launches GTA/RPH, or modifies base game archives.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$GameRoot,
    [Parameter(Mandatory=$true)][string]$ArtifactDirectory,
    [Parameter(Mandatory=$true)][string]$PrivateSamples
)
$ErrorActionPreference = 'Stop'
$GameRoot = (Resolve-Path -LiteralPath $GameRoot).Path
$ArtifactDirectory = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$PrivateSamples = (Resolve-Path -LiteralPath $PrivateSamples).Path
if (-not (Test-Path -LiteralPath (Join-Path $GameRoot 'GTA5_Enhanced.exe') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $GameRoot 'RAGEPluginHook.exe') -PathType Leaf)) {
    throw 'GameRoot must be the GTA V Enhanced installation with RPH.'
}
if (Get-Process -Name 'GTA5_Enhanced' -ErrorAction SilentlyContinue) {
    throw 'Exit GTA completely before replacing the lab plugin/configuration.'
}
$dll = Join-Path $ArtifactDirectory 'LSA.WPS.Lab.dll'
$receiptPath = Join-Path $ArtifactDirectory 'BUILD-RECEIPT.json'
$examplePath = Join-Path $ArtifactDirectory 'LSA.WPS.Lab.example.json'
foreach ($p in @($dll,$receiptPath,$examplePath)) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "Missing build artifact: $p" }
}
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
$dllSha = (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()
if ($dllSha -ne ([string]$receipt.pluginSha256).ToLowerInvariant()) {
    throw 'Official lab DLL hash disagrees with BUILD-RECEIPT.json; refusing deployment.'
}
if ((Get-Item -LiteralPath $PrivateSamples).Length -gt 65536) { throw 'Private sample JSON is oversized.' }
$sample = Get-Content -LiteralPath $PrivateSamples -Raw | ConvertFrom-Json
if ($sample.schemaVersion -ne 1 -or
    @($sample.surfaces).Count -ne 30 -or @($sample.walls).Count -ne 10) {
    throw 'Expected separate schemaVersion 1 arrays of exactly 30 surfaces and 10 walls.'
}
foreach ($item in @($sample.surfaces)+@($sample.walls)) {
    if (-not $item.label -or -not $item.expectedMaterial) { throw 'Sample missing label/material.' }
    foreach ($field in @('ax','ay','az','bx','by','bz')) {
        $v = [double]($item.$field)
        if ([double]::IsNaN($v) -or [double]::IsInfinity($v) -or [math]::Abs($v) -gt 8000) {
            throw "Invalid sample coordinate: $field"
        }
    }
}
$plugins = Join-Path $GameRoot 'Plugins'
if (-not (Test-Path -LiteralPath $plugins)) {
    New-Item -ItemType Directory -Path $plugins -Force | Out-Null
}
$dstDll = Join-Path $plugins 'LSA.WPS.Lab.dll'
$dstConfig = Join-Path $plugins 'LSA.WPS.Lab.json'
$dstSamples = Join-Path $plugins 'LSA.WPS.Lab.samples.json'
$existing = if (Test-Path -LiteralPath $dstConfig) { $dstConfig } else { $examplePath }
$cfg = Get-Content -LiteralPath $existing -Raw | ConvertFrom-Json
function SetOption($name, $value) {
    if ($null -eq $cfg.PSObject.Properties[$name]) {
        $cfg | Add-Member -MemberType NoteProperty -Name $name -Value $value
    } else { $cfg.$name = $value }
}
SetOption 'enabled' $true
SetOption 'autoRunPreShot' $true
SetOption 'autoTeleportForSamples' $true
foreach ($name in @('permitExplosion','permitBullet','permitIpl','permitHide','permitTimeScale')) {
    SetOption $name $false
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($p in @($dstDll,$dstConfig,$dstSamples)) {
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination ($p+'.backup-'+$stamp) -Force }
}
Copy-Item -LiteralPath $dll -Destination $dstDll -Force
Copy-Item -LiteralPath $PrivateSamples -Destination $dstSamples -Force
$cfg | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $dstConfig -Encoding UTF8
$actual = (Get-FileHash -LiteralPath $dstDll -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $dllSha) { throw 'DLL post-install hash check failed.' }
Write-Output 'E0 private pre-shot lab installed and verified.'
Write-Output 'Automatic safe E0.0-E0.3 and automatic location positioning enabled.'
Write-Output 'All destructive experiment permits are disabled.'
Write-Output 'Start GTA with your NORMAL working RPH launch method; the existing ReloadAllPlugins command should load this DLL.'
Write-Output "Config: $dstConfig"
Write-Output "Samples: $dstSamples"
Write-Output "DLL SHA256: $actual"
Write-Output 'Afterward, use pack-pre-shot.ps1 from this artifact directory to package ONLY the result logs.'
