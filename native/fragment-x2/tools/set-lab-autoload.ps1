param([Parameter(Mandatory)][string]$GameRoot,[Parameter(Mandatory)][string]$BackupRoot,[ValidateSet('Isolate','Restore')][string]$Mode='Isolate')
$ErrorActionPreference='Stop'
$shutdownDeadline=[DateTime]::UtcNow.AddSeconds(15)
while((Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $shutdownDeadline){Start-Sleep -Milliseconds 500}
if(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue){throw 'Stop GTA/RPH before changing the SHVDN loader'}
$ini=Join-Path $GameRoot 'ScriptHookVDotNet.ini'
$original=Join-Path $BackupRoot 'ScriptHookVDotNet.ini.original'
$state=Join-Path $BackupRoot 'shvdn-isolation.json'
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
if($Mode -eq 'Restore'){
 $s=Get-Content $state -Raw | ConvertFrom-Json
 $current=(Get-FileHash $ini).Hash
 if($current -ne $s.isolatedSha256 -and $current -ne $s.originalSha256){throw 'Loader changed externally; refusing to overwrite it'}
 if((Get-FileHash $original).Hash -ne $s.originalSha256){throw 'Original backup hash mismatch'}
 Copy-Item -LiteralPath $original -Destination $ini -Force
 Write-Output 'Original SHVDN loader restored exactly.'
 exit
}
if(-not(Test-Path $original)){Copy-Item -LiteralPath $ini -Destination $original}
if(Test-Path $state){
 $s=Get-Content $state -Raw | ConvertFrom-Json
 if((Get-FileHash $ini).Hash -notin @($s.originalSha256,$s.isolatedSha256)){throw 'Loader changed externally; refusing to overwrite it'}
}
$text=[IO.File]::ReadAllText($ini)
if($text -notmatch '(?m)^AutoLoadScripts=(true|false)\s*$'){throw 'Expected one explicit AutoLoadScripts setting'}
$text=[regex]::Replace($text,'(?m)^AutoLoadScripts=(true|false)(\r?)$','AutoLoadScripts=false$2')
[IO.File]::WriteAllText($ini,$text,[Text.UTF8Encoding]::new($false))
@{originalSha256=(Get-FileHash $original).Hash;isolatedSha256=(Get-FileHash $ini).Hash;onlyChange='AutoLoadScripts=false'} | ConvertTo-Json | Set-Content $state
Write-Output 'AutoLoadScripts=false. After GTA loads, use SHVDN console Start("WpsBreachLab.3.cs"). Restore after testing.'
