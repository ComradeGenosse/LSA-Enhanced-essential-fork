# Compile a surveyed lab CMapData XML and assemble a separate GTA Enhanced
# DLC using CodeWalker's RSC/RPF implementation. NEVER installs it.
param(
  [Parameter(Mandatory)][string]$CodeWalker,
  [Parameter(Mandatory)][string]$BuildDir,
  [Parameter(Mandatory)][string]$OutputDir,
  [switch]$ConfirmedLocalSurvey
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $ConfirmedLocalSurvey){throw 'Refuse packaging without local survey confirmation'}
if(Get-Process GTA5_Enhanced,GTA5,RAGEPluginHook -ErrorAction SilentlyContinue){
  throw 'Stop GTA/RPH before CodeWalker conversion and pack generation'
}
if(Test-Path -LiteralPath (Join-Path $BuildDir 'NOT_DEPLOYABLE.txt')){
  throw 'Refuse synthetic lab fixture'
}
$xmlPath=Join-Path $BuildDir 'lsa_destruction_lab.ymap.xml'
$manifestPath=Join-Path $BuildDir 'placements.json'
if(-not(Test-Path $xmlPath) -or -not(Test-Path $manifestPath)){
  throw 'Missing generated map XML/placement manifest'
}
if(Test-Path -LiteralPath $OutputDir){throw 'OutputDir must not exist; use a fresh one'}
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if($manifest.classification -ne 'PROPOSED_UNVERIFIED_IN_GTA' -or @($manifest.placements).Count -ne 2){
  throw 'Unexpected or unqualified map source'
}
if((Get-FileHash $xmlPath -Algorithm SHA256).Hash -ne [string]$manifest.sourceSha256){
  throw 'Map source SHA-256 differs from generator receipt'
}
[xml]$source=[IO.File]::ReadAllText($xmlPath)
if($source.CMapData.name -ne 'lsa_destruction_lab' -or @($source.CMapData.entities.Item).Count -ne 2){
  throw 'Not expected two-map-entity CodeWalker XML'
}
foreach($entity in @($source.CMapData.entities.Item)){
  if($entity.type -ne 'CEntityDef' -or $entity.archetypeName -ne 'prop_fnccorgm_02e'){
    throw 'Wrong archetype or entity kind'
  }
}
foreach($dll in @('SharpDX.dll','SharpDX.Mathematics.dll','CodeWalker.Core.dll')){
  $dllPath=Join-Path $CodeWalker $dll
  if(-not(Test-Path $dllPath)){throw "CodeWalker assembly missing: $dll"}
  $null=[Reflection.Assembly]::LoadFrom($dllPath)
}
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$mapBytes=[CodeWalker.GameFiles.XmlMeta]::GetRSCData($source)
if(-not $mapBytes -or $mapBytes.Length -lt 256){throw 'CodeWalker returned no viable binary YMAP'}
if([Text.Encoding]::ASCII.GetString($mapBytes,0,4) -ne 'RSC7'){
  throw 'CodeWalker did not produce an RSC7 resource'
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$binary=Join-Path $OutputDir 'lsa_destruction_lab.ymap'
[IO.File]::WriteAllBytes($binary,$mapBytes)
# Conversion success alone does not establish serialized entity correctness.
$reloaded=[CodeWalker.GameFiles.YmapFile]::new()
$reloaded.Load($mapBytes)
if(@($reloaded.AllEntities).Count -ne 2){throw 'Binary YMAP lost entities'}
for($i=0;$i -lt 2;$i++){
  $actual=$reloaded.AllEntities[$i].CEntityDef
  $planned=$manifest.placements[$i]
  if($actual.archetypeName.Hash -ne $planned.hash -or
     [Math]::Abs($actual.position.X-$planned.x) -gt 0.001 -or
     [Math]::Abs($actual.position.Y-$planned.y) -gt 0.001 -or
     [Math]::Abs($actual.position.Z-$planned.z) -gt 0.001 -or
     [Math]::Abs($actual.rotation.Z-$planned.quaternion[2]) -gt 0.00001 -or
     [Math]::Abs($actual.rotation.W-$planned.quaternion[3]) -gt 0.00001 -or
     $actual.scaleXY -ne 1 -or $actual.scaleZ -ne 1){throw 'Binary YMAP placement mismatch'}
}
$pack='lsa_destruction_lab'
$prefix='dlc_lsa_destruction_lab:/%PLATFORM%/lsa_destruction_lab.rpf'
$contents=@"
<?xml version="1.0" encoding="UTF-8"?>
<CDataFileMgr__ContentsOfDataFileXml><disabledFiles/><includedXmlFiles/><includedDataFiles/>
<dataFiles>
<Item><filename>$prefix</filename><fileType>RPF_FILE</fileType><overlay value="false"/><disabled value="false"/><persistent value="false"/><contents>CONTENTS_DLC_MAP_DATA</contents></Item>

</dataFiles><contentChangeSets>
<Item><changeSetName>LSA_DESTRUCTION_LAB_STREAMING</changeSetName><filesToEnable><Item>$prefix/</Item></filesToEnable>
<executionConditions><activeChangesetConditions/><genericConditions>&#36;level=MO_JIM_L11</genericConditions></executionConditions></Item>
</contentChangeSets><patchFiles/></CDataFileMgr__ContentsOfDataFileXml>
"@
$setup=@"
<?xml version="1.0" encoding="UTF-8"?>
<SSetupData><deviceName>dlc_$pack</deviceName><datFile>content.xml</datFile><nameHash>$pack</nameHash><contentChangeSetGroups><Item><NameHash>GROUP_UPDATE_STREAMING</NameHash><ContentChangeSets><Item>LSA_DESTRUCTION_LAB_STREAMING</Item></ContentChangeSets></Item></contentChangeSetGroups><startupScript/><scriptCallstackSize value="0"/><type>EXTRACONTENT_LEVEL_PACK</type><order value="100"/><minorOrder value="0"/><isLevelPack value="true"/><dependencyPackHash/><requiredVersion/><subPackCount value="0"/></SSetupData>
"@
[xml]$null=$contents
[xml]$null=$setup
[IO.File]::WriteAllText((Join-Path $OutputDir 'content.xml'),$contents)
[IO.File]::WriteAllText((Join-Path $OutputDir 'setup2.xml'),$setup)
$outer=[CodeWalker.GameFiles.RpfFile]::CreateNew($OutputDir,'dlc.rpf',[CodeWalker.GameFiles.RpfEncryption]::OPEN)
foreach($name in @('content.xml','setup2.xml')){
  $null=[CodeWalker.GameFiles.RpfFile]::CreateFile($outer.Root,$name,
    [IO.File]::ReadAllBytes((Join-Path $OutputDir $name)),$true)
}
$x64=[CodeWalker.GameFiles.RpfFile]::CreateDirectory($outer.Root,'x64')
$inner=[CodeWalker.GameFiles.RpfFile]::CreateNew($x64,'lsa_destruction_lab.rpf',[CodeWalker.GameFiles.RpfEncryption]::OPEN)
$null=[CodeWalker.GameFiles.RpfFile]::CreateFile($inner.Root,'lsa_destruction_lab.ymap',$mapBytes,$true)
# A map archive needs an imap -> archetype dictionary dependency manifest.
# Declare this explicitly rather than relying on ambient archetype loading.
[xml]$dependencyXml=@'
<?xml version="1.0" encoding="UTF-8"?>
<CPackFileMetaData>
 <MapDataGroups itemType="CMapDataGroup" />
 <HDTxdBindingArray itemType="CHDTxdAssetBinding" />
 <imapDependencies itemType="CImapDependency" />
 <imapDependencies_2 itemType="CImapDependencies">
  <Item><imapName>lsa_destruction_lab</imapName><manifestFlags />
   <itypDepArray><Item>v_fences</Item></itypDepArray>
  </Item>
 </imapDependencies_2>
 <itypDependencies_2 itemType="CItypDependencies" />
 <Interiors itemType="CInteriorBoundsFiles" />
</CPackFileMetaData>
'@
$dependencyXml.Save((Join-Path $OutputDir '_manifest.ymf.xml'))
$dependencyBytes=[CodeWalker.GameFiles.XmlMeta]::GetPSOData($dependencyXml)
if(-not $dependencyBytes -or $dependencyBytes.Length -lt 64){throw 'YMF conversion failed'}
$null=[CodeWalker.GameFiles.RpfFile]::CreateFile($inner.Root,'_manifest.ymf',$dependencyBytes,$true)
$packFile=Join-Path $OutputDir 'dlc.rpf'
if(-not(Test-Path $packFile)){throw 'CodeWalker did not create DLC RPF'}
$check=[CodeWalker.GameFiles.RpfFile]::new($packFile,'dlc.rpf')
$scanErrors=[Collections.Generic.List[string]]::new()
$check.ScanStructure([Action[string]]{param($s)},[Action[string]]{param($s) $scanErrors.Add($s)})
if($scanErrors.Count -ne 0){throw ($scanErrors -join '; ')}
$nested=@($check.Children | Where-Object Name -eq 'lsa_destruction_lab.rpf')
if($nested.Count -ne 1){throw 'Packed map archive missing'}
$entry=@($nested[0].AllEntries | Where-Object Name -eq 'lsa_destruction_lab.ymap')
if($entry.Count -ne 1){throw 'Packed YMAP missing or ambiguous'}
$packedMap=[CodeWalker.GameFiles.YmapFile]::new()
$packedMap.Load($nested[0].ExtractFile($entry[0]),$entry[0])
if(@($packedMap.AllEntities).Count -ne 2){throw 'Packed YMAP cannot reload two entities'}
$ymfEntry=@($nested[0].AllEntries | Where-Object Name -eq '_manifest.ymf')
if($ymfEntry.Count -ne 1){throw 'Packed dependency manifest missing'}
$ymf=[CodeWalker.GameFiles.YmfFile]::new()
$ymf.Load($nested[0].ExtractFile($ymfEntry[0]),$ymfEntry[0])
if(@($ymf.imapDependencies2).Count -ne 1){throw 'Packed dependency manifest cannot reload'}
if($ymf.imapDependencies2[0].Dep.imapName.Hash -ne [CodeWalker.GameFiles.JenkHash]::GenHash('lsa_destruction_lab') -or
   @($ymf.imapDependencies2[0].itypDepArray).Count -ne 1 -or
   $ymf.imapDependencies2[0].itypDepArray[0].Hash -ne [CodeWalker.GameFiles.JenkHash]::GenHash('v_fences')){
  throw 'Packed YMAP/archetype dependency differs from plan'
}
[ordered]@{
  pack='lsa_destruction_lab'
  map='lsa_destruction_lab.ymap'
  mapSha256=(Get-FileHash $binary -Algorithm SHA256).Hash
  dlcSha256=(Get-FileHash $packFile -Algorithm SHA256).Hash
  sourceSha256=[string]$manifest.sourceSha256
  sourceEvidence=[string]$manifest.evidence
  binaryReloadEntities=@($reloaded.AllEntities).Count
  packedReloadEntities=@($packedMap.AllEntities).Count
  dependencyDictionary='v_fences'
  mountingReference='Installed NVE_props_addon: RPF_FILE map archive, GROUP_UPDATE_STREAMING, isLevelPack=true'
  classification='EXPERIMENTAL_BINARY_UNVERIFIED_IN_GTA'
  onigiriDlclistLine='<Item>dlcpacks:/lsa_destruction_lab/</Item>'
  note='Does NOT install; local CodeWalker binary reload and Enhanced map DLC mount required.'
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $OutputDir 'pack-receipt.json')
Write-Host "Generated experimental binary/pack: $packFile. NOT INSTALLED; GTA verification required."
