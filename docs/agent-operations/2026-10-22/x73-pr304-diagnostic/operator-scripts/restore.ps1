$ErrorActionPreference='Stop'
$g='C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'
for($i=0;$i -lt 30;$i++){if(-not(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue)){break};Start-Sleep -Seconds 1}
if(Get-Process GTA5_Enhanced,RAGEPluginHook -ErrorAction SilentlyContinue){throw 'Still running; no rollback'}
Set-Location (Join-Path $PSScriptRoot 'repo')
Copy-Item (Join-Path $g 'ScriptHookVDotNet.log') ..\..\outputs\shvdn-live.log
Copy-Item (Join-Path $g 'WpsBreachLab\controller.json') ..\..\outputs\controller-before-release.json
$env:X7_VARIANT='x7d';$env:X7_PACK_DIR='pack-x7d';$env:X7_ASSETS_DIR='assets-x7d'
python native\fragment-x7\evidence\x72c\tools\x7_install.py restore $g native\fragment-x7 ..\backup *> ..\..\outputs\restore-console.txt
if($LASTEXITCODE -ne 0){throw 'Rollback failed'}
Copy-Item ..\backup\restored.json ..\..\outputs\installer-restored.json
$rows=Get-Content ..\..\outputs\baseline.json -Raw | ConvertFrom-Json
foreach($r in $rows){$p=Join-Path $g $r.relative;$actual=if(Test-Path -LiteralPath $p){(Get-FileHash -LiteralPath $p).Hash}else{$null};$r.actual=$actual;$r.match=($actual -eq $r.expected);if(-not $r.match){throw ('Hash mismatch '+$p)}}
foreach($n in 'renodx-dlss.addon64.x72off','renodx-dlss-hotkey.addon64.x72off'){if(Test-Path -LiteralPath (Join-Path $g $n)){throw 'Temporary addon rename remains'}}
$rows | ConvertTo-Json -Depth 6 | Set-Content ..\..\outputs\filesystem-restoration.json
@{gtaStopped=$true;checkedUtc=[DateTime]::UtcNow.ToString('o');filesystem='PASS_4_HASHES_3_ABSENT';temporaryRenamesAbsent=$true} | ConvertTo-Json | Set-Content ..\..\outputs\shutdown.json
Write-Output 'GTA stopped; all four original file hashes and three original absences match; addon renames absent'
