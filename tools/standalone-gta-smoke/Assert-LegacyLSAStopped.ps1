#requires -Version 5.1
# Read-only preflight shared by install and launch. Never relocates user files.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$GamePath)
$ErrorActionPreference = 'Stop'
$game = [System.IO.Path]::GetFullPath($GamePath)

# Block known controllers AND their companion loaders/bridges. Configuration
# and private memory/server data may remain on disk; they are not loaded here.
$blocked = @(
  'LosSantosAlive.dll',
  'Plugins/LosSantosAlive.dll',
  'Plugins/Los Santos Alive.dll',
  'Plugins/LSA.PromotedCharacters.dll',
  'Plugins/LSA.PromotedCharacters',
  'Plugins/LSA.PromotedCharacters.json',
  'Plugins/LSA.PromotedCharacters.Runtime.dll',
  'Plugins/LSA.PromotedCharacters.Bootstrap.dll',
  'Plugins/LSA.SessionIdentity.dll',
  'Plugins/LSA.Intelligence.dll',
  'Plugins/LSPDFR/LosSantosAlive.Interop.dll',
  'Plugins/LSPDFR/LosSantosAlive.PRBridge.dll'
)
foreach ($relative in $blocked) {
  if (Test-Path -LiteralPath (Join-Path $game $relative)) {
    throw "Legacy LSA conflict remains at $relative. Move it to your verified off-game backup before standalone testing."
  }
}

# Existing Essential can use a separate bundled or system Node process.
# Refuse a still-running instance belonging to this GTA folder.
$server = Join-Path $game 'Plugins/LosSantosAliveServer'
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)) {
  $exe = [string]$process.ExecutablePath
  $cmd = [string]$process.CommandLine
  if (($exe.Length -gt 0 -and $exe.StartsWith($server, [System.StringComparison]::OrdinalIgnoreCase)) -or
      ($cmd.Length -gt 0 -and $cmd.IndexOf($server, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
    throw 'Original LosSantosAliveServer Node process is running. Stop it before standalone testing.'
  }
}
