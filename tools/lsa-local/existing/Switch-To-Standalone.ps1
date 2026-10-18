#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GamePath,
  [string]$BackupPath,
  [string]$PackagePath = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
# Capture arguments: dot-sourcing the other script also binds its parameters.
$requested = @{ GamePath=$GamePath; BackupPath=$BackupPath; PackagePath=$PackagePath }
. (Join-Path $PSScriptRoot 'Switch-To-Essential.ps1')
$context = Get-SwitchContext $requested.GamePath $requested.BackupPath $requested.PackagePath
$game = $context.Game; $backup = $context.Backup; $package = $context.Package
foreach ($name in @('LSA.Standalone.RageHost.dll','LSA.Standalone.Core.dll','LSA.Standalone.enabled')) {
  if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $package 'payload') $name) -PathType Leaf)) { throw "Package payload missing: $name" }
}
if (Test-Path -LiteralPath $backup) {
  if (-not (Test-Path -LiteralPath (Join-Path $backup 'switch-state.json')) -and
      @(Get-ChildItem -LiteralPath $backup -Force | Where-Object Name -ne '.switch.lock').Count) {
    throw 'Backup folder already exists without switcher state. Choose an empty new path.'
  }
} else { New-Item -ItemType Directory -Path $backup | Out-Null }
Assert-SwitchPlainPath (Join-Path $backup '.switch.lock')
$lock = [IO.File]::Open((Join-Path $backup '.switch.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
  $statePath = Join-Path $backup 'switch-state.json'
  if (Test-Path -LiteralPath $statePath) {
    $previous = Read-SwitchState $context
    if ($previous.phase -ne 'essential') {
      throw 'Standalone or an interrupted switch is recorded. Run Switch-To-Essential.ps1 first; do not launch GTA during recovery.'
    }
    Assert-SwitchConfig $previous $game
    foreach ($item in @($previous.items)) {
      if (Test-Path -LiteralPath (Join-Path (Join-Path $backup 'controllers') $item.relative)) { throw 'Controller backup is not empty after restore.' }
    }
  }
  foreach ($r in @('.LSAStandaloneSmoke','Plugins/LSA.Standalone.RageHost.dll','Plugins/LSA.Standalone','Plugins/LSA.Standalone.enabled')) {
    if (Test-Path -LiteralPath (Join-Path $game $r)) { throw "Standalone already present or unmanaged: $r" }
  }
  Assert-SwitchStandaloneSet $game $false
  # Take the known conflict list from the existing preflight, not a second drifting list.
  $tokens=$null; $errors=$null
  $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $package 'Assert-LegacyLSAStopped.ps1'),[ref]$tokens,[ref]$errors)
  $assignment = @($ast.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$blocked'},$true))
  if (@($errors).Count -or $assignment.Count -ne 1) { throw 'Cannot read existing standalone conflict list.' }
  $blocked = @($assignment[0].Right.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst]},$true) | ForEach-Object Value)
  if ($blocked.Count -lt 10) { throw 'Unexpected standalone conflict list.' }
  $roots = @($blocked | Where-Object { Test-Path -LiteralPath (Join-Path $game $_) })
  $dlls = @(Get-ChildItem -LiteralPath $game -Filter '*.dll' -File -Force)
  $pluginFolder = Join-Path $game 'Plugins'
  if (Test-Path -LiteralPath $pluginFolder) {
    Assert-SwitchPlainPath $pluginFolder
    # Do not follow junctions into data or other installations.
    foreach ($d in @(Get-ChildItem -LiteralPath $pluginFolder -Directory -Recurse -Force)) {
      if ($d.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Plugin junction/symlink is unsupported: $($d.FullName)" }
    }
    $dlls += @(Get-ChildItem -LiteralPath $pluginFolder -Filter '*.dll' -File -Recurse -Force)
  }
  foreach ($dll in $dlls) {
    Assert-SwitchPlainPath $dll.FullName
    try { $identity = [Reflection.AssemblyName]::GetAssemblyName($dll.FullName).Name }
    catch [BadImageFormatException] { continue }
    catch [IO.FileLoadException] { continue }
    if ($identity -match '^(LosSantosAlive($|\.)|LSA\.PromotedCharacters($|\.)|LSA\.SessionIdentity$|LSA\.Intelligence$)') {
      $roots += $dll.FullName.Substring($game.Length + 1).Replace('\','/')
    }
  }
  $roots = @($roots | Sort-Object -Unique)
  $roots = @($roots | Where-Object { $candidate=$_; -not @($roots | Where-Object { $candidate.StartsWith($_ + '/', [StringComparison]::OrdinalIgnoreCase) }).Count })
  $items = @(foreach ($r in $roots) {
    if ($r -match '(?i)LosSantosAliveServer|^Plugins/(?:LosSantosAlive|NPCGeminiFiles)(?:/|$)') {
      throw "Preflight detects a controller inside a protected data/server folder: $r. Refusing to move user data."
    }
    $parked = Join-Path (Join-Path $backup 'controllers') $r
    if (Test-Path -LiteralPath $parked) { throw "Will not overwrite backup: $r" }
    [pscustomobject]@{relative=$r; proof=(Get-SwitchProof (Join-Path $game $r))}
  })
  $config = @(foreach ($r in @('RagePluginHook.ini','startup.rphs')) {
    $p=Join-Path $game $r; $existed=Test-Path -LiteralPath $p -PathType Leaf
    [pscustomobject]@{relative=$r; existed=$existed; originalHash=$(if($existed){Get-SwitchHash $p}else{''}); bytes=$(if($existed){[Convert]::ToBase64String([IO.File]::ReadAllBytes($p))}else{''})}
  })
  # Preserve unrelated commands/explicit loads. Expand load-all commands into
  # explicit unrelated root plugins, then load standalone exactly once here.
  # GUI autoload selections stay unchanged: parked assemblies cannot load.
  $startup = Join-Path $game 'startup.rphs'
  $lines = if (Test-Path -LiteralPath $startup) { @([IO.File]::ReadAllLines($startup)) } else { @() }
  $outputLines = New-Object 'System.Collections.Generic.List[string]'
  $loads = @{}
  $unrelated = @($dlls | Where-Object {
    $r=$_.FullName.Substring($game.Length+1).Replace('\','/')
    $r -match '^Plugins/[^/]+\.dll$' -and $roots -notcontains $r
  })
  foreach ($line in $lines) {
    $trim=$line.Trim()
    if ($trim -match '^(?i)(ReloadAllPlugins|LoadAllPlugins)\s*$') {
      foreach ($dll in $unrelated) {
        if (-not $loads.ContainsKey($dll.Name)) { $outputLines.Add('LoadPlugin "' + $dll.Name + '"'); $loads[$dll.Name]=$true }
      }
    } elseif ($trim -match '^(?i)LoadPlugin\s+"?([^"\r\n]+?)"?\s*$') {
      $name=$Matches[1]
      # Only local explicit plugin names are supported; external paths could
      # load a parked controller and nested command scripts hide load behavior.
      if ($name -match '[\\/:*?;]' -or $name -notmatch '\.dll$') { throw "Unsupported startup LoadPlugin path/command: $name" }
      $matching = @($roots | Where-Object { [IO.Path]::GetFileName($_) -eq $name })
      if ($matching.Count -eq 0 -and $name -ne 'LSA.Standalone.RageHost.dll') { $outputLines.Add($line); $loads[$name]=$true }
    } elseif ($trim -match '^(?i)(?://|#|;|$)') { $outputLines.Add($line) }
    elseif ($trim -match '(?i)load.*plugin|exec|\.rphs|LosSantosAlive|LSA\.') {
      throw "Unsupported startup loader command; no game files changed: $trim"
    } else { $outputLines.Add($line) }
  }
  $outputLines.Add('LoadPlugin "LSA.Standalone.RageHost.dll"')
  $startupBytes = [Text.Encoding]::UTF8.GetBytes(($outputLines -join "`r`n") + "`r`n")
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $startupHash=([BitConverter]::ToString($sha.ComputeHash($startupBytes))).Replace('-','') } finally { $sha.Dispose() }
  $state=[pscustomobject]@{version=1; kind='lsa-test-switch'; game=$game; phase='switching'; items=$items; config=$config; startupHash=$startupHash}
  Save-SwitchState $state $backup
  try {
    foreach ($item in $items) {
      $source=Join-Path $game $item.relative
      $target=Join-Path (Join-Path $backup 'controllers') $item.relative
      if ((Get-SwitchProof $source) -cne $item.proof) { throw "Controller changed before move: $($item.relative)" }
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      Move-Item -LiteralPath $source -Destination $target
      if ((Get-SwitchProof $target) -cne $item.proof) { throw "Backup verification failed: $($item.relative)" }
    }
    & (Join-Path $package 'Assert-LegacyLSAStopped.ps1') -GamePath $game
    & (Join-Path $package 'Install-Standalone.ps1') -GamePath $game -ExistingInstallation
    [IO.File]::WriteAllBytes($startup,$startupBytes)
    if ((Get-SwitchHash $startup) -ne $startupHash) { throw 'Startup script verification failed.' }
    $state.phase='standalone'; Save-SwitchState $state $backup
    Write-Host "Standalone selected. Backup: $backup"
    Write-Host 'RPH startup requests standalone; GUI autoload settings and unrelated INI settings were retained. No game launched.'
  } catch {
    $reason=$_.Exception.Message
    try { Restore-SwitchEssential $context $state }
    catch { throw "Switch failed: $reason. Recovery stopped: $($_.Exception.Message). Do not launch GTA; retry Switch-To-Essential.ps1 with this backup." }
    throw "Switch failed and Essential was restored: $reason"
  }
} finally { $lock.Dispose() }
