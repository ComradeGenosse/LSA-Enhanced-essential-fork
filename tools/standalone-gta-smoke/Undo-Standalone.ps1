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
foreach ($item in $m.files) {
  Remove-Item -LiteralPath (Join-Path $game $item.relative) -Force
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
