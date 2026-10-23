param([string]$Pack='NVE_props_addon')
$ErrorActionPreference='Stop'
$cw='C:\Users\Chris.COMRADE\Documents\Codex\tools\CodeWalker30_dev48'
foreach($d in 'SharpDX.dll','SharpDX.Mathematics.dll','CodeWalker.Core.dll'){[void][Reflection.Assembly]::LoadFrom((Join-Path $cw $d))}
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$p="C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced\onigiri\dlcpacks\$Pack\dlc.rpf"
$r=[CodeWalker.GameFiles.RpfFile]::new($p,'dlc.rpf');$errors=[Collections.Generic.List[string]]::new()
$r.ScanStructure([Action[string]]{param($s)},[Action[string]]{param($s)$errors.Add($s)})
function Dump($r){
 foreach($e in $r.AllEntries){
 if($e.Name -in @('content.xml','setup2.xml')){[IO.File]::WriteAllBytes((Join-Path $PWD "outputs\$Pack-$($e.Name)"),$r.ExtractFile($e))}
 if($e.Name.EndsWith('.ymap')){
 $m=[CodeWalker.GameFiles.YmapFile]::new();$m.Load($r.ExtractFile($e),$e)
 [pscustomobject]@{archive=$r.Path;name=$e.Name;kind=$e.GetType().Name;version=$e.Version;flags=$m.CMapData.flags;contentFlags=$m.CMapData.contentFlags;entities=@($m.AllEntities).Count;first=@($m.AllEntities | Select-Object -First 3 | ForEach-Object { $v=$_.CEntityDef; [pscustomobject]@{hash=$v.archetypeName.Hash;x=$v.position.X;y=$v.position.Y;z=$v.position.Z;flags=$v.flags}})}
 }
 }
 foreach($child in $r.Children){Dump $child}
}
@(Dump $r) | ConvertTo-Json -Depth 8 | Set-Content "outputs\$Pack-maps.json"
$errors
