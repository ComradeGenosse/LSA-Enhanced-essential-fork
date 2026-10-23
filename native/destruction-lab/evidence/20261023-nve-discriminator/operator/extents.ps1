$ErrorActionPreference='Stop'
$cw='C:\Users\Chris.COMRADE\Documents\Codex\tools\CodeWalker30_dev48'
foreach($d in 'SharpDX.dll','SharpDX.Mathematics.dll','CodeWalker.Core.dll'){[void][Reflection.Assembly]::LoadFrom((Join-Path $cw $d))}
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$yp='C:\Users\Chris.COMRADE\Documents\Codex\2026-10-19\lsa-physics-e0-extract-gta-asset\work\e0-assets\assets\x64i.rpf\levels\gta5\props\roadside\v_fences.rpf\v_fences.ytyp'
$t=[CodeWalker.GameFiles.YtypFile]::new();$t.Load([IO.File]::ReadAllBytes($yp))
$a=@($t.AllArchetypes | Where-Object { $_.Hash.Hash -eq 1185366416 })
if($a.Count -ne 1){throw 'Fence archetype not unique'}
$m=[CodeWalker.GameFiles.YmapFile]::new();$m.Load([IO.File]::ReadAllBytes((Join-Path $PWD 'work\story-map-pack\lsa_destruction_lab.ymap')))
$before=$m.CMapData
foreach($e in $m.AllEntities){$e.SetArchetype($a[0])}
$changed=$m.CalcExtents();$after=$m.CMapData
[ordered]@{archetypeSource=$yp;archetypeSha256=(Get-FileHash $yp).Hash;archetypeHash=$a[0].Hash;before=$before;after=$after;changed=$changed;entities=@($m.AllEntities | Select-Object Position,Orientation,BBMin,BBMax,BSRadius,LodDist,ChildLodDist)} | ConvertTo-Json -Depth 7 | Set-Content outputs\nve-discriminator\calculated-extents.json
$a[0] | Format-List Hash,BBMin,BBMax,BSRadius,LodDist
$m.AllEntities[0].GetType().GetProperties() | Select-Object Name

