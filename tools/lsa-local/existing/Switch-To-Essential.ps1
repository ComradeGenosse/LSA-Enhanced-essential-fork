#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$GamePath,
  [string]$BackupPath,
  [string]$PackagePath = $PSScriptRoot
)
# Shared functions live here so the switcher consists of just two scripts.
# Dot-sourcing defines helpers only; it never changes an installation.
$ErrorActionPreference = 'Stop'

function Get-SwitchHash([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
function Assert-SwitchPlainPath([string]$Path) {
  $p = [IO.Path]::GetFullPath($Path)
  while ($p) {
    if (Test-Path -LiteralPath $p) {
      if ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reparse points are not supported: $p"
      }
    }
    $p = Split-Path -Parent $p
  }
}
function Get-SwitchProof([string]$Path) {
  Assert-SwitchPlainPath $Path
  $root = Get-Item -LiteralPath $Path -Force
  $result = @()
  if (-not $root.PSIsContainer) { return ('file:' + (Get-SwitchHash $Path)) }
  $result += 'directory:'
  foreach ($item in @(Get-ChildItem -LiteralPath $Path -Force -Recurse | Sort-Object FullName)) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point: $($item.FullName)" }
    $relative = $item.FullName.Substring($root.FullName.Length + 1).Replace('\','/')
    if ($item.PSIsContainer) { $result += "directory:$relative" }
    else { $result += "file:$relative`:$(Get-SwitchHash $item.FullName)" }
  }
  return ($result -join "`n")
}
function Assert-SwitchStopped([string]$Game, [string]$Package) {
  if (Get-Process -Name GTA5,GTA5_Enhanced,GTA5_Enhanced_BE,RAGEPluginHook -ErrorAction SilentlyContinue) {
    throw 'Exit GTA/RPH before switching.'
  }
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)) {
    if ([string]::IsNullOrWhiteSpace([string]$p.CommandLine)) {
      throw 'Cannot inspect a Node process. Stop it or run with permission to inspect it before switching.'
    }
    $command = [string]$p.CommandLine
    # Codex's computer-use runtime also launches ./server.mjs. Exclude that
    # known runtime only from the ambiguous relative-script heuristic; explicit
    # GTA/package/LSA references still block it like any other Node executable.
    $codexRuntime = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node'
    $isCodexRuntime = ([string]$p.ExecutablePath).StartsWith($codexRuntime + '\', [StringComparison]::OrdinalIgnoreCase)
    $relativeServer = $command -match '(?i)(?:^|[\s"''])(?:\.[\\/])?(?:service\.mjs|server\.(?:mjs|js))(?=[\s"'']|$)'
    if ($command.IndexOf($Game, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        ($Package.Length -gt 0 -and $command.IndexOf($Package, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
        ([string]$p.ExecutablePath).IndexOf($Game, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $command -match '(?i)LosSantosAlive|lsa[-.]standalone' -or
        ($relativeServer -and -not $isCodexRuntime)) {
      throw 'Stop the relevant LSA/standalone Node companion/server before switching.'
    }
  }
}
function Assert-SwitchStandaloneSet([string]$Game, [bool]$AllowManaged) {
  $dlls=@(Get-ChildItem -LiteralPath $Game -Filter '*.dll' -File -Force)
  $plugins=Join-Path $Game 'Plugins'
  if (Test-Path -LiteralPath $plugins) { $dlls+=@(Get-ChildItem -LiteralPath $plugins -Filter '*.dll' -File -Recurse -Force) }
  foreach ($dll in $dlls) {
    Assert-SwitchPlainPath $dll.FullName
    try { $identity=[Reflection.AssemblyName]::GetAssemblyName($dll.FullName).Name }
    catch [BadImageFormatException] { continue }
    catch [IO.FileLoadException] { continue }
    if ($identity -match '^LSA\.Standalone($|\.)') {
      $relative=$dll.FullName.Substring($Game.Length+1).Replace('\','/')
      if (-not $AllowManaged -or $relative -notin @('Plugins/LSA.Standalone.RageHost.dll','Plugins/LSA.Standalone/LSA.Standalone.Core.dll')) {
        throw "Unmanaged standalone assembly remains: $relative. Refusing to mix controllers."
      }
    }
  }
}
function Save-SwitchState($State, [string]$Backup) {
  $path = Join-Path $Backup 'switch-state.json'
  $temp = Join-Path $Backup 'switch-state.tmp'
  Assert-SwitchPlainPath $path
  Assert-SwitchPlainPath $temp
  [IO.File]::WriteAllText($temp, ($State | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $path) { [IO.File]::Replace($temp, $path, [System.Management.Automation.Language.NullString]::Value) }
  else { [IO.File]::Move($temp, $path) }
}
function Get-SwitchContext([string]$Game, [string]$Backup, [string]$Package) {
  if (-not $Game) { throw '-GamePath is required.' }
  $Game = [IO.Path]::GetFullPath($Game).TrimEnd('\','/')
  $Package = [IO.Path]::GetFullPath($Package).TrimEnd('\','/')
  if (-not $Backup) { $Backup = $Game + '-LSA-Switch-Backup' }
  $Backup = [IO.Path]::GetFullPath($Backup).TrimEnd('\','/')
  if ($Backup -eq $Game -or $Backup.StartsWith($Game + '\', [StringComparison]::OrdinalIgnoreCase) -or
      $Game.StartsWith($Backup + '\', [StringComparison]::OrdinalIgnoreCase) -or
      $Package -eq $Game -or $Package.StartsWith($Game + '\', [StringComparison]::OrdinalIgnoreCase) -or
      $Package -eq $Backup -or $Package.StartsWith($Backup + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package and backup must be outside GTA, and backup must not contain GTA or the package.'
  }
  foreach ($p in @($Game,$Backup,$Package)) { Assert-SwitchPlainPath $p }
  foreach ($name in @('GTA5_Enhanced.exe','RAGEPluginHook.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Game $name) -PathType Leaf)) { throw "Missing $name" }
  }
  foreach ($name in @('Install-Standalone.ps1','Undo-Standalone.ps1','Assert-LegacyLSAStopped.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Package $name) -PathType Leaf)) { throw "Missing package script: $name" }
  }
  Assert-SwitchStopped $Game $Package
  # Inspect both RPH files before creating a backup or changing any game file.
  foreach ($name in @('RagePluginHook.ini','startup.rphs')) {
    $path = Join-Path $Game $name
    Assert-SwitchPlainPath $path
    if (Test-Path -LiteralPath $path) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Not a file: $path" }
      $null = [IO.File]::ReadAllText($path)
    }
  }
  return @{ Game=$Game; Backup=$Backup; Package=$Package }
}
function Read-SwitchState($Context) {
  $path = Join-Path $Context.Backup 'switch-state.json'
  Assert-SwitchPlainPath $path
  $s = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ($s.version -ne 1 -or $s.kind -cne 'lsa-test-switch' -or $s.game -ne $Context.Game -or
      $s.phase -notin @('switching','standalone','restoring','essential')) { throw 'Backup belongs to another installation or is invalid.' }
  $seen = @{}
  foreach ($item in @($s.items)) {
    $r = [string]$item.relative
    if (-not $r -or [IO.Path]::IsPathRooted($r) -or $r -match '(^|[\\/])\.\.?([\\/]|$)|:' -or $seen.ContainsKey($r)) {
      throw 'Invalid controller backup path.'
    }
    # Only root DLLs or objects under Plugins are eligible; never a server/data tree.
    if ($r -notmatch '(?i)^(?:[^\\/]+\.dll|Plugins/[\w .\-/]+)$' -or
        $r -match '(?i)LosSantosAliveServer|^Plugins/(?:LosSantosAlive|NPCGeminiFiles)(?:/|$)') {
      throw 'Backup path outside the controller set.'
    }
    $seen[$r] = $true
    Assert-SwitchPlainPath (Join-Path $Context.Game $r)
    Assert-SwitchPlainPath (Join-Path (Join-Path $Context.Backup 'controllers') $r)
  }
  if (@($s.config).Count -ne 2 -or @($s.config | Where-Object relative -eq 'RagePluginHook.ini').Count -ne 1 -or
      @($s.config | Where-Object relative -eq 'startup.rphs').Count -ne 1) { throw 'Invalid RPH backup.' }
  foreach ($c in $s.config) {
    if ($c.existed) {
      $sha=[Security.Cryptography.SHA256]::Create()
      try { $hash=([BitConverter]::ToString($sha.ComputeHash([Convert]::FromBase64String($c.bytes)))).Replace('-','') }
      finally { $sha.Dispose() }
      if ($hash -ne $c.originalHash) { throw 'Saved RPH configuration checksum mismatch.' }
    }
  }
  return $s
}
function Assert-SwitchConfig($State, [string]$Game) {
  foreach ($c in $State.config) {
    $path = Join-Path $Game $c.relative
    $exists = Test-Path -LiteralPath $path -PathType Leaf
    $hash = if ($exists) { Get-SwitchHash $path } else { '' }
    $original = if ($c.existed) { [string]$c.originalHash } else { '' }
    if ($hash -ne $original -and ($c.relative -ne 'startup.rphs' -or $hash -ne $State.startupHash)) {
      throw "RPH configuration changed outside the switcher: $($c.relative). Preserve/reconcile that edit before retrying."
    }
  }
}
function Restore-SwitchEssential($Context, $State) {
  Assert-SwitchStopped $Context.Game $Context.Package
  Assert-SwitchConfig $State $Context.Game
  Assert-SwitchStandaloneSet $Context.Game $true
  # Validate the entire restore before removing standalone or moving any controller.
  foreach ($item in @($State.items)) {
    $live = Join-Path $Context.Game $item.relative
    $parked = Join-Path (Join-Path $Context.Backup 'controllers') $item.relative
    $inGame = Test-Path -LiteralPath $live
    $inBackup = Test-Path -LiteralPath $parked
    if ($inGame -eq $inBackup) { throw "Expected exactly one copy: $($item.relative). No overwrite attempted." }
    $source = if ($inBackup) { $parked } else { $live }
    if ((Get-SwitchProof $source) -cne $item.proof) { throw "Controller hash/tree changed: $($item.relative)" }
  }
  $State.phase = 'restoring'; Save-SwitchState $State $Context.Backup
  $metadata = Join-Path $Context.Game '.LSAStandaloneSmoke'
  Assert-SwitchPlainPath $metadata
  foreach ($r in @('Plugins/LSA.Standalone.RageHost.dll','Plugins/LSA.Standalone/LSA.Standalone.Core.dll','Plugins/LSA.Standalone.enabled')) {
    Assert-SwitchPlainPath (Join-Path $Context.Game $r)
  }
  if (Test-Path -LiteralPath $metadata) {
    & (Join-Path $Context.Package 'Undo-Standalone.ps1') -GamePath $Context.Game
  }
  # An interrupted installer without its manifest must never be guessed away.
  foreach ($r in @('Plugins/LSA.Standalone.RageHost.dll','Plugins/LSA.Standalone/LSA.Standalone.Core.dll','Plugins/LSA.Standalone.enabled')) {
    if (Test-Path -LiteralPath (Join-Path $Context.Game $r)) { throw "Unmanaged standalone file remains: $r. Essential has not been restored." }
  }
  foreach ($item in @($State.items)) {
    $live = Join-Path $Context.Game $item.relative
    $parked = Join-Path (Join-Path $Context.Backup 'controllers') $item.relative
    if (Test-Path -LiteralPath $parked) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $live) -Force | Out-Null
      Move-Item -LiteralPath $parked -Destination $live
    }
    if ((Get-SwitchProof $live) -cne $item.proof) { throw "Restored controller verification failed: $($item.relative)" }
  }
  foreach ($c in $State.config) {
    $path = Join-Path $Context.Game $c.relative
    if ($c.existed) {
      [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($c.bytes))
      if ((Get-SwitchHash $path) -ne $c.originalHash) { throw 'RPH restore verification failed.' }
    } elseif (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
  }
  $State.phase = 'essential'; Save-SwitchState $State $Context.Backup
  Write-Host 'Essential restored; original controllers and RPH configuration verified. No game launched.'
}

if ($MyInvocation.InvocationName -ne '.') {
  $context = Get-SwitchContext $GamePath $BackupPath $PackagePath
  if (-not (Test-Path -LiteralPath (Join-Path $context.Backup 'switch-state.json'))) { throw 'No switcher backup found.' }
  Assert-SwitchPlainPath (Join-Path $context.Backup '.switch.lock')
  $lock = [IO.File]::Open((Join-Path $context.Backup '.switch.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  try { Restore-SwitchEssential $context (Read-SwitchState $context) }
  finally { $lock.Dispose() }
}
