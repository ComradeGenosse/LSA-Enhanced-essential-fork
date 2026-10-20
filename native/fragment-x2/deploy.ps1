param([Parameter(Mandatory)][string]$GameRoot,[Parameter(Mandatory)][string]$BackupRoot)
$ErrorActionPreference='Stop'
if(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue){throw 'Close GTA/RPH using the existing GT4 stop helper before deployment'}
if(-not(Test-Path (Join-Path $GameRoot 'onigiri.asi'))){throw 'Existing Onigiri installation required'}
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$script=Join-Path $GameRoot 'scripts/WpsBreachLab.3.cs'
$list=Join-Path $GameRoot 'onigiri/common/data/dlclist.xml'
foreach($item in @(@($script,'WpsBreachLab.3.cs'),@($list,'dlclist.xml'))){$dest=Join-Path $BackupRoot $item[1];if(-not(Test-Path $dest)){Copy-Item -LiteralPath $item[0] -Destination $dest}}
$pack=Join-Path $GameRoot 'onigiri/dlcpacks/lsa_destruct'
New-Item -ItemType Directory -Path $pack -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'pack/dlc.rpf') -Destination (Join-Path $pack 'dlc.rpf') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'WpsBreachLab.3.cs') -Destination $script -Force
$xml=[IO.File]::ReadAllText($list)
if($xml -notmatch 'dlcpacks:/lsa_destruct/'){$xml=$xml.Replace('</Paths>','    <Item>dlcpacks:/lsa_destruct/</Item>'+[Environment]::NewLine+'</Paths>');[xml]$check=$xml;[IO.File]::WriteAllText($list,$xml,[Text.UTF8Encoding]::new($false))}
Get-FileHash $script,(Join-Path $pack 'dlc.rpf'),$list | ConvertTo-Json | Set-Content (Join-Path $BackupRoot 'deployment.json')
