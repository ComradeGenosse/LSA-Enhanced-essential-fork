# Read-only preflight: never moves, deletes, enables or disables plugins.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$GameRoot
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $GameRoot).Path
$plugins = Join-Path $root 'Plugins'
$violations = New-Object System.Collections.Generic.List[string]
if (-not (Test-Path (Join-Path $root 'GTA5_Enhanced.exe') -PathType Leaf)) {
    $violations.Add('wrong_game_root')
}
if (-not (Test-Path (Join-Path $plugins 'LSA.Standalone.enabled') -PathType Leaf)) {
    $violations.Add('standalone_mode_not_enabled')
}
if (-not (Test-Path (Join-Path $plugins 'LSA.Standalone.RageHost.dll') -PathType Leaf)) {
    $violations.Add('standalone_host_not_installed')
}
if (-not (Test-Path (Join-Path $plugins 'LSA.Standalone.Core.dll') -PathType Leaf) -and
    -not (Test-Path (Join-Path $plugins 'LSA.Standalone\LSA.Standalone.Core.dll') -PathType Leaf)) {
    $violations.Add('standalone_core_not_installed')
}
# Never depend on filename-only guards for universal runtime exclusion;
# this is a conservative prelaunch check of known stock/LSA payloads.
$paths = @(
    (Join-Path $plugins 'LosSantosAlive.dll'),
    (Join-Path $root 'LosSantosAlive.dll'),
    (Join-Path $plugins 'LSA.PromotedCharacters.dll'),
    (Join-Path $plugins 'LSA.PromotedCharacters'),
    (Join-Path $plugins 'LSA.PromotedCharacters.json'),
    (Join-Path $plugins 'LSA.SessionIdentity.dll'),
    (Join-Path $plugins 'LSA.Intelligence.dll')
)
foreach ($p in $paths) {
    if (Test-Path -LiteralPath $p) { $violations.Add('essential_payload_detected') }
}
# Search only typical LSA/Essential paths, avoiding broad personal-data scans.
if (Test-Path $plugins -PathType Container) {
    foreach ($item in (Get-ChildItem -LiteralPath $plugins -Force | Where-Object {
        $_.Name -match '(?i)^(LosSantosAlive|LSA\.PromotedCharacters|LSA\.SessionIdentity|LSA\.Intelligence)'
    })) { $violations.Add('essential_plugin_detected') }
}
if ($violations.Count -gt 0) {
    $violations | Sort-Object -Unique | ForEach-Object { Write-Output "FAIL $_" }
    exit 2
}
Write-Output 'PASS standalone_profile_preflight'
Write-Output 'NOTE: Confirm RPH enabled-plugin list and no renamed/sideloaded Essential binary before GTA activation.'
exit 0
