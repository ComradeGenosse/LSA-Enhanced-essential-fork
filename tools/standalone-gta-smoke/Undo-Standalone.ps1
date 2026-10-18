#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$GamePath)
$ErrorActionPreference = 'Stop'
$game = [System.IO.Path]::GetFullPath($GamePath)
if (Get-Process -Name 'GTA5_Enhanced','RAGEPluginHook' -ErrorAction SilentlyContinue) {
  throw 'Exit GTA/RPH before rollback.'
}
$folder = Join-Path $game '.LSAStandaloneSmoke'
$manifestPath = Join-Path $folder 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw 'No standalone deployment manifest. Refusing unmanaged deletion.'
}
$m = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$allowed = @(
  'Plugins/LSA.Standalone.RageHost.dll',
  'Plugins/LSA.Standalone/LSA.Standalone.Core.dll',
  'Plugins/LSA.Standalone.enabled'
)
if ($m.version -ne 1 -or $m.kind -ne 'standalone-gta-smoke-create-only' -or
    @($m.files).Count -ne $allowed.Count) { throw 'Invalid rollback manifest.' }
$seen = @{}
foreach ($item in $m.files) {
  if ($allowed -cnotcontains $item.relative -or $seen.ContainsKey($item.relative) -or
      $item.sha256 -notmatch '^[0-9A-Fa-f]{64}$') {
    throw 'Rollback manifest outside managed set.'
  }
  $seen[$item.relative] = $true
  $target = Join-Path $game $item.relative
  if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or
      (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash -ne $item.sha256) {
    throw "Managed file changed or missing; refusing partial rollback: $($item.relative)"
  }
}
# A crashed launcher may leave its temporary native settings behind.
# Validate the explicitly managed filename before removing any DLLs.
$nativeActivation = Join-Path $folder 'native-activation.json'
$knownMetadata = @('manifest.json', 'native-activation.json')
$unexpected = @(Get-ChildItem -LiteralPath $folder -Force |
  Where-Object { $knownMetadata -cnotcontains $_.Name })
if ($unexpected.Count -gt 0) {
  throw 'Unexpected files in standalone deployment metadata; refusing partial rollback.'
}
if (Test-Path -LiteralPath $nativeActivation) {
  $activation = Get-Content -LiteralPath $nativeActivation -Raw | ConvertFrom-Json
  if ($activation.kind -cne 'lsa-standalone-native-activation' -or
      $activation.version -ne 1 -or
      $activation.stage -notin @('host','probe','typed','tts','audio','lipsync','streaming') -or
      $null -eq $activation.settings -or
      $null -eq $activation.ownerPid) {
    throw 'Unrecognized activation file; refusing partial rollback.'
  }
}
foreach ($item in $m.files) {
  Remove-Item -LiteralPath (Join-Path $game $item.relative) -Force
}
if (Test-Path -LiteralPath $nativeActivation) {
  Remove-Item -LiteralPath $nativeActivation -Force
}
$directory = Join-Path $game 'Plugins/LSA.Standalone'
if (Test-Path -LiteralPath $directory -PathType Container) {
  if (@(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) {
    Remove-Item -LiteralPath $directory
  }
}
Remove-Item -LiteralPath $manifestPath -Force
Remove-Item -LiteralPath $folder
Write-Host 'Rollback complete: only this package''s three managed files were removed.'
