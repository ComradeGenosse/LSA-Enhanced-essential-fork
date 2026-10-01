$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-plan.json') -Raw | ConvertFrom-Json
$expectedGta = 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'
$gta = [IO.Path]::GetFullPath($plan.gta)
if ($gta -ne $expectedGta -or -not (Test-Path -LiteralPath (Join-Path $gta 'GTA5_Enhanced.exe'))) { throw 'Unexpected GTA target' }
$stage = (Resolve-Path -LiteralPath $plan.stage).Path
$backup = [IO.Path]::GetFullPath($plan.backup)
$deploymentRoot = [IO.Path]::GetFullPath($PSScriptRoot) + '\'
if (-not $stage.StartsWith($deploymentRoot, [StringComparison]::OrdinalIgnoreCase) -or -not $backup.StartsWith($deploymentRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected workspace paths' }
if (Test-Path -LiteralPath $backup) { throw 'Backup already exists; refusing to overwrite' }
if (Get-Process | Where-Object { $_.ProcessName -match '^(GTA5|GTA5_Enhanced|GTA5_Enhanced_BE|RAGEPluginHook)$' }) { throw 'Close GTA and RAGEPluginHook before installation' }
$serverPrefix = (Join-Path $gta 'plugins\LosSantosAliveServer') + '\'
if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($serverPrefix, [StringComparison]::OrdinalIgnoreCase) }) { throw 'Existing LSA server is running' }
function Target([string]$relative) {
  $resolved = [IO.Path]::GetFullPath((Join-Path $gta $relative))
  if (-not $resolved.StartsWith($gta + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes GTA root' }
  return $resolved
}
function TreeCopy([string]$source, [string]$destination) {
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  & robocopy $source $destination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Backup copy failed: $LASTEXITCODE" }
}
New-Item -ItemType Directory -Path $backup | Out-Null
$inventory = @()
$absence = @()
foreach ($relative in $plan.roots) {
  $source = Target $relative
  if (-not (Test-Path -LiteralPath $source)) { $absence += $relative; continue }
  $item = Get-Item -LiteralPath $source -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation path refused' }
  $destination = Join-Path $backup $relative
  if ($item.PSIsContainer) {
    if (Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint) { throw 'Linked installation files refused' }
    TreeCopy $source $destination
    $sourceFiles = @(Get-ChildItem -LiteralPath $source -Recurse -Force -File)
  } else {
    New-Item -ItemType Directory -Path ([IO.Directory]::GetParent($destination).FullName) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
    $sourceFiles = @($item)
  }
  foreach ($file in $sourceFiles) {
    $fileRelative = $file.FullName.Substring($gta.Length + 1)
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    $saved = Join-Path $backup $fileRelative
    if ((Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash -ne $hash) { throw 'Backup content mismatch' }
    $inventory += [PSCustomObject]@{ relative = $fileRelative; bytes = $file.Length; sha256 = $hash; lastWriteTimeUtc = $file.LastWriteTimeUtc.ToString('o'); attributes = [int]$file.Attributes }
  }
}
@{ version = 1; originalInstallation = 'old/custom LSA 2.1'; gta = $gta; roots = $plan.roots; absent = $absence; files = $inventory; verified = $true } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backup 'rollback-manifest.json') -Encoding utf8
Write-Output "Verified rollback backup: $($inventory.Count) files at $backup"
# Recheck the original files before the first mutation.
foreach ($file in $inventory) {
  if ((Get-FileHash -LiteralPath (Target $file.relative) -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Installation changed during backup; deployment aborted' }
}
function ClearOwnedRoot([string]$relative) {
  $targetPath = Target $relative
  # Only these explicitly named, backed-up version-owned roots can be removed.
  if ($relative -notin $plan.roots) { throw 'Unapproved removal target' }
  if (Test-Path -LiteralPath $targetPath) { Remove-Item -LiteralPath $targetPath -Recurse -Force }
}
try {
  foreach ($relative in @('plugins/LosSantosAliveServer', 'plugins/NPCGeminiFiles', 'plugins/LosSantosAlive')) { ClearOwnedRoot $relative }
  foreach ($file in $plan.stagedFiles) {
    $destination = Target $file.relative
    New-Item -ItemType Directory -Path ([IO.Directory]::GetParent($destination).FullName) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $stage $file.relative) -Destination $destination -Force
  }
  foreach ($file in $plan.stagedFiles) {
    $destination = Target $file.relative
    if ($file.sha256 -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $file.sha256) { throw "Installed content mismatch: $($file.relative)" }
    if (-not $file.sha256 -and [IO.File]::ReadAllText($destination) -cne [IO.File]::ReadAllText((Join-Path $stage $file.relative))) { throw 'Credential file copy mismatch' }
  }
  $expectedServerCount = @($plan.stagedFiles | Where-Object { $_.relative.StartsWith('plugins/LosSantosAliveServer/') }).Count
  $actualServerCount = @(Get-ChildItem -LiteralPath (Target 'plugins/LosSantosAliveServer') -File -Recurse -Force).Count
  if ($expectedServerCount -ne $actualServerCount -or (Test-Path -LiteralPath (Target 'plugins/NPCGeminiFiles'))) { throw 'Mixed version layout detected' }
  @{ status = 'installed-file-verified'; backup = $backup; gta = $gta; fileCount = $plan.stagedFiles.Count; backupFileCount = $inventory.Count; gtaLaunched = $false; apiCalls = 0 } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'deployment-receipt.json') -Encoding utf8
  Write-Output "E1.1 installed and all $($plan.stagedFiles.Count) staged files verified. GTA was not launched."
} catch {
  $failure = $_
  foreach ($relative in $plan.roots) { ClearOwnedRoot $relative }
  foreach ($relative in $plan.roots) {
    $saved = Join-Path $backup $relative
    if (-not (Test-Path -LiteralPath $saved)) { continue }
    $destination = Target $relative
    if ((Get-Item -LiteralPath $saved).PSIsContainer) { TreeCopy $saved $destination }
    else {
      New-Item -ItemType Directory -Path ([IO.Directory]::GetParent($destination).FullName) -Force | Out-Null
      Copy-Item -LiteralPath $saved -Destination $destination -Force
    }
  }
  throw "Deployment failed; old installation restored from verified backup. $($failure.Exception.Message)"
}
