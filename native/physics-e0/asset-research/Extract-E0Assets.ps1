<# Read-only CodeWalker dev48 Enhanced extraction. No game process or archive writes. #>
[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$GameRoot,
 [Parameter(Mandatory)][string]$CodeWalkerRoot,
 [Parameter(Mandatory)][string]$Destination
)
$ErrorActionPreference='Stop'
$GameRoot=(Resolve-Path -LiteralPath $GameRoot).Path.TrimEnd('\')
$CodeWalkerRoot=(Resolve-Path -LiteralPath $CodeWalkerRoot).Path
$Destination=[IO.Path]::GetFullPath($Destination)
if($Destination.StartsWith($GameRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Destination must be outside game installation'}
if(Test-Path -LiteralPath $Destination){throw 'Use a new empty staging path'}
[void][IO.Directory]::CreateDirectory($Destination)
[void][Reflection.Assembly]::LoadFrom((Join-Path $CodeWalkerRoot 'CodeWalker.Core.dll'))
[CodeWalker.GameFiles.GTA5Keys]::LoadFromPath($GameRoot,$true,$null)
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$errors=[Collections.Generic.List[string]]::new()
$m=[CodeWalker.GameFiles.RpfManager]::new()
$m.ExcludePaths=@('onigiri\','mods\')
$m.Init($GameRoot,$true,[Action[string]]{param($s)},[Action[string]]{param($s) $errors.Add($s)},$false,$false)
if($errors.Count){throw "Archive scan reported $($errors.Count) errors; refusing incomplete extraction"}
Write-Host "Scanned $($m.AllRpfs.Count) archives"
$selected=@{}
$reasons=@{}
function Select-Entry($e,[string]$reason){
 if(!$e){return}; $selected[$e.Path]=$e
 if(!$reasons.ContainsKey($e.Path)){$reasons[$e.Path]=[Collections.Generic.List[string]]::new()}
 if(!$reasons[$e.Path].Contains($reason)){$reasons[$e.Path].Add($reason)}
}
$maps=@{}
$neededArchetypes=[Collections.Generic.HashSet[uint32]]::new()
$mapByHash=@{}
$boundsByHash=@{}
foreach($e in $m.EntryDict.Values){
 if($e.Name.EndsWith('.ybn')){
  $h=[CodeWalker.GameFiles.JenkHash]::GenHash([IO.Path]::GetFileNameWithoutExtension($e.Name))
  if(!$boundsByHash.ContainsKey($h)){$boundsByHash[$h]=[Collections.Generic.List[object]]::new()};$boundsByHash[$h].Add($e)
 }
 if($e.Name -match '\.ymap$'){
  $h=[CodeWalker.GameFiles.JenkHash]::GenHash([IO.Path]::GetFileNameWithoutExtension($e.Name))
  if(!$mapByHash.ContainsKey($h)){$mapByHash[$h]=[Collections.Generic.List[object]]::new()};$mapByHash[$h].Add($e)
 }
 if($e.Name -match '^(hi@|ma@)?(hei_)?dt1_19.*\.ybn$' -or $e.Name -match '^(hei_)?dt1_19([_.].*)?\.ymap$' -or $e.Path -match '\\dt1_19\.rpf\\_manifest\.ymf$'){
  Select-Entry $e 'downtown dt1_19 police-hub block and patch variants'
 }
 if($e.Name -in @('materials.dat','material_override_pairs.dat') -or $e.Path -eq 'update\update.rpf\common\data\dlclist.xml'){
  Select-Entry $e 'material definitions or DLC mount list'
 }
}
# Follow YMAP parents and collect exact archetype/physics dictionary references.
do {
 $newMaps=@($selected.Values | Where-Object { $_.Name.EndsWith('.ymap') -and !$maps.ContainsKey($_.Path) })
 foreach($e in $newMaps){
  $map=[CodeWalker.GameFiles.YmapFile]::new();$map.Load($e.File.ExtractFile($e),$e);$maps[$e.Path]=$map
  foreach($ent in $map.CEntityDefs){[void]$neededArchetypes.Add($ent.archetypeName.Hash)}
  $parent=$map.CMapData.parent.Hash
  if($parent -and $mapByHash.ContainsKey($parent)){foreach($pe in $mapByHash[$parent]){Select-Entry $pe "YMAP parent of $($e.Path)"}}
  foreach($ph in $map.physicsDictionaries){
   if($boundsByHash.ContainsKey($ph.Hash)){foreach($be in $boundsByHash[$ph.Hash]){Select-Entry $be "physicsDictionary of $($e.Path)"}}
  }
 }
}while($newMaps.Count)
Write-Host "Resolving $($neededArchetypes.Count) archetype hashes from $($maps.Count) maps"
$resolved=[Collections.Generic.HashSet[uint32]]::new()
$typFailures=[Collections.Generic.List[object]]::new()
foreach($e in $m.EntryDict.Values | Where-Object { $_.Name.EndsWith('.ytyp') }){
 try{
  $typ=[CodeWalker.GameFiles.YtypFile]::new();$typ.Load($e.File.ExtractFile($e),$e)
  foreach($a in $typ.AllArchetypes){
   if($neededArchetypes.Contains($a.Hash)){Select-Entry $e 'contains a referenced archetype';[void]$resolved.Add($a.Hash)}
  }
 }catch{$typFailures.Add(@{path=$e.Path;error=$_.Exception.Message})}
}
# Include the mount definitions of any selected DLC container.
foreach($p in @($selected.Keys)){
 if($p -match '^(update\\x64\\dlcpacks\\[^\\]+\\dlc\.rpf)\\'){
  foreach($name in 'setup2.xml','content.xml'){Select-Entry $m.EntryDict[($Matches[1]+'\'+$name)] 'selected DLC mount metadata'}
 }
}
function Hash-Bytes([byte[]]$b){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($b)).ToLowerInvariant()}
function Write-Bytes([string]$rel,[byte[]]$b){$p=Join-Path $Destination $rel;[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p));[IO.File]::WriteAllBytes($p,$b)}
$receipts=[Collections.Generic.List[object]]::new()
$archives=@{}
$relationships=[Collections.Generic.List[object]]::new()
foreach($e in $selected.Values | Sort-Object Path){
 $data=$e.File.ExtractFile($e)
 if(!$data){throw "No payload for $($e.Path)"}
 $top=$e.File.GetTopParent()
 if(!$archives.ContainsKey($top.Path)){
  $fi=Get-Item -LiteralPath $top.FilePath
  $archives[$top.Path]=@{path=$top.Path;bytes=$fi.Length;lastWriteUtc=$fi.LastWriteTimeUtc.ToString('o');sha256=(Get-FileHash -LiteralPath $fi.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
 }
 $resource=$e -is [CodeWalker.GameFiles.RpfResourceFileEntry]
 $format='decoded binary payload'
 $flags=$null
 if($resource){
  $out=[CodeWalker.GameFiles.ResourceBuilder]::AddResourceHeader($e,[CodeWalker.GameFiles.ResourceBuilder]::Compress($data))
  $flags=@{version=$e.Version;system=$e.SystemFlags.Value;graphics=$e.GraphicsFlags.Value};$format='RSC7 header reconstructed from original entry flags; DEFLATE recompressed; decoded payload unchanged'
 }else{$out=$data}
 $rel='assets\'+$e.Path
 Write-Bytes $rel $out
 $xmlRel=$null;$xmlHash=$null;$xmlError=$null
 if($e.Name -match '\.(ybn|ymap|ytyp|ymf)$'){
  try{
   $xmlName='';$xml=[CodeWalker.GameFiles.MetaXml]::GetXml($e,$data,[ref]$xmlName,'')
   if(!$xml){throw 'CodeWalker returned empty XML'}
   $xmlRel='xml\'+$e.Path+'.xml';$xb=[Text.Encoding]::UTF8.GetBytes($xml);Write-Bytes $xmlRel $xb;$xmlHash=Hash-Bytes $xb
  }catch{$xmlError=$_.Exception.Message}
 }
 $storedHash=$null;$storedLen=$null;$offset=$null
 if($resource -and !$e.IsEncrypted){
  $offset=$e.File.StartPos+([long]$e.FileOffset*512);$storedLen=[int]$e.FileSize
  $stream=[IO.File]::OpenRead($top.FilePath)
  try{[void]$stream.Seek($offset,[IO.SeekOrigin]::Begin);$stored=[byte[]]::new($storedLen);$stream.ReadExactly($stored);$storedHash=Hash-Bytes $stored}finally{$stream.Dispose()}
 }
 $receipts.Add(@{originalPath=$e.Path;topArchive=$top.Path;reason=@($reasons[$e.Path]);file=$rel.Replace('\','/');bytes=$out.Length;sha256=(Hash-Bytes $out);decodedPayloadSha256=(Hash-Bytes $data);format=$format;resourceFlags=$flags;originalStoredEntrySha256=$storedHash;originalStoredEntryBytes=$storedLen;absoluteArchiveOffset=$offset;xml=$xmlRel;xmlSha256=$xmlHash;xmlError=$xmlError})
 if($maps.ContainsKey($e.Path)){
  $map=$maps[$e.Path]
  $relationships.Add(@{ymap=$e.Path;parentHash=$map.CMapData.parent.Hash;physicsDictionaryHashes=@($map.physicsDictionaries | ForEach-Object {$_.Hash});archetypeHashes=@($map.CEntityDefs | ForEach-Object {$_.archetypeName.Hash} | Sort-Object -Unique)})
 }
}
# Preserve loose mod material overrides separately; they are not Rockstar baseline evidence.
foreach($loosePath in @('onigiri\common\data\materials\materials.dat','onigiri\common\data\dlclist.xml')){
 $loose=Join-Path $GameRoot $loosePath
 if(Test-Path -LiteralPath $loose){
  $rel='overrides\'+$loosePath;$b=[IO.File]::ReadAllBytes($loose);Write-Bytes $rel $b
  $receipts.Add(@{originalPath=$loosePath;file=$rel.Replace('\','/');bytes=$b.Length;sha256=(Hash-Bytes $b);format='loose mod override; active precedence not verified';reason=@('installed override comparison')})
 }
}
$loaders=@(Get-ChildItem -LiteralPath $GameRoot -File | Where-Object {$_.Name -match '^(OpenRPF|onigiri).*\.(asi|dll)$'} | ForEach-Object {@{name=$_.Name;fileVersion=$_.VersionInfo.FileVersion;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant()}})
$exe=Get-Item -LiteralPath (Join-Path $GameRoot 'GTA5_Enhanced.exe')
$core=Get-Item -LiteralPath (Join-Path $CodeWalkerRoot 'CodeWalker.Core.dll')
$manifest=@{
 schemaVersion=1;createdUtc=[DateTime]::UtcNow.ToString('o');game=@{edition='Enhanced';exeVersion=$exe.VersionInfo.FileVersion;exeSha256=(Get-FileHash -LiteralPath $exe.FullName).Hash.ToLowerInvariant()};
 tool=@{name='CodeWalker';distribution='30_dev48';coreVersion=$core.VersionInfo.FileVersion;coreSha256=(Get-FileHash -LiteralPath $core.FullName).Hash.ToLowerInvariant();gen9=$true;powerShell=$PSVersionTable.PSVersion.ToString()};installedLoaders=$loaders;
 region=@{selection='dt1_19 police-hub block, plus YMAP parent closure and referenced YTYP definitions';coordinateSystem='Original GTA Cartesian coordinates, Z up, nominal metre units. No rebasing. YBN GeometryCenter, child CompositeTransform, and YMAP entity transforms retained in XML.'};
 status=@{archiveScanErrors=@($errors);archivesScanned=$m.AllRpfs.Count;archetypesRequired=$neededArchetypes.Count;archetypesResolved=$resolved.Count;unresolvedArchetypeHashes=@($neededArchetypes | Where-Object {!$resolved.Contains($_)});ytypScanFailures=@($typFailures);activeDlcIplAndModPrecedence='NOT_VERIFIED';nativeMaterialAndThicknessValidation='NOT_TESTED';embeddedDrawableFragmentCollision='not extracted; candidate analysis restricted to standalone world YBN geometry'};
 archives=@($archives.Values | Sort-Object path);assets=@($receipts);relationships=@($relationships)
}
$manifest | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $Destination 'manifest.json') -Encoding utf8
Write-Host "Extracted $($receipts.Count) assets; $($resolved.Count)/$($neededArchetypes.Count) referenced archetypes resolved"
