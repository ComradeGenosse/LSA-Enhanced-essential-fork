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
if(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue){
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
$pack='lsa_destruction_lab'
$prefix='dlc_lsa_destruction_lab:/%PLATFORM%/levels/gta5/lsa_destruction_lab_metadata.rpf'
$contents=@"
<?xml version="1.0" encoding="UTF-8"?>
<CDataFileMgr__ContentsOfDataFileXml><disabledFiles/><includedXmlFiles/><includedDataFiles/>
<dataFiles>
<Item><filename>$prefix</filename><fileType>RPF_FILE</fileType><locked value="true"/><loadCompletely value="true"/><overlay value="false"/><disabled value="true"/><persistent value="true"/><contents>CONTENTS_DLC_MAP_DATA</contents></Item>
<Item><filename>$prefix/lsa_destruction_lab.ymap</filename><fileType>MAP_DATA</fileType><locked value="true"/><disabled value="true"/><persistent value="true"/></Item>
</dataFiles><contentChangeSets>
<Item><changeSetName>LSA_DESTRUCTION_LAB_STREAMING</changeSetName><filesToEnable><Item>$prefix</Item><Item>$prefix/lsa_destruction_lab.ymap</Item></filesToEnable>
<executionConditions><activeChangesetConditions/><genericConditions>&#36;level=MO_JIM_L11</genericConditions></executionConditions></Item>
</contentChangeSets><patchFiles/></CDataFileMgr__ContentsOfDataFileXml>
"@
$setup=@"
<?xml version="1.0" encoding="UTF-8"?>
<SSetupData><deviceName>dlc_$pack</deviceName><datFile>content.xml</datFile><nameHash>$pack</nameHash><contentChangeSetGroups><Item><NameHash>GROUP_STARTUP</NameHash><ContentChangeSets><Item>LSA_DESTRUCTION_LAB_STREAMING</Item></ContentChangeSets></Item></contentChangeSetGroups><startupScript/><scriptCallstackSize value="0"/><type>EXTRACONTENT_LEVEL_PACK</type><order value="100"/><minorOrder value="0"/><isLevelPack value="false"/><dependencyPackHash/><requiredVersion/><subPackCount value="0"/></SSetupData>
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
$levels=[CodeWalker.GameFiles.RpfFile]::CreateDirectory($x64,'levels')
$gta5=[CodeWalker.GameFiles.RpfFile]::CreateDirectory($levels,'gta5')
$inner=[CodeWalker.GameFiles.RpfFile]::CreateNew($gta5,'lsa_destruction_lab_metadata.rpf',[CodeWalker.GameFiles.RpfEncryption]::OPEN)
$null=[CodeWalker.GameFiles.RpfFile]::CreateFile($inner.Root,'lsa_destruction_lab.ymap',$mapBytes,$true)
$packFile=Join-Path $OutputDir 'dlc.rpf'
if(-not(Test-Path $packFile)){throw 'CodeWalker did not create DLC RPF'}
[ordered]@{
  pack='lsa_destruction_lab'
  map='lsa_destruction_lab.ymap'
  mapSha256=(Get-FileHash $binary -Algorithm SHA256).Hash
  dlcSha256=(Get-FileHash $packFile -Algorithm SHA256).Hash
  sourceSha256=[string]$manifest.sourceSha256
  sourceEvidence=[string]$manifest.evidence
  classification='EXPERIMENTAL_BINARY_UNVERIFIED_IN_GTA'
  onigiriDlclistLine='<Item>dlcpacks:/lsa_destruction_lab/</Item>'
  note='Does NOT install; local CodeWalker binary reload and Enhanced map DLC mount required.'
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $OutputDir 'pack-receipt.json')
Write-Host "Generated experimental binary/pack: $packFile. NOT INSTALLED; GTA verification required."
