# Bundle only the latest E0 unattended-suite manifest and its referenced probe evidence.
# No config, unrelated GTA logs, screenshots or arbitrary files are included.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$GameRoot,
  [string]$OutputDirectory = ""
)
$ErrorActionPreference = "Stop"
$results = Join-Path $GameRoot "Plugins\LSA.WPS.Lab.Results"
if (-not (Test-Path -LiteralPath $results -PathType Container)) { throw "E0 result directory not found: $results" }
$latest = Get-ChildItem -LiteralPath $results -Filter "*-pre-shot-*.suite.json" -File |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $latest) { throw "No pre-shot suite manifest found; run WPSE0Auto or enable autoRunPreShot first." }
$manifest = Get-Content -LiteralPath $latest.FullName -Raw | ConvertFrom-Json
if ($manifest.type -ne "E0_pre_shot_unattended") { throw "Unexpected manifest type" }
$paths = @($latest.FullName)
foreach ($result in @($manifest.results)) {
  foreach ($field in @("log", "summary")) {
    $name = [string]$result.$field
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    if ([System.IO.Path]::GetFileName($name) -ne $name) { throw "Unsafe file name in manifest" }
    $path = Join-Path $results $name
    if (Test-Path -LiteralPath $path -PathType Leaf) { $paths += $path }
    else { Write-Warning "Referenced evidence missing: $name" }
  }
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = $env:USERPROFILE }
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw "Output folder missing: $OutputDirectory" }
$zip = Join-Path $OutputDirectory ("WPS-E0-pre-shot-" + $manifest.run + ".zip")
Compress-Archive -LiteralPath ($paths | Select-Object -Unique) -DestinationPath $zip -Force
Write-Output "E0 suite state: $($manifest.state)"
Write-Output "Evidence files: $($paths.Count)"
Write-Output "Upload this ZIP: $zip"
