# Offline Windows installer smoke test. Never opens GTA or uses a real installation.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP ('e0-deploy-' + [guid]::NewGuid().ToString('N'))
if (-not $env:RUNNER_TEMP) { $root = Join-Path $env:TEMP ('e0-deploy-' + [guid]::NewGuid().ToString('N')) }
$game=Join-Path $root 'game';$artifact=Join-Path $root 'artifact'
New-Item -ItemType Directory -Path $game,$artifact -Force | Out-Null
try {
  Set-Content (Join-Path $game 'GTA5_Enhanced.exe') -Value 'dummy'
  Set-Content (Join-Path $game 'RAGEPluginHook.exe') -Value 'dummy'
  $lab=Join-Path $artifact 'LSA.WPS.Lab.dll'
  Set-Content $lab -Value 'offline dummy lab'
  $hash=(Get-FileHash $lab -Algorithm SHA256).Hash.ToLowerInvariant()
  @{pluginSha256=$hash} | ConvertTo-Json | Set-Content (Join-Path $artifact 'BUILD-RECEIPT.json')
  Copy-Item (Join-Path $PSScriptRoot '..\..\..\native\physics-e0\LSA.WPS.Lab.example.json') (Join-Path $artifact 'LSA.WPS.Lab.example.json')
  $surface=@{label='mock';expectedMaterial='CONCRETE';materialIndex=1;ax=440;ay=-980;az=30;bx=442;by=-980;bz=30;expectedThicknessM=0}
  $wall=@{label='mock-wall';expectedMaterial='CONCRETE';materialIndex=1;ax=440;ay=-980;az=30;bx=442;by=-980;bz=30;expectedThicknessM=.2}
  $data=@{schemaVersion=1;surfaces=@(1..30|ForEach-Object{$surface});walls=@(1..10|ForEach-Object{$wall})}
  $samplePath=Join-Path $root 'private.json'
  $data | ConvertTo-Json -Depth 8 | Set-Content $samplePath
  & (Join-Path $PSScriptRoot '..\install-pre-shot.ps1') -GameRoot $game -ArtifactDirectory $artifact -PrivateSamples $samplePath | Out-Null
  $cfg=Get-Content (Join-Path $game 'Plugins\LSA.WPS.Lab.json') -Raw | ConvertFrom-Json
  if (-not $cfg.enabled -or -not $cfg.autoRunPreShot -or -not $cfg.autoTeleportForSamples) {throw 'Auto installation settings missing'}
  foreach($p in @('permitExplosion','permitBullet','permitIpl','permitHide','permitTimeScale')){
    if($cfg.$p){throw "Unsafe permit unexpectedly enabled: $p"}
  }
  $installed=(Get-FileHash (Join-Path $game 'Plugins\LSA.WPS.Lab.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
  if($installed -ne $hash){throw 'Wrong installed DLL'}
  Write-Output 'PASS: offline install validates hash, copies private samples, enables opt-in teleport and disables destructive permits'
}
finally {if(Test-Path $root){Remove-Item $root -Force -Recurse}}
