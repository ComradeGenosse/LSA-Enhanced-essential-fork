param([Parameter(Mandatory)][string]$CodeWalker)
$ErrorActionPreference='Stop'
foreach($dll in 'SharpDX.dll','SharpDX.Mathematics.dll','CodeWalker.Core.dll'){$null=[Reflection.Assembly]::LoadFrom((Join-Path $CodeWalker $dll))}
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$assets=Join-Path $PSScriptRoot 'assets'
$fragment=[CodeWalker.GameFiles.XmlYft]::GetYft([IO.File]::ReadAllText((Join-Path $assets 'lsa_x6_corrugated.yft.xml')),$assets)
$fragment.Fragment.EnsureGen9()
$data=$fragment.Save()
if([BitConverter]::ToUInt32($data,4) -ne 171){throw 'CodeWalker did not write GEN9 YFT'}
$verify=[CodeWalker.GameFiles.YftFile]::new();$verify.Load($data)
if(-not $verify.Loaded -or $verify.Fragment.Drawable.Skeleton.BonesCount -ne 31){throw 'GEN9 binary reload validation failed'}
[IO.File]::WriteAllBytes((Join-Path $assets 'lsa_x6_corrugated.yft'),$data)
@{writer='CodeWalker 30_dev48 XmlYft -> EnsureGen9 -> Save';version=171;loaded=$verify.Loaded;bones=$verify.Fragment.Drawable.Skeleton.BonesCount} | ConvertTo-Json | Set-Content (Join-Path $assets 'binary-writer.json')
