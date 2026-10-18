#requires -Version 5.1
param([string]$ConfigPath=(Join-Path $PSScriptRoot 'lsa-tools.json'))
$ErrorActionPreference='Stop'
$c=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
foreach($p in $c.PSObject.Properties){if($p.Value -is [string]){$p.Value=[Environment]::ExpandEnvironmentVariables($p.Value)}}
$c.ExtraLogRoots=@($c.ExtraLogRoots|ForEach-Object{[Environment]::ExpandEnvironmentVariables($_)})
$c.LogSearchRoots=@($c.LogSearchRoots|ForEach-Object{[Environment]::ExpandEnvironmentVariables($_)})
$out=if([IO.Path]::IsPathRooted($c.LogOutputRoot)){$c.LogOutputRoot}else{Join-Path $PSScriptRoot $c.LogOutputRoot}
$folder=Join-Path $out ('logs-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $folder -Force|Out-Null
$collectedUtc=[DateTime]::UtcNow.ToString('o')
# Record a sanitized origin for every configured root. Source numbers alone
# cannot identify missing paths after collection, and absolute paths are private.
$rootInputs=@()
if($c.GamePath){
  $rootInputs += [pscustomobject]@{Path=$c.GamePath;Kind='game';ConfigRef='GamePath';Required=$true}
}
for($i=0;$i<@($c.ExtraLogRoots).Count;$i++){
  $path=@($c.ExtraLogRoots)[$i]
  if($path){
    $rootInputs += [pscustomobject]@{Path=$path;Kind='extra';ConfigRef=('ExtraLogRoots['+$i+']');Required=$false}
  }
}
# Keep existing standalone companion discovery. Do not require a running browser.
foreach($search in @($c.LogSearchRoots)+@(Join-Path $PSScriptRoot $c.PackageRoot)){
  if($search -and (Test-Path -LiteralPath $search)){
    foreach($f in Get-ChildItem -LiteralPath $search -Filter 'Start-Standalone-Test.ps1' -File -Recurse){
      if(Test-Path -LiteralPath (Join-Path $f.DirectoryName 'companion/service.mjs')){
        $rootInputs += [pscustomobject]@{Path=(Join-Path $f.DirectoryName 'logs');
          Kind='standalone_discovered';ConfigRef='auto:standalone_test_logs';Required=$false}
      }
    }
  }
}
# Deduplicate by path, preferring the required game root if configured twice.
$rootByPath=@{}
foreach($info in $rootInputs){
  $key=[string]$info.Path
  if(-not $rootByPath.ContainsKey($key) -or $info.Required){$rootByPath[$key]=$info}
}
$rootInfos=@($rootByPath.Values|Sort-Object -Property Path)
$files=@();$errors=@();$index=0;$seen=@{};$sources=@();$missingRoots=@()
$runIds=New-Object 'System.Collections.Generic.HashSet[string]'
foreach($rootInfo in $rootInfos){
  $root=$rootInfo.Path
  $index++
  $label='source-'+$index
  if(-not(Test-Path -LiteralPath $root)){
    $missingRoots+=@{Id=$label;Status='missing';Kind=$rootInfo.Kind;ConfigRef=$rootInfo.ConfigRef;Required=$rootInfo.Required}
    $sources+=@{Id=$label;Status='missing';Files=0;Kind=$rootInfo.Kind;ConfigRef=$rootInfo.ConfigRef;Required=$rootInfo.Required}
    continue
  }
  $before=$files.Count
  $sources+=@{Id=$label;Status='available';Files=0;Kind=$rootInfo.Kind;ConfigRef=$rootInfo.ConfigRef;Required=$rootInfo.Required}
  try {
    $candidates=Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction Stop
  } catch {
    $errors+=@{Source=$label;ErrorCode='source_enumeration_failed'}
    $sources[$sources.Count-1].Status='unreadable'
    continue
  }
  foreach($f in $candidates){
    if($seen.ContainsKey($f.FullName)){continue}
    if($f.Name -notmatch '(?i)\.(log|jsonl|rcr|dmp|etl|trace)(\.\d+|\.gz|\.zip)?$|^crashreport$' -and
       -not($f.Extension -eq '.txt' -and $f.FullName -match '(?i)log')){continue}
    $seen[$f.FullName]=$true
    $relative=$label+'/'+$f.FullName.Substring($root.TrimEnd('\').Length+1)
    $target=Join-Path $folder $relative
    try {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force|Out-Null
      Copy-Item -LiteralPath $f.FullName -Destination $target
      $files+=[pscustomobject]@{File=$relative;Source=$label;SHA256=(Get-FileHash -LiteralPath $target).Hash}
      if($f.Name -match '^obs2-inventory-([a-f0-9-]{36})\.jsonl$' -or
         $f.Name -match '^e1-run-\d{8}T\d{6}Z-([a-f0-9-]{36})(-\d+)?\.jsonl$'){
        [void]$runIds.Add($Matches[1])
      }
    } catch {
      $errors+=@{File=$relative;ErrorCode=$_.Exception.GetType().Name}
    }
  }
  $sources[$sources.Count-1].Files=$files.Count-$before
}
# OBS3 build/deployment evidence is deliberately allowlisted. Never copy raw
# build manifests, personal config, credential files, databases or memory data.
$buildManifests=@();$dllCandidates=@()
$artifactDirs=@()
if($c.GamePath){$artifactDirs+=@{Path=$c.GamePath;Origin='game'}}
if($c.CurrentStandalonePackage){$artifactDirs+=@{Path=$c.CurrentStandalonePackage;Origin='package'}}
foreach($artifact in $artifactDirs){
  $lookups=@((Join-Path $artifact.Path 'build-manifest.json'),
             (Join-Path $artifact.Path 'e1/build-manifest.json'),
             (Join-Path $artifact.Path 'bundle/build-manifest.json'),
             (Join-Path $artifact.Path 'Plugins/LSA/build-manifest.json'))
  foreach($candidate in $lookups){
    if(-not(Test-Path -LiteralPath $candidate -PathType Leaf)){continue}
    try {
      $raw=Get-Content -LiteralPath $candidate -Raw|ConvertFrom-Json
      $entry=@{Origin=$artifact.Origin;ManifestSHA256=(Get-FileHash -LiteralPath $candidate).Hash}
      foreach($key in @('builtBundleSha256','e1SourceTreeSha256','releasePayloadSha256',
                         'upstreamBundleSha256','stockDllReferenceSha256')){
        $value=$raw.$key
        if($value -is [string] -and $value -match '^[a-fA-F0-9]{64}$'){$entry[$key]=$value.ToLowerInvariant()}
      }
      $buildManifests+=$entry
    }catch{$errors+=@{File='build-manifest';ErrorCode='read_or_parse_failure'}}
  }
}
if($c.GamePath){
  foreach($name in @('RagePluginHook.exe','Plugins/LosSantosAlive.dll','Plugins/LSA.Standalone.RageHost.dll',
                       'Plugins/LSA.Enhanced.dll','Plugins/LSA.PromotedCharacters.dll')){
    $f=Join-Path $c.GamePath $name
    if(Test-Path -LiteralPath $f -PathType Leaf){
      try{$dllCandidates+=@{RelativePath=$name;SHA256=(Get-FileHash -LiteralPath $f).Hash;Evidence='file_present_not_loaded'}}
      catch{$errors+=@{File=$name;ErrorCode='file_hash_failure'}}
    }
  }
}
@{SchemaVersion=1;CollectedUtc=$collectedUtc;BuildManifests=$buildManifests;
  DeployedDllCandidates=$dllCandidates;Caveat='File existence and build hashes do not prove a DLL loaded or ran.'}|
  ConvertTo-Json -Depth 8|Set-Content (Join-Path $folder 'build-evidence.json') -Encoding UTF8
$files|Export-Csv -LiteralPath (Join-Path $folder 'inventory.csv') -NoTypeInformation -Encoding UTF8
@{SchemaVersion=2;CollectedUtc=$collectedUtc;Files=$files.Count;Failures=$errors;
  MissingRoots=$missingRoots;Sources=$sources;DetectedRuns=@($runIds);
  Snapshot=$true;Note='Offline snapshot: includes OBS2 inventory JSONL, sanitized build evidence. No .env/config/memory database copied.'}|
  ConvertTo-Json -Depth 8|Set-Content (Join-Path $folder 'collection.json') -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($folder,($folder+'.zip'))
[pscustomobject]@{Zip=($folder+'.zip');Files=$files.Count;Failed=$errors.Count;DetectedRuns=@($runIds).Count}
if($errors.Count){throw 'Some evidence could not be copied; see collection.json in the ZIP.'}
