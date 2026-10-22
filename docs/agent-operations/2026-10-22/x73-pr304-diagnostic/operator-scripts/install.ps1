$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot 'repo')
if(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue){throw 'Game must be stopped'}
Write-Output 'Using verified preflight snapshot'

$env:X7_VARIANT='x7d';$env:X7_PACK_DIR='pack-x7d';$env:X7_ASSETS_DIR='assets-x7d'
python native\fragment-x7\evidence\x72c\tools\x7_install.py install 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced' native\fragment-x7 ..\backup --disable-dlss-addons *> ..\..\outputs\install.txt
if($LASTEXITCODE -ne 0){throw 'Install failed; reconcile backup manifest'}
Copy-Item ..\backup\manifest.json ..\..\outputs\install-manifest.json
$m=Get-Content ..\backup\manifest.json -Raw | ConvertFrom-Json
foreach($r in $m.rows){if($r.before){if((Get-FileHash (Join-Path '..\backup' $r.backup)).Hash -ne $r.before){throw 'Backup hash mismatch'}}}
$installed=Get-FileHash 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced\scripts-x7\WpsBreachLabX7.3.cs'
if($installed.Hash -ne (Get-FileHash native\fragment-x7\WpsBreachLabX7.3.cs).Hash){throw 'Candidate mismatch'}
Write-Output ('INSTALLED verified hash '+$installed.Hash)


