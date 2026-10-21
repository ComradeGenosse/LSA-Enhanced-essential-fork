param([Parameter(Mandatory)][string]$GameRoot,[Parameter(Mandatory)][string]$BackupRoot,[ValidateSet('Install','Restore')][string]$Mode='Install')
$ErrorActionPreference='Stop'
if(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue){throw 'Stop GTA before install/restore'}
$manifest=Join-Path $BackupRoot 'manifest.json'
$paths=@('ScriptHookVDotNet.ini','onigiri/common/data/dlclist.xml','onigiri/dlcpacks/lsa_fence_x6/dlc.rpf','scripts-x6/WpsBreachLabX6.3.cs')
function HashOf($p){if(Test-Path -LiteralPath $p){(Get-FileHash -LiteralPath $p).Hash}else{$null}}
if($Mode -eq 'Install'){
 if(Test-Path $manifest){throw 'Backup exists: restore or choose a fresh backup directory'}
 New-Item -ItemType Directory -Force $BackupRoot | Out-Null
 $rows=@();$i=0
 foreach($rel in $paths){$path=Join-Path $GameRoot $rel;$h=HashOf $path;$backup=Join-Path $BackupRoot "$i.bak";if($h){Copy-Item -LiteralPath $path -Destination $backup};$rows+=@{relative=$rel;before=$h;backup="$i.bak"};$i++}
 $rows | ConvertTo-Json -Depth 5 | Set-Content $manifest
 foreach($rel in $paths[2..3]){New-Item -ItemType Directory -Force (Split-Path (Join-Path $GameRoot $rel)) | Out-Null}
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'pack/dlc.rpf') -Destination (Join-Path $GameRoot $paths[2])
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'WpsBreachLabX6.3.cs') -Destination (Join-Path $GameRoot $paths[3])
 $ini=Join-Path $GameRoot $paths[0];$text=[IO.File]::ReadAllText($ini);$text=$text.Replace('ScriptsLocation="scripts"','ScriptsLocation="scripts-x6"');if($text -notmatch 'ScriptsLocation="scripts-x6"'){throw 'Unexpected script location'};[IO.File]::WriteAllText($ini,$text)
 $list=Join-Path $GameRoot $paths[1];$text=[IO.File]::ReadAllText($list);if($text -notmatch 'dlcpacks:/lsa_fence_x6/'){$text=$text.Replace('</Paths>',"    <Item>dlcpacks:/lsa_fence_x6/</Item>`r`n</Paths>")};[xml]$check=$text;[IO.File]::WriteAllText($list,$text)
 foreach($r in $rows){$r.installed=HashOf (Join-Path $GameRoot $r.relative)};$rows | ConvertTo-Json -Depth 5 | Set-Content $manifest
}else{
 $rows=Get-Content $manifest -Raw | ConvertFrom-Json
 foreach($r in $rows){$path=Join-Path $GameRoot $r.relative;$h=HashOf $path;if($h -ne $r.installed -and $h -ne $r.before){throw "Unexpected changed file: $($r.relative)"}}
 foreach($r in $rows){$path=Join-Path $GameRoot $r.relative;if($r.before){Copy-Item -LiteralPath (Join-Path $BackupRoot $r.backup) -Destination $path -Force}else{if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path}};if((HashOf $path) -ne $r.before){throw "Restore mismatch: $($r.relative)"}}
 foreach($rel in @('scripts-x6','onigiri/dlcpacks/lsa_fence_x6')){$dir=Join-Path $GameRoot $rel;if((Test-Path -LiteralPath $dir) -and @(Get-ChildItem -LiteralPath $dir -Force).Count -eq 0){Remove-Item -LiteralPath $dir}}
 $rows | ForEach-Object {@{relative=$_.relative;before=$_.before;after=(HashOf (Join-Path $GameRoot $_.relative));restored=$true}} | ConvertTo-Json | Set-Content (Join-Path $BackupRoot 'restored.json')
}
