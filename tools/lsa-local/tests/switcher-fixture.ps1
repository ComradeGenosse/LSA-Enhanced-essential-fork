#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [Parameter(Mandatory=$true)][string]$FixtureRoot
)
$ErrorActionPreference='Stop'
$scripts=Join-Path (Split-Path -Parent $PSScriptRoot) 'existing'
$PackagePath=(Resolve-Path -LiteralPath $PackagePath).Path
$FixtureRoot=[IO.Path]::GetFullPath($FixtureRoot)
if (Test-Path -LiteralPath $FixtureRoot) { throw 'Use a new fixture directory; tests never delete existing data.' }
New-Item -ItemType Directory -Path $FixtureRoot | Out-Null
# Mock only process enumeration: no fixture or test starts GTA/RPH/Node.
$global:LSASwitchFixtureGame=$false; $global:LSASwitchFixtureNodes=@()
function Get-Process { param($Name,$ErrorAction) if ($global:LSASwitchFixtureGame) { [pscustomobject]@{Id=123;ProcessName='GTA5_Enhanced'} } }
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) $global:LSASwitchFixtureNodes }
function Assert-True($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Action,[string]$Pattern) {
  $failed=$false
  try { & $Action } catch { $failed=$true; if ($_.Exception.Message -notlike $Pattern) { throw } }
  Assert-True $failed "Expected refusal: $Pattern"
}
function Snapshot([string]$Root) {
  (@(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
    $_.FullName.Substring($Root.Length+1).Replace('\','/') + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }) -join "`n")
}
function New-Fixture([string]$Name,[string]$Startup='ReloadAllPlugins',[switch]$NoConfig) {
  $g=Join-Path $FixtureRoot $Name
  New-Item -ItemType Directory -Path $g | Out-Null
  $files=@(
    'GTA5_Enhanced.exe','RAGEPluginHook.exe','Plugins/LosSantosAlive.dll',
    'Plugins/LSA.PromotedCharacters.dll','Plugins/LSA.PromotedCharacters.json',
    'Plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll',
    'Plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll',
    'Plugins/LSPDFR/LosSantosAlive.Interop.dll','Plugins/LSPDFR/LosSantosAlive.PRBridge.dll',
    'LosSantosAlive.dll','Plugins/LSA.Intelligence.dll','Plugins/SmartVehicleEntry.dll',
    'LSA.settings.json','Plugins/LosSantosAliveServer/.env',
    'Plugins/LosSantosAliveServer/memory.sqlite','Plugins/LosSantosAlive/profiles/actor.json'
  )
  foreach($r in $files) {
    $p=Join-Path $g $r
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p,"fixture:$r")
  }
  New-Item -ItemType Directory -Path (Join-Path $g 'Plugins/LSA.PromotedCharacters/empty') | Out-Null
  if (-not $NoConfig) {
    # GUI-related INI entries are opaque/preserved, including unrelated plugins.
    [IO.File]::WriteAllText((Join-Path $g 'RagePluginHook.ini'),"[Miscellaneous]`r`nPluginTimeoutThreshold=10000`r`n[Plugins]`r`nLoadAllPlugins=True`r`nPluginsToLoad=LosSantosAlive.dll,SmartVehicleEntry.dll`r`n",[Text.Encoding]::Unicode)
    [IO.File]::WriteAllText((Join-Path $g 'startup.rphs'),$Startup,[Text.Encoding]::Unicode)
  }
  return $g
}
function To-Standalone([string]$Game) {
  & (Join-Path $scripts 'Switch-To-Standalone.ps1') -GamePath $Game -BackupPath ($Game+'-backup') -PackagePath $PackagePath
}
function To-Essential([string]$Game) {
  & (Join-Path $scripts 'Switch-To-Essential.ps1') -GamePath $Game -BackupPath ($Game+'-backup') -PackagePath $PackagePath
}
$g=New-Fixture 'roundtrip'
# A real managed DLL hidden under an unrelated filename must be parked too.
$assembly=Join-Path $FixtureRoot 'LosSantosAlive.Hidden.dll'
$source=Join-Path $FixtureRoot 'marker.cs'
[IO.File]::WriteAllText($source,'public class SwitcherFixtureMarker {}')
& (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe') /nologo /target:library "/out:$assembly" $source
if ($LASTEXITCODE -ne 0) { throw 'Could not compile renamed-controller fixture.' }
Copy-Item -LiteralPath $assembly -Destination (Join-Path $g 'Plugins/disguised.dll')
$before=Snapshot $g
$iniHash=(Get-FileHash -LiteralPath (Join-Path $g 'RagePluginHook.ini')).Hash
for($cycle=1;$cycle -le 2;$cycle++) {
  To-Standalone $g
  & (Join-Path $PackagePath 'Assert-LegacyLSAStopped.ps1') -GamePath $g
  $startup=[IO.File]::ReadAllText((Join-Path $g 'startup.rphs'))
  Assert-True ($startup -match 'LoadPlugin "LSA\.Standalone\.RageHost\.dll"') 'Standalone startup load missing'
  Assert-True ($startup -match 'LoadPlugin "SmartVehicleEntry\.dll"') 'Unrelated plugin lost'
  Assert-True ($startup -notmatch 'ReloadAllPlugins|LosSantosAlive|disguised|PromotedCharacters') 'Legacy loader remains'
  Assert-True ((Get-FileHash -LiteralPath (Join-Path $g 'RagePluginHook.ini')).Hash -eq $iniHash) 'INI was modified'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $g 'Plugins/disguised.dll'))) 'Renamed controller remains'
  Expect-Failure { To-Standalone $g } '*Run Switch-To-Essential.ps1 first*'
  To-Essential $g
  Assert-True ((Snapshot $g) -ceq $before) "Cycle $cycle did not restore exact file set/hashes"
  Assert-True (Test-Path -LiteralPath (Join-Path $g 'Plugins/LSA.PromotedCharacters/empty')) 'Empty directory lost'
  To-Essential $g # repeat restore is safe
}
Write-Host 'PASS: two round trips, exact restoration, GUI settings retained, renamed controllers, unrelated plugins.'

foreach($mode in @('missing','explicit')) {
  if($mode -eq 'missing') { $g=New-Fixture $mode -NoConfig }
  else { $g=New-Fixture $mode -Startup "// retained comment`r`nLoadPlugin `"LosSantosAlive.dll`"`r`nLoadPlugin `"SmartVehicleEntry.dll`"`r`nConsoleKey F4" }
  $before=Snapshot $g; To-Standalone $g; To-Essential $g
  Assert-True ((Snapshot $g) -ceq $before) "Configuration presence/bytes not restored: $mode"
}
Write-Host 'PASS: absent RPH files and explicit startup loads restored.'

$g=New-Fixture 'guards'; $before=Snapshot $g
$global:LSASwitchFixtureGame=$true
Expect-Failure { To-Standalone $g } '*Exit GTA/RPH*'
$global:LSASwitchFixtureGame=$false
foreach($cmd in @('node "Plugins/LosSantosAliveServer/server.js"','node service.mjs','node lsa-standalone-companion/service.mjs')) {
  $global:LSASwitchFixtureNodes=@([pscustomobject]@{CommandLine=$cmd;ExecutablePath='C:\node.exe'})
  Expect-Failure { To-Standalone $g } '*Stop the relevant*'
}
$global:LSASwitchFixtureNodes=@([pscustomobject]@{CommandLine='';ExecutablePath=''})
Expect-Failure { To-Standalone $g } '*Cannot inspect a Node process*'
$global:LSASwitchFixtureNodes=@()
Assert-True ((Snapshot $g) -ceq $before) 'Process guard modified game'
Expect-Failure { & (Join-Path $scripts 'Switch-To-Standalone.ps1') -GamePath $g -BackupPath (Join-Path $g 'backup') -PackagePath $PackagePath } '*outside GTA*'
# Absolute unrelated Node server paths (including Codex) are not LSA servers.
$global:LSASwitchFixtureNodes=@([pscustomobject]@{CommandLine='node "C:\unrelated\codex\server.mjs"';ExecutablePath='C:\unrelated\node.exe'})
To-Standalone $g
$global:LSASwitchFixtureNodes=@([pscustomobject]@{CommandLine='node ./server.mjs';ExecutablePath=(Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node\fixture\bin\node.exe')})
To-Essential $g
$global:LSASwitchFixtureNodes=@([pscustomobject]@{CommandLine=('node "'+$g+'\Plugins\LosSantosAliveServer\server.js"');ExecutablePath=(Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node\fixture\bin\node.exe')})
Expect-Failure { To-Standalone $g } '*Stop the relevant*'
$global:LSASwitchFixtureNodes=@()
To-Standalone $g
$global:LSASwitchFixtureGame=$true; Expect-Failure { To-Essential $g } '*Exit GTA/RPH*'; $global:LSASwitchFixtureGame=$false
$global:LSASwitchFixtureNodes=@([pscustomobject]@{CommandLine='node service.mjs';ExecutablePath='C:\node.exe'})
Expect-Failure { To-Essential $g } '*Stop the relevant*'; $global:LSASwitchFixtureNodes=@()
To-Essential $g
Write-Host 'PASS: process and path guards in both directions, without starting processes.'

$g=New-Fixture 'changed'; To-Standalone $g
$dll=Join-Path $g 'Plugins/LSA.Standalone.RageHost.dll'; $original=[IO.File]::ReadAllBytes($dll)
[IO.File]::WriteAllText($dll,'changed')
Expect-Failure { To-Essential $g } '*Managed file changed or missing*'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $g 'Plugins/LosSantosAlive.dll'))) 'Essential restored over changed standalone'
[IO.File]::WriteAllBytes($dll,$original)
$startup=Join-Path $g 'startup.rphs'; $originalStartup=[IO.File]::ReadAllBytes($startup)
[IO.File]::AppendAllText($startup,'user edit')
Expect-Failure { To-Essential $g } '*configuration changed outside*'
[IO.File]::WriteAllBytes($startup,$originalStartup)
$occupied=Join-Path $g 'Plugins/LosSantosAlive.dll'
[IO.File]::WriteAllText($occupied,'do not overwrite')
Expect-Failure { To-Essential $g } '*Expected exactly one copy*'
Remove-Item -LiteralPath $occupied
To-Essential $g
Write-Host 'PASS: edited DLL/configuration and occupied restore path refuse safely.'

$g=New-Fixture 'backup-edits'; To-Standalone $g
$parked=Join-Path ($g+'-backup') 'controllers/Plugins/LosSantosAlive.dll'
$original=[IO.File]::ReadAllBytes($parked); [IO.File]::WriteAllText($parked,'changed backup')
Expect-Failure { To-Essential $g } '*Controller hash/tree changed*'
Assert-True (Test-Path -LiteralPath (Join-Path $g 'Plugins/LSA.Standalone.RageHost.dll')) 'Backup failure removed standalone'
[IO.File]::WriteAllBytes($parked,$original); To-Essential $g
Write-Host 'PASS: changed backup refuses before rollback.'

$g=New-Fixture 'unsupported-startup' -Startup 'Exec "other.rphs"'; $before=Snapshot $g
Expect-Failure { To-Standalone $g } '*Unsupported startup loader command*'
Assert-True ((Snapshot $g) -ceq $before) 'Unsupported script changed game'
$g=New-Fixture 'existing-backup'; $before=Snapshot $g
New-Item -ItemType Directory -Path ($g+'-backup') | Out-Null
[IO.File]::WriteAllText((Join-Path ($g+'-backup') 'keep.txt'),'existing backup')
Expect-Failure { To-Standalone $g } '*Backup folder already exists*'
Assert-True ((Snapshot $g) -ceq $before) 'Existing backup refusal changed game'
Write-Host 'PASS: unknown loader scripts and unmanaged backup refuse without game changes.'

$g=New-Fixture 'standalone-copy'; $before=Snapshot $g
$standaloneAssembly=Join-Path $FixtureRoot 'LSA.Standalone.Hidden.dll'
& (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe') /nologo /target:library "/out:$standaloneAssembly" $source
if ($LASTEXITCODE -ne 0) { throw 'Could not compile standalone-copy fixture.' }
$hidden=Join-Path $g 'Plugins/unmanaged-copy.dll'
Copy-Item -LiteralPath $standaloneAssembly -Destination $hidden
Expect-Failure { To-Standalone $g } '*Unmanaged standalone assembly*'
Remove-Item -LiteralPath $hidden
To-Standalone $g
Copy-Item -LiteralPath $standaloneAssembly -Destination $hidden
Expect-Failure { To-Essential $g } '*Unmanaged standalone assembly*'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $g 'Plugins/LosSantosAlive.dll'))) 'Restored Essential alongside unmanaged standalone'
Remove-Item -LiteralPath $hidden
To-Essential $g
Assert-True ((Snapshot $g) -ceq $before) 'Unmanaged-copy fixture did not restore'
Write-Host 'PASS: unmanaged renamed standalone assemblies block either switch direction.'

$g=New-Fixture 'interrupted'; $before=Snapshot $g
To-Standalone $g; To-Essential $g
$statePath=Join-Path ($g+'-backup') 'switch-state.json'
$s=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$s.phase='switching'; $s | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $statePath -Encoding UTF8
$first=$s.items[0].relative
Move-Item -LiteralPath (Join-Path $g $first) -Destination (Join-Path ($g+'-backup/controllers') $first)
To-Essential $g
Assert-True ((Snapshot $g) -ceq $before) 'Interrupted controller move not recovered'
Write-Host 'PASS: recovery after interrupted controller move.'

$g=New-Fixture 'interrupted-install'; $before=Snapshot $g
To-Standalone $g
$statePath=Join-Path ($g+'-backup') 'switch-state.json'
$s=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$s.phase='switching'; $s | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $statePath -Encoding UTF8
$originalStartup=@($s.config | Where-Object relative -eq 'startup.rphs')[0]
[IO.File]::WriteAllBytes((Join-Path $g 'startup.rphs'),[Convert]::FromBase64String($originalStartup.bytes))
To-Essential $g
Assert-True ((Snapshot $g) -ceq $before) 'Interrupted install before startup write not recovered'
Write-Host 'PASS: recovery after completed install but before startup update.'

# A package installer failure after parking must invoke the existing rollback path.
$brokenPackage=Join-Path $FixtureRoot 'broken-package'
Copy-Item -LiteralPath $PackagePath -Destination $brokenPackage -Recurse
[IO.File]::WriteAllText((Join-Path $brokenPackage 'Install-Standalone.ps1'),"throw 'fixture injected install failure'")
$g=New-Fixture 'install-failure'; $before=Snapshot $g
Expect-Failure { & (Join-Path $scripts 'Switch-To-Standalone.ps1') -GamePath $g -BackupPath ($g+'-backup') -PackagePath $brokenPackage } '*Essential was restored*'
Assert-True ((Snapshot $g) -ceq $before) 'Failed install did not restore Essential'
Write-Host 'PASS: automatic restore after installer failure. ALL FIXTURE CHECKS PASSED.'
