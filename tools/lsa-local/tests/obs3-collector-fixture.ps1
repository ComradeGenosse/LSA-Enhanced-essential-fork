#requires -Version 5.1
$ErrorActionPreference='Stop'
$collector=Join-Path $PSScriptRoot '..\Collect-Logs.ps1'
$temp=Join-Path ([IO.Path]::GetTempPath()) ('lsa-obs3-test-'+[guid]::NewGuid().ToString('N'))
$game=Join-Path $temp 'GTA'
$companion=Join-Path $temp 'companion'
$out=Join-Path $temp 'out'
$missing=Join-Path $temp 'missing-log-root'
$run='11111111-1111-4111-8111-111111111111'
try {
  New-Item -ItemType Directory -Path $game,$companion,$out,(Join-Path $game 'Plugins') -Force|Out-Null
  Set-Content -LiteralPath (Join-Path $game 'RagePluginHook.log') -Value '[P2 OBS1] control_channel_failure code=admission_denied'
  Set-Content -LiteralPath (Join-Path $game 'Plugins/LosSantosAlive.dll') -Value 'test-native-binary'
  Set-Content -LiteralPath (Join-Path $game 'e1.config.json') -Value '{"reasoningKey":"NEVER_INCLUDE_THIS_SECRET"}'
  Set-Content -LiteralPath (Join-Path $game 'build-manifest.json') -Value '{"builtBundleSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reasoningKey":"NEVER_INCLUDE_THIS_SECRET"}'
  Set-Content -LiteralPath (Join-Path $companion ('obs2-inventory-'+$run+'.jsonl')) -Value ('{"kind":"obs2_system_inventory","schemaVersion":1,"runId":"'+$run+'","systems":[]}')
  Set-Content -LiteralPath (Join-Path $companion ('e1-run-20261018T190000Z-'+$run+'.jsonl')) -Value ('{"runId":"'+$run+'","sequence":1,"event":"run_started"}')
  $cfg=@{
    GamePath=$game
    ExtraLogRoots=@($companion,$missing)
    LogSearchRoots=@()
    LogOutputRoot=$out
    PackageRoot='packages'
    CurrentStandalonePackage=''
  }
  $config=Join-Path $temp 'lsa-tools.json'
  $cfg|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $config -Encoding UTF8
  $result=& $collector -ConfigPath $config
  if(-not $result.Zip -or -not(Test-Path -LiteralPath $result.Zip)){throw 'OBS3 collector produced no ZIP'}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($result.Zip)
  try {
    $names=@($zip.Entries|ForEach-Object FullName)
    foreach($required in @('collection.json','inventory.csv','build-evidence.json')){
      if($names -notcontains $required){throw "Missing evidence document $required"}
    }
    if(-not($names|Where-Object{$_ -like '*obs2-inventory-*'})){throw 'OBS2 inventory absent'}
    if(-not($names|Where-Object{$_ -like '*e1-run-*'})){throw 'E1 run telemetry absent'}
    if($names|Where-Object{$_ -like '*e1.config.json' -or $_ -like '*build-manifest.json'}){
      throw 'Private config or full build manifest collected'
    }
    $folder=$result.Zip.Substring(0, $result.Zip.Length - 4)
    $manifest=Join-Path $folder 'build-evidence.json'
    $text=Get-Content -LiteralPath $manifest -Raw
    if($text.Contains('NEVER_INCLUDE_THIS_SECRET')){throw 'Sensitive build metadata leaked'}
    $deployment=$text|ConvertFrom-Json
    if(@($deployment.DeployedDllCandidates).Count -lt 1){throw 'Present plugin not identified'}
    $collection=Get-Content -LiteralPath (Join-Path $folder 'collection.json') -Raw|ConvertFrom-Json
    if(@($collection.MissingRoots).Count -ne 1){throw 'Missing root not accounted for'}
    if(@($collection.DetectedRuns) -notcontains $run){throw 'Session correlation IDs not collected'}
    if($collection.Files -lt 3){throw 'Insufficient fixture logs collected'}
    Write-Host ('OBS3 collector smoke passed. Files='+$collection.Files+'; Run='+$run)
  } finally { $zip.Dispose() }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
,''
    $manifest=Join-Path $folder 'build-evidence.json'
    $text=Get-Content -LiteralPath $manifest -Raw
    if($text.Contains('NEVER_INCLUDE_THIS_SECRET')){throw 'Sensitive build metadata leaked'}
    $deployment=$text|ConvertFrom-Json
    if(@($deployment.DeployedDllCandidates).Count -lt 1){throw 'Present plugin not identified'}
    $collection=Get-Content -LiteralPath (Join-Path $folder 'collection.json') -Raw|ConvertFrom-Json
    if(@($collection.MissingRoots).Count -ne 1){throw 'Missing root not accounted for'}
    if(@($collection.DetectedRuns) -notcontains $run){throw 'Session correlation IDs not collected'}
    if($collection.Files -lt 3){throw 'Insufficient fixture logs collected'}
    Write-Host ('OBS3 collector smoke passed. Files='+$collection.Files+'; Run='+$run)
  } finally { $zip.Dispose() }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
