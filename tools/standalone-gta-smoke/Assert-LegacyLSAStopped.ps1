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

# Catch renamed copies of managed legacy controllers by their assembly
# identity, not just the file name. Reflection-only name reads do not load
# or execute those assemblies; native/unreadable DLLs remain a manual RPH
# load-list gate. Standalone assemblies are never blocked here.
$pluginDirectory = Join-Path $game 'Plugins'
$candidates = @()
if (Test-Path -LiteralPath $pluginDirectory -PathType Container) {
  $candidates += @(Get-ChildItem -LiteralPath $pluginDirectory -Filter '*.dll' -File -Recurse -Force)
}
$candidates += @(Get-ChildItem -LiteralPath $game -Filter '*.dll' -File -Force)
foreach ($dll in $candidates) {
  try {
    $identity = [System.Reflection.AssemblyName]::GetAssemblyName($dll.FullName).Name
    if ($identity -match '^(LosSantosAlive($|\.)|LSA\.PromotedCharacters($|\.)|LSA\.SessionIdentity$|LSA\.Intelligence$)') {
      throw "Legacy LSA conflict: renamed managed assembly $identity at $($dll.FullName). Move it outside the GTA installation."
    }
  } catch [System.BadImageFormatException] {
    # Unmanaged/native DLL: no managed assembly name to inspect.
  } catch [System.IO.FileLoadException] {
    # Non-loadable metadata: leave loader-list verification to the operator.
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
