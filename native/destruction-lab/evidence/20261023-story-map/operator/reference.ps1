$fn=""
$ErrorActionPreference='Stop';$cw='C:\Users\Chris.COMRADE\Documents\Codex\tools\CodeWalker30_dev48'
foreach($d in 'SharpDX.dll','SharpDX.Mathematics.dll','CodeWalker.Core.dll'){[void][Reflection.Assembly]::LoadFrom((Join-Path $cw $d))}
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$r=[CodeWalker.GameFiles.RpfFile]::new('C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced\onigiri\dlcpacks\NVE_props_addon\dlc.rpf','dlc.rpf');$r.ScanStructure([Action[string]]{param($s)},[Action[string]]{param($s)throw $s})
$c=$r.Children | Where-Object Name -eq 'city_props.rpf'
foreach($n in 'rocks.ymap','_manifest.ymf'){
 $e=$c.AllEntries | Where-Object Name -eq $n
 if($n.EndsWith('.ymap')){$m=[CodeWalker.GameFiles.YmapFile]::new();$m.Load($c.ExtractFile($e),$e);$xml=[CodeWalker.GameFiles.MetaXml]::GetXml($m,[ref]$fn)}
 else{$m=[CodeWalker.GameFiles.YmfFile]::new();$m.Load($c.ExtractFile($e),$e);$xml=[CodeWalker.GameFiles.MetaXml]::GetXml($m,[ref]$fn)}
 [IO.File]::WriteAllText((Join-Path $PWD "work\reference-$n.xml"),$xml)
 $e | Format-List Name,Version,SystemFlags,GraphicsFlags,FileSize,FileUncompressedSize
}


