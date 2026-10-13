#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GamePath,
  [switch]$IsolatedProfile,
  [switch]$ExistingInstallation
)
$ErrorActionPreference = 'Stop'
if ([bool]$IsolatedProfile -eq [bool]$ExistingInstallation) {
  throw 'Specify exactly one deployment mode: -IsolatedProfile OR -ExistingInstallation.'
}
# Existing-install mode does not uninstall or back up LSA. Move legacy
# binaries/bridges off-game and verify your private data backup first.
$profileMode = if ($ExistingInstallation) { 'existing' } else { 'isolated' }
$game = [System.IO.Path]::GetFullPath($GamePath)
if (-not (Test-Path -LiteralPath (Join-Path $game 'GTA5_Enhanced.exe') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $game 'RAGEPluginHook.exe') -PathType Leaf)) {
  throw 'Target must contain GTA V Enhanced and RAGE Plugin Hook.'
}
if (Get-Process -Name 'GTA5_Enhanced','RAGEPluginHook' -ErrorAction SilentlyContinue) {
  throw 'Exit GTA/RPH before touching plugin files.'
}
& (Join-Path $PSScriptRoot 'Assert-LegacyLSAStopped.ps1') -GamePath $game
$manifestFolder = Join-Path $game '.LSAStandaloneSmoke'
if (Test-Path -LiteralPath $manifestFolder) { throw 'Existing standalone install manifest; run rollback first.' }
$package = Join-Path $PSScriptRoot 'payload'
$items = @(
  @{ src='LSA.Standalone.RageHost.dll'; dest='Plugins/LSA.Standalone.RageHost.dll' },
  @{ src='LSA.Standalone.Core.dll'; dest='Plugins/LSA.Standalone/LSA.Standalone.Core.dll' },
  @{ src='LSA.Standalone.enabled'; dest='Plugins/LSA.Standalone.enabled' }
)
# Strict create-only policy: the rollback deletes ONLY manifest-owned files.
foreach ($item in $items) {
  if (-not (Test-Path -LiteralPath (Join-Path $package $item.src) -PathType Leaf)) {
    throw "Package incomplete: $($item.src)"
  }
  if (Test-Path -LiteralPath (Join-Path $game $item.dest)) {
    throw "Will not overwrite any existing file: $($item.dest)"
  }
}
$written = [System.Collections.Generic.List[string]]::new()
try {
  foreach ($item in $items) {
    $target = Join-Path $game $item.dest
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $package $item.src) -Destination $target -ErrorAction Stop
    $written.Add($target)
  }
  $files = foreach ($item in $items) {
    $target = Join-Path $game $item.dest
    @{ relative=$item.dest; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash }
  }
  New-Item -ItemType Directory -Path $manifestFolder | Out-Null
  $m = @{ version=1; kind='standalone-gta-smoke-create-only'; profileMode=$profileMode; files=@($files) }
  $m | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $manifestFolder 'manifest.json') -Encoding UTF8
  Write-Host "Standalone DLLs and marker installed in $profileMode profile; no legacy files changed."
  Write-Host 'To restore clean state run Undo-Standalone.ps1 -GamePath <same path>.'
} catch {
  foreach ($target in $written) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $manifestFolder -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
