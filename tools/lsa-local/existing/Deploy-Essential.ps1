param([string]$SourcePath,[string]$GamePath,[string]$BackupRoot,[string]$ExpectedRevision)
$ErrorActionPreference='Stop'
$repo=$SourcePath
$dist=Join-Path $repo 'lsa-essential-e1-candidate/dist'
$install=Join-Path $GamePath 'Plugins'
$output=Join-Path $BackupRoot 'receipts'
$sha=(git -C $repo rev-parse HEAD).Trim()
if($sha -ne $ExpectedRevision){throw 'Unexpected revision'}
$proof=Get-Content -LiteralPath (Join-Path $dist 'plugins/LosSantosAliveServer/build-manifest.json') -Raw | ConvertFrom-Json
if($proof.dialogueKnowledgeContract.available -ne $true){throw 'PS4 knowledge build proof missing'}
if(Get-Process -Name GTA5,GTA5_Enhanced,RagePluginHook -ErrorAction SilentlyContinue){throw 'Game is running'}
foreach($proc in Get-CimInstance Win32_Process -Filter "Name='node.exe'"){
 if(!$proc.ExecutablePath -or $proc.ExecutablePath.StartsWith($install,[StringComparison]::OrdinalIgnoreCase) -or $proc.CommandLine -match 'LosSantosAlive|server.bundle.mjs'){throw 'LSA companion may be running'}
}
$maps=@()
$server=Join-Path $dist 'plugins/LosSantosAliveServer'
foreach($file in Get-ChildItem -LiteralPath $server -Recurse -File){
 $rel=$file.FullName.Substring($server.Length+1)
 if($rel -eq 'e1.config.example.json'){continue}
 $maps+= [pscustomobject]@{Source=$file.FullName;Relative=('LosSantosAliveServer/'+$rel)}
}
foreach($name in @('LSA.PromotedCharacters.dll','LSA.PromotedCharacters.Bootstrap.dll','LSA.PromotedCharacters.Runtime.dll','LSA.SessionIdentity.dll','build-manifest.json')){
 $rel=if($name -eq 'LSA.PromotedCharacters.dll'){$name}else{'LSA.PromotedCharacters/'+$name}
 $maps+=[pscustomobject]@{Source=(Join-Path $dist ('promoted-characters/'+$name));Relative=$rel}
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backup=Join-Path $BackupRoot ('main-'+$stamp+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
$changes=@()
foreach($m in $maps){
 $hash=(Get-FileHash -LiteralPath $m.Source -Algorithm SHA256).Hash
 $target=[IO.Path]::GetFullPath((Join-Path $install $m.Relative))
 if(!$target.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid target'}
 $exists=Test-Path -LiteralPath $target
 $old=if($exists){(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash}else{$null}
 if($old -eq $hash){continue}
 $saved=Join-Path $backup $m.Relative
 if($exists){New-Item -ItemType Directory -Force -Path (Split-Path $saved) | Out-Null; Copy-Item -LiteralPath $target -Destination $saved; if((Get-FileHash -LiteralPath $saved).Hash -ne $old){throw 'Backup mismatch'}}
 $changes+=[pscustomobject]@{Source=$m.Source;Target=$target;Relative=$m.Relative;Hash=$hash;OldHash=$old;Backup=$saved;Existed=$exists}
}
try{
 foreach($m in $changes){New-Item -ItemType Directory -Force -Path (Split-Path $m.Target) | Out-Null; Copy-Item -LiteralPath $m.Source -Destination $m.Target -Force}
 foreach($m in $maps){if((Get-FileHash -LiteralPath $m.Source).Hash -ne (Get-FileHash -LiteralPath (Join-Path $install $m.Relative)).Hash){throw ('Installed mismatch '+$m.Relative)}}
}catch{
 foreach($m in $changes){if($m.Existed){Copy-Item -LiteralPath $m.Backup -Destination $m.Target -Force}else{Remove-Item -LiteralPath $m.Target -Force -ErrorAction SilentlyContinue}}
 throw
}
New-Item -ItemType Directory -Force -Path $output | Out-Null
[ordered]@{Status='installed-and-hash-verified';Revision=$sha;DialogueKnowledgeAvailable=$proof.dialogueKnowledgeContract.available;InstalledAt=(Get-Date).ToString('o');Backup=$backup;VerifiedFiles=$maps.Count;ChangedFiles=$changes.Count;Preserved='Existing credentials, configuration, character data and logs';GtaTested=$false;Files=@($maps | ForEach-Object { @{Path=$_.Relative;SHA256=(Get-FileHash -LiteralPath $_.Source).Hash} })} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'lsa-main-deployment.json')
"Deployed $sha; verified $($maps.Count) files; changed $($changes.Count); backup $backup"
