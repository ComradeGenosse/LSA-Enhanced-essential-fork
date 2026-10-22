param(
 [Parameter(Mandatory)][string]$GameRoot,
 [Parameter(Mandatory)][string]$BackupRoot,
 [ValidateSet('Install','Restore')][string]$Mode='Install',
 [ValidateSet('x7a','x7b','x7c')][string]$Variant='x7a'
)
$ErrorActionPreference='Stop'
if(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue){throw 'Stop GTA/RPH before install or restore'}
$manifest=Join-Path $BackupRoot 'manifest.json'
function HashOf($p){if(Test-Path -LiteralPath $p){(Get-FileHash -LiteralPath $p).Hash}else{$null}}
if($Mode -eq 'Install'){
 if(Test-Path -LiteralPath $manifest){throw 'Existing backup: restore first or supply a fresh backup directory'}
 $dlc='lsa_fence_'+$Variant
 $paths=@('ScriptHookVDotNet.ini','onigiri/common/data/dlclist.xml',
          ('onigiri/dlcpacks/'+$dlc+'/dlc.rpf'),'scripts-x7/WpsBreachLabX7.3.cs','scripts-x7/x7-models.txt')
 $ini=Join-Path $GameRoot $paths[0];$list=Join-Path $GameRoot $paths[1]
 if(-not(Test-Path $ini) -or -not(Test-Path $list)){throw 'Expected installed Onigiri + SHVDN config missing'}
 $txt=[IO.File]::ReadAllText($ini)
 if($txt -notmatch 'ScriptsLocation="scripts"'){throw 'Expected original ScriptsLocation="scripts"; refuse unexpected configuration'}
 $orig=[IO.File]::ReadAllText($list)
 if($orig -notmatch '</Paths>'){throw 'Unexpected dlclist format'}
 $pack=Join-Path $PSScriptRoot 'pack/pack-receipt.json'
 if(-not(Test-Path $pack)){throw 'Pack receipt missing. Convert and pack real binaries first'}
 $info=Get-Content $pack -Raw | ConvertFrom-Json
 if($info.pack -ne $dlc){throw 'Selected -Variant disagrees with actual built pack'}
 $bin=Join-Path $PSScriptRoot 'pack/dlc.rpf'
 if((Get-FileHash $bin).Hash -ne $info.sha256){throw 'Pack hash does not match receipt'}
 New-Item -ItemType Directory -Force $BackupRoot | Out-Null
 $rows=@();$n=0
 foreach($relative in $paths){
   $dest=Join-Path $GameRoot $relative;$before=HashOf $dest
   $bak="$n.bak"
   if($before){Copy-Item -LiteralPath $dest -Destination (Join-Path $BackupRoot $bak)}
   $rows+=@{relative=$relative;before=$before;backup=$bak;installed=$null};$n++
 }
 # Manifest is authoritative and prevents double installs. If interrupted, restore.
 @{variant=$Variant;rows=$rows;phase='backed_up'} | ConvertTo-Json -Depth 8 | Set-Content $manifest
 foreach($rel in $paths[2..4]){New-Item -ItemType Directory -Force (Split-Path (Join-Path $GameRoot $rel)) | Out-Null}
 Copy-Item -LiteralPath $bin -Destination (Join-Path $GameRoot $paths[2])
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'WpsBreachLabX7.3.cs') -Destination (Join-Path $GameRoot $paths[3])
 $models=Get-Content (Join-Path $PSScriptRoot 'assets/models.json') -Raw | ConvertFrom-Json
 if(@($models.allowlist).Count -ne @($info.models).Count){throw 'Pack manifest/receipt disagree'}
 if((@($models.allowlist) -join ',') -ne (@($info.models) -join ',')){throw 'Pack model list differs from receipt'}
 @($models.allowlist) | Set-Content (Join-Path $GameRoot $paths[4])
 [IO.File]::WriteAllText($ini,$txt.Replace('ScriptsLocation="scripts"','ScriptsLocation="scripts-x7"'))
 if($orig -notmatch [Regex]::Escape("dlcpacks:/$dlc/")){
   $orig=$orig.Replace('</Paths>',"    <Item>dlcpacks:/$dlc/</Item>`r`n</Paths>")
 }
 [xml]$test=$orig;[IO.File]::WriteAllText($list,$orig)
 foreach($row in $rows){$row.installed=HashOf (Join-Path $GameRoot $row.relative)}
 @{variant=$Variant;rows=$rows;phase='installed'} | ConvertTo-Json -Depth 8 | Set-Content $manifest
 foreach($row in $rows){if((HashOf (Join-Path $GameRoot $row.relative)) -ne $row.installed){throw 'Installed hash mismatch'}}
 Write-Host "X7 installed, backup saved: $manifest; GTA runtime still unverified"
}else{
 if(-not(Test-Path $manifest)){throw 'Cannot restore without manifest'}
 $state=Get-Content $manifest -Raw | ConvertFrom-Json;$rows=@($state.rows)
 foreach($row in $rows){
   $dest=Join-Path $GameRoot $row.relative;$hash=HashOf $dest
   if($hash -ne $row.installed -and $hash -ne $row.before -and $null -ne $row.installed){
      throw "Unexpected post-install changes: $($row.relative)"
   }
 }
 foreach($row in $rows){
   $dest=Join-Path $GameRoot $row.relative
   if($row.before){
       Copy-Item -LiteralPath (Join-Path $BackupRoot $row.backup) -Destination $dest -Force
   }elseif(Test-Path -LiteralPath $dest){Remove-Item -LiteralPath $dest}
   if((HashOf $dest) -ne $row.before){throw "Restore hash mismatch: $($row.relative)"}
 }
 foreach($folder in @('scripts-x7',('onigiri/dlcpacks/lsa_fence_'+$state.variant))){
   $target=Join-Path $GameRoot $folder
   if((Test-Path $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count -eq 0){Remove-Item -LiteralPath $target}
 }
 $rows | ForEach-Object {@{relative=$_.relative;before=$_.before;after=(HashOf (Join-Path $GameRoot $_.relative));restored=$true}} |
    ConvertTo-Json -Depth 5 | Set-Content (Join-Path $BackupRoot 'restored.json')
 Write-Host 'X7 rollback complete: hash-verified against pre-install bytes'
}
