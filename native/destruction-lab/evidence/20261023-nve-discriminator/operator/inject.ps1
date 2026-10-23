$ErrorActionPreference='Stop'
$cw='C:\Users\Chris.COMRADE\Documents\Codex\tools\CodeWalker30_dev48'
foreach($d in 'SharpDX.dll','SharpDX.Mathematics.dll','CodeWalker.Core.dll'){[void][Reflection.Assembly]::LoadFrom((Join-Path $cw $d))}
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$src='C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced\onigiri\dlcpacks\NVE_props_addon\dlc.rpf'
$dest=Join-Path $PWD 'work\nve-discriminator\candidate-verified\dlc.rpf'
if(Test-Path $dest){throw 'Fresh candidate required'}
New-Item -ItemType Directory (Split-Path $dest) | Out-Null
Copy-Item -LiteralPath $src -Destination $dest
function Open-Rpf($p){$r=[CodeWalker.GameFiles.RpfFile]::new($p,'dlc.rpf');$r.ScanStructure([Action[string]]{param($s)},[Action[string]]{param($s)throw $s});return $r}
function Digest([byte[]]$bytes){$sha=[Security.Cryptography.SHA256]::Create();return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}
function Inventory($r){foreach($e in $r.AllEntries){if($e -is [CodeWalker.GameFiles.RpfFileEntry] -and -not $e.Name.EndsWith('.rpf')){[pscustomobject]@{path=($r.Path+'/'+$e.Name);hash=(Digest ($r.ExtractFile($e)));kind=$e.GetType().Name;version=$(if($e -is [CodeWalker.GameFiles.RpfResourceFileEntry]){$e.Version}else{0})}}};foreach($c in $r.Children){Inventory $c}}
$r=Open-Rpf $dest
$before=@(Inventory $r)
$c=@($r.Children | Where-Object Name -eq 'city_props.rpf');if($c.Count -ne 1){throw 'Working archive not unique'};$c=$c[0]
if(@($c.AllEntries | Where-Object Name -eq 'lsa_destruction_lab.ymap').Count){throw 'Identity collision'}
$entry=@($c.AllEntries | Where-Object Name -eq '_manifest.ymf');if($entry.Count -ne 1){throw 'Manifest not unique'}
$m=[CodeWalker.GameFiles.YmfFile]::new();$m.Load($c.ExtractFile($entry[0]),$entry[0]);$fn='';[xml]$xml=[CodeWalker.GameFiles.MetaXml]::GetXml($m,[ref]$fn)
$originalXml=$xml.OuterXml
[xml]$lab=[IO.File]::ReadAllText((Join-Path $PWD 'work\story-map-pack\_manifest.ymf.xml'))
$node=$xml.ImportNode($lab.CPackFileMetaData.imapDependencies_2.Item,$true)
[void]$xml.CPackFileMetaData.imapDependencies_2.AppendChild($node)
$bytes=[CodeWalker.GameFiles.XmlMeta]::GetPSOData($xml)
[void][CodeWalker.GameFiles.RpfFile]::CreateFile($c.Root,'_manifest.ymf',$bytes,$true)
$labBytes=[IO.File]::ReadAllBytes((Join-Path $PWD 'work\story-map-pack\lsa_destruction_lab.ymap'))
[void][CodeWalker.GameFiles.RpfFile]::CreateFile($c.Root,'lsa_destruction_lab.ymap',$labBytes,$true)
$check=Open-Rpf $dest;$after=@(Inventory $check)
$lookup=@{};foreach($i in $after){$lookup[$i.path]=$i}
$manifestChanged=@();foreach($i in $before){if(-not $lookup.ContainsKey($i.path)){throw "Lost entry $($i.path)"};if($i.hash -ne $lookup[$i.path].hash){$manifestChanged+=$i.path}}
if($manifestChanged.Count -ne 1 -or $manifestChanged[0] -ne 'dlc.rpf\x64\city_props.rpf/_manifest.ymf'){throw ('Unexpected changed entries '+($manifestChanged -join ','))}
if($after.Count -ne $before.Count+1){throw 'Unexpected entry count'}
$c=@($check.Children | Where-Object Name -eq 'city_props.rpf')[0]
$e=@($c.AllEntries | Where-Object Name -eq 'lsa_destruction_lab.ymap')[0]
if($e -isnot [CodeWalker.GameFiles.RpfResourceFileEntry] -or $e.Version -ne 2){throw 'Wrong resource index'}
$baseline=Open-Rpf (Join-Path $PWD 'work\story-map-pack\dlc.rpf')
$bc=@($baseline.Children | Where-Object Name -eq 'lsa_destruction_lab.rpf')[0]
$be=@($bc.AllEntries | Where-Object Name -eq 'lsa_destruction_lab.ymap')[0]
if((Digest ($c.ExtractFile($e))) -ne (Digest ($bc.ExtractFile($be)))){throw 'Lab resource payload changed during injection'}
if($e.SystemFlags.ToString() -ne $be.SystemFlags.ToString() -or $e.GraphicsFlags.ToString() -ne $be.GraphicsFlags.ToString() -or $e.Version -ne $be.Version){throw 'Lab resource metadata changed'}
$map=[CodeWalker.GameFiles.YmapFile]::new();$map.Load($c.ExtractFile($e),$e);if(@($map.AllEntities).Count -ne 2 -or $map.CMapData.name.Hash -ne 3875619246){throw 'Map identity/entity mismatch'}
$me=@($c.AllEntries | Where-Object Name -eq '_manifest.ymf')[0];$m=[CodeWalker.GameFiles.YmfFile]::new();$m.Load($c.ExtractFile($me),$me);[xml]$verify=[CodeWalker.GameFiles.MetaXml]::GetXml($m,[ref]$fn)
$nodes=@($verify.CPackFileMetaData.imapDependencies_2.Item);$added=@($nodes | Where-Object imapName -eq 'lsa_destruction_lab');if($added.Count -ne 1){throw 'Missing lab dependency'}
[void]$verify.CPackFileMetaData.imapDependencies_2.RemoveChild($added[0]);if($verify.OuterXml -ne $originalXml){throw 'Original manifest semantics changed'}
[ordered]@{originalNveSha256=(Get-FileHash $src).Hash;candidateNveSha256=(Get-FileHash $dest).Hash;exactLabBinarySha256=(Digest $labBytes);exactPackedPayloadSha256=(Digest ($c.ExtractFile($e)));originalLeafEntries=$before.Count;candidateLeafEntries=$after.Count;changedExistingLeafEntries=$manifestChanged;allOtherOriginalEntryBytesPreserved=$true;originalManifestSemanticsPreserved=$true;labResourceKind=$e.GetType().Name;labResourceVersion=$e.Version;mapNameHash=$map.CMapData.name.Hash;entities=@($map.AllEntities).Count;standaloneLabMustBeAbsent=$true;redistributeNveBytes=$false} | ConvertTo-Json -Depth 5 | Set-Content outputs\nve-discriminator\injection-validation.json
$before | ConvertTo-Json -Depth 4 | Set-Content work\nve-discriminator\nve-before-private.json
$after | ConvertTo-Json -Depth 4 | Set-Content work\nve-discriminator\nve-after-private.json
