param([Parameter(Mandatory)][string]$Staging,[Parameter(Mandatory)][string]$CodeWalkerRoot)
$ErrorActionPreference='Stop'
[void][Reflection.Assembly]::LoadFrom((Join-Path $CodeWalkerRoot 'CodeWalker.Core.dll'))
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$m=Get-Content (Join-Path $Staging 'manifest.json') -Raw | ConvertFrom-Json
$c=Get-Content (Join-Path $Staging 'candidates.json') -Raw | ConvertFrom-Json
$bounds=@{}
foreach($asset in $m.assets | Where-Object originalPath -like '*.ybn'){
 $y=[CodeWalker.GameFiles.YbnFile]::new()
 $y.Load([IO.File]::ReadAllBytes((Join-Path $Staging $asset.file)))
 if(!$y.Bounds){throw "Standalone YBN failed: $($asset.originalPath)"}
 $bounds[$asset.originalPath]=$y
}
function V($xyz){[SharpDX.Vector3]::new($xyz[0],$xyz[1],$xyz[2])}
function Cast($y,$from,$to){
 $a=V $from;$b=V $to;$d=$b-$a;$len=$d.Length();$d.Normalize()
 $ray=[SharpDX.Ray]::new($a,$d)
 $hit=$y.Bounds.RayIntersect([ref]$ray,$len)
 @{hit=$hit.Hit;distance=$hit.HitDist;position=@($hit.Position.X,$hit.Position.Y,$hit.Position.Z);materialIndex=[int]$hit.Material.Type.Index;complete=$hit.TestComplete}
}
$surfacePool=if($c.candidatePool){$c.candidatePool.surfaces}else{$c.surfaces}
$wallPool=if($c.candidatePool){$c.candidatePool.walls}else{$c.walls}
$surfaceResults=@(foreach($s in $surfacePool){
 $hit=Cast $bounds[$s.asset] $s.rayFrom $s.rayTo
 $delta=(V $hit.position)-(V $s.point)
 @{asset=$s.asset;bound=$s.bound;polygonIndex=$s.polygonIndex;hit=$hit;targetErrorM=$delta.Length();matchesTarget=($hit.hit -and $delta.Length() -lt .01 -and $hit.materialIndex -eq $s.materialIndex)}
})
$wallResults=@(foreach($w in $wallPool){
 $f=Cast $bounds[$w.asset] $w.rayFrom $w.rayTo
 $r=Cast $bounds[$w.asset] $w.rayTo $w.rayFrom
 $len=((V $w.rayTo)-(V $w.rayFrom)).Length()
 $thickness=if($f.hit -and $r.hit){$len-$f.distance-$r.distance}else{$null}
 $match=$null -ne $thickness -and [Math]::Abs($thickness-$w.encodedPrimitiveThicknessM) -lt .01 -and $f.materialIndex -eq $w.materialIndex -and $r.materialIndex -eq $w.materialIndex
 @{asset=$w.asset;bound=$w.bound;polygonIndex=$w.polygonIndex;forward=$f;reverse=$r;measuredOfflineRayThicknessM=$thickness;encodedPrimitiveThicknessM=$w.encodedPrimitiveThicknessM;matchesPrimitive=$match}
})
$chosenSurfaces=[Collections.Generic.List[object]]::new();$chosenWalls=[Collections.Generic.List[object]]::new()
for($i=0;$i -lt $surfacePool.Count -and $chosenSurfaces.Count -lt 30;$i++){
 if($surfaceResults[$i].matchesTarget){$chosenSurfaces.Add($surfacePool[$i])}
}
for($i=0;$i -lt $wallPool.Count -and $chosenWalls.Count -lt 10;$i++){
 if($wallResults[$i].matchesPrimitive){$chosenWalls.Add($wallPool[$i])}
}
$c.surfaces=@($chosenSurfaces);$c.walls=@($chosenWalls)
$c.counts.surfaceCandidates=$chosenSurfaces.Count;$c.counts.wallCandidates=$chosenWalls.Count
$c.counts.surfaceMaterialTypes=@($chosenSurfaces | Select-Object -ExpandProperty materialIndex -Unique).Count
$c.counts.wallMaterialTypes=@($chosenWalls | Select-Object -ExpandProperty materialIndex -Unique).Count
$c | Add-Member -NotePropertyName offlineSelection -NotePropertyValue 'Selected only after nearest-hit source-YBN ray and material match; walls additionally match forward/reverse thickness within 1 cm' -Force
$c | ConvertTo-Json -Depth 16 | Set-Content (Join-Path $Staging 'candidates.json') -Encoding utf8
$out=@{scope='OFFLINE_CODEWALKER_SINGLE_YBN_ONLY';nativeGtaStatus='NOT_TESTED';caveat='Tests each candidate against its own standalone YBN. Other streamed YBNs, embedded collisions, IPLs and mods can change the first hit.';standaloneYbnParsed=$bounds.Count;surfaceMatches=@($surfaceResults | Where-Object matchesTarget).Count;wallMatches=@($wallResults | Where-Object matchesPrimitive).Count;selectedSurfaces=$chosenSurfaces.Count;selectedWalls=$chosenWalls.Count;surfaces=$surfaceResults;walls=$wallResults}
$out | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $Staging 'offline-ray-verification.json') -Encoding utf8
Write-Host "Standalone YBNs=$($bounds.Count); matching surface rays=$($out.surfaceMatches)/$($surfacePool.Count); matching forward/reverse walls=$($out.wallMatches)/$($wallPool.Count); selected=$($chosenSurfaces.Count) surfaces/$($chosenWalls.Count) walls"
