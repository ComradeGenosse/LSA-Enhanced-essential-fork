param([Parameter(Mandatory)][string]$CodeWalker)
$ErrorActionPreference='Stop'
[Reflection.Assembly]::LoadFrom((Join-Path $CodeWalker 'CodeWalker.Core.dll')) | Out-Null
$out=Join-Path $PSScriptRoot 'pack'
$path=Join-Path $out 'dlc.rpf'
if(Test-Path -LiteralPath $path){Move-Item -LiteralPath $path -Destination ($path+'.previous-'+[DateTime]::UtcNow.Ticks)}
$r=[CodeWalker.GameFiles.RpfFile]::CreateNew($out,'dlc.rpf',[CodeWalker.GameFiles.RpfEncryption]::OPEN)
foreach($name in 'content.xml','setup2.xml'){$null=[CodeWalker.GameFiles.RpfFile]::CreateFile($r.Root,$name,[IO.File]::ReadAllBytes((Join-Path $out $name)),$true)}
$x64=[CodeWalker.GameFiles.RpfFile]::CreateDirectory($r.Root,'x64')
$inner=[CodeWalker.GameFiles.RpfFile]::CreateNew($x64,'lsa_destruct.rpf',[CodeWalker.GameFiles.RpfEncryption]::OPEN)
foreach($name in 'lsa_x2_concrete.yft','lsa_x2.ytyp'){$null=[CodeWalker.GameFiles.RpfFile]::CreateFile($inner.Root,$name,[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot ('assets/'+$name))),$true)}
Get-FileHash -LiteralPath $path
