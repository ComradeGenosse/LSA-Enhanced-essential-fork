param([Parameter(Mandatory)][string]$CodeWalker)
$ErrorActionPreference='Stop'
foreach($dll in 'SharpDX.dll','SharpDX.Mathematics.dll','CodeWalker.Core.dll'){
    $null=[Reflection.Assembly]::LoadFrom((Join-Path $CodeWalker $dll))
}
[CodeWalker.GameFiles.RpfManager]::IsGen9=$true
$assets=Join-Path $PSScriptRoot 'assets'
$manifest=Get-Content (Join-Path $assets 'models.json') -Raw | ConvertFrom-Json
$pack=if($manifest.layout -eq 'grid6x5'){'lsa_x7a'}elseif($manifest.layout -eq 'torn36'){'lsa_x7b'}elseif($manifest.layout -eq 'walk5'){'lsa_x7c'}else{throw 'Invalid layout'}
$count=if($manifest.layout -eq 'grid6x5'){31}elseif($manifest.layout -eq 'torn36'){37}else{6}
$receipt=@()
foreach($model in $manifest.allowlist){
    $xml=Join-Path $assets ($model+'.yft.xml')
    if(-not(Test-Path -LiteralPath $xml)){throw "Missing real exported XML: $xml"}
    $source=[IO.File]::ReadAllText($xml)
    $frag=[CodeWalker.GameFiles.XmlYft]::GetYft($source,$assets)
    $frag.Fragment.EnsureGen9()
    $data=$frag.Save()
    if([BitConverter]::ToUInt32($data,4) -ne 171){throw "Not GEN9 YFT: $model"}
    $verify=[CodeWalker.GameFiles.YftFile]::new();$verify.Load($data)
    if(-not $verify.Loaded -or $verify.Fragment.Drawable.Skeleton.BonesCount -ne $count){throw "YFT reload/bone failure: $model"}
    $out=Join-Path $assets ($model+'.yft')
    [IO.File]::WriteAllBytes($out,$data)
    $receipt+=@{name=$model;version=171;bones=$count;sha256=(Get-FileHash $out).Hash}
}
[xml]$typ=[IO.File]::ReadAllText((Join-Path $assets ($pack+'.ytyp.xml')))
if($typ.CMapTypes.archetypes.Item.Count -ne @($manifest.allowlist).Count){throw 'YTYP archetype count mismatch'}
# CodeWalker's own XML meta converter, not a synthetic placeholder binary.
$bytes=[CodeWalker.GameFiles.XmlMeta]::GetRSCData($typ)
if(-not $bytes -or $bytes.Length -lt 128){throw 'CodeWalker YTYP XML conversion failed'}
$ytyp=Join-Path $assets ($pack+'.ytyp')
[IO.File]::WriteAllBytes($ytyp,$bytes)
$loaded=[CodeWalker.GameFiles.YtypFile]::new();$loaded.Load($bytes)
if(-not $loaded.Loaded){throw 'CodeWalker YTYP reload failed'}
@{writer='CodeWalker dev48: XmlYft EnsureGen9 and XmlMeta.GetRSCData';
   ytyp=$pack;archetypes=@($manifest.allowlist).Count;ytypSha256=(Get-FileHash $ytyp).Hash;models=$receipt;
   source='actual Windows conversion; GTA runtime acceptance still pending'} |
   ConvertTo-Json -Depth 8 | Set-Content (Join-Path $assets 'conversion-receipt.json')
Write-Host "Converted and reloaded $($receipt.Count) real GEN9 twins; runtime not verified"
