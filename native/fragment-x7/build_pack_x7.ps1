param([Parameter(Mandatory)][string]$CodeWalker)
$ErrorActionPreference='Stop'
[Reflection.Assembly]::LoadFrom((Join-Path $CodeWalker 'CodeWalker.Core.dll')) | Out-Null
$assets=Join-Path $PSScriptRoot 'assets'
$manifest=Get-Content (Join-Path $assets 'models.json') -Raw | ConvertFrom-Json
$pack=if($manifest.layout -eq 'grid6x5'){'lsa_x7a'}elseif($manifest.layout -eq 'torn36'){'lsa_x7b'}else{throw 'Bad layout'}
$dlc=if($pack -eq 'lsa_x7a'){'lsa_fence_x7a'}else{'lsa_fence_x7b'}
if(-not(Test-Path (Join-Path $assets 'conversion-receipt.json'))){throw 'Actual CodeWalker conversion receipt missing'}
$out=Join-Path $PSScriptRoot 'pack'
New-Item -ItemType Directory -Force $out | Out-Null
$path=Join-Path $out 'dlc.rpf'
if(Test-Path -LiteralPath $path){Move-Item -LiteralPath $path -Destination ($path+'.previous-'+[DateTime]::UtcNow.Ticks)}
$prefix="dlc_$($dlc):/%PLATFORM%/$dlc.rpf"
$content=@"
<?xml version="1.0" encoding="UTF-8"?>
<CDataFileMgr__ContentsOfDataFileXml><disabledFiles/><includedXmlFiles/><includedDataFiles/>
<dataFiles>
<Item><filename>$prefix</filename><fileType>RPF_FILE</fileType><locked value="true"/><loadCompletely value="true"/><overlay value="false"/><disabled value="true"/><persistent value="true"/><contents>CONTENTS_DLC_MAP_DATA</contents></Item>
<Item><filename>$prefix/$pack.ytyp</filename><fileType>DLC_ITYP_REQUEST</fileType><locked value="true"/><disabled value="true"/><persistent value="true"/></Item>
</dataFiles><contentChangeSets><Item><changeSetName>LSA_FENCE_X7_STREAMING</changeSetName><filesToEnable>
<Item>$prefix</Item><Item>$prefix/$pack.ytyp</Item></filesToEnable>
<executionConditions><activeChangesetConditions/><genericConditions>$level=MO_JIM_L11</genericConditions></executionConditions>
</Item></contentChangeSets><patchFiles/></CDataFileMgr__ContentsOfDataFileXml>
"@
# Keep the Rockstar '$level' execution condition literal in the XML here-string.
$content=$content.Replace('=MO_JIM_L11','=MO_JIM_L11')
$setup=@"
<?xml version="1.0" encoding="UTF-8"?>
<SSetupData><deviceName>dlc_$dlc</deviceName><datFile>content.xml</datFile><nameHash>$dlc</nameHash><contentChangeSetGroups><Item><NameHash>GROUP_STARTUP</NameHash><ContentChangeSets><Item>LSA_FENCE_X7_STREAMING</Item></ContentChangeSets></Item></contentChangeSetGroups><startupScript/><scriptCallstackSize value="0"/><type>EXTRACONTENT_LEVEL_PACK</type><order value="100"/><minorOrder value="0"/><isLevelPack value="false"/><dependencyPackHash/><requiredVersion/><subPackCount value="0"/></SSetupData>
"@
[IO.File]::WriteAllText((Join-Path $out 'content.xml'),$content)
[IO.File]::WriteAllText((Join-Path $out 'setup2.xml'),$setup)
$r=[CodeWalker.GameFiles.RpfFile]::CreateNew($out,'dlc.rpf',[CodeWalker.GameFiles.RpfEncryption]::OPEN)
foreach($n in 'content.xml','setup2.xml'){
    $null=[CodeWalker.GameFiles.RpfFile]::CreateFile($r.Root,$n,[IO.File]::ReadAllBytes((Join-Path $out $n)),$true)
}
$x64=[CodeWalker.GameFiles.RpfFile]::CreateDirectory($r.Root,'x64')
$inner=[CodeWalker.GameFiles.RpfFile]::CreateNew($x64,($dlc+'.rpf'),[CodeWalker.GameFiles.RpfEncryption]::OPEN)
$names=@($manifest.allowlist | ForEach-Object {$_+'.yft'})+@($pack+'.ytyp')
foreach($name in $names){
   $src=Join-Path $assets $name
   if(-not(Test-Path $src)){throw "Real binary missing: $src"}
   $null=[CodeWalker.GameFiles.RpfFile]::CreateFile($inner.Root,$name,[IO.File]::ReadAllBytes($src),$true)
}
@{pack=$dlc;models=@($manifest.allowlist);sha256=(Get-FileHash $path).Hash;
  source='actual CodeWalker pack; GTA test pending'} | ConvertTo-Json -Depth 4 |
  Set-Content (Join-Path $out 'pack-receipt.json')
Get-FileHash $path
