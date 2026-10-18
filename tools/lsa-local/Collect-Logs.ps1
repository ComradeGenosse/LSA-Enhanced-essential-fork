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
$roots=@($c.GamePath)+@($c.ExtraLogRoots)
# Find companion logs in both old and future standalone packages.
foreach($search in @($c.LogSearchRoots)+@(Join-Path $PSScriptRoot $c.PackageRoot)){
  if(Test-Path -LiteralPath $search){foreach($file in Get-ChildItem -LiteralPath $search -Filter 'Start-Standalone-Test.ps1' -File -Recurse){
    if(Test-Path -LiteralPath (Join-Path $file.DirectoryName 'companion/service.mjs')){$roots+=Join-Path $file.DirectoryName 'logs'}
  }}
}
$files=@();$errors=@();$index=0;$seen=@{}
foreach($root in @($roots|Where-Object {$_}|Sort-Object -Unique)){
  if(-not(Test-Path -LiteralPath $root)){continue};$index++
  foreach($f in Get-ChildItem -LiteralPath $root -File -Recurse -Force){
    if($seen.ContainsKey($f.FullName)){continue}
    if($f.Name -notmatch '(?i)\.(log|jsonl|rcr|dmp|etl|trace)(\.\d+|\.gz|\.zip)?$|^crashreport$' -and
       -not($f.Extension -eq '.txt' -and $f.FullName -match '(?i)log')){continue}
    $seen[$f.FullName]=$true
    $relative='source-'+$index+'/'+$f.FullName.Substring($root.TrimEnd('\').Length+1)
    $target=Join-Path $folder $relative
    try {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force|Out-Null
      Copy-Item -LiteralPath $f.FullName -Destination $target
      $files+=[pscustomobject]@{File=$relative;Source=$f.FullName;SHA256=(Get-FileHash -LiteralPath $target).Hash}
    }catch{$errors+=[pscustomobject]@{File=$f.FullName;Error=$_.Exception.Message}}
  }
}
$files|Export-Csv -LiteralPath (Join-Path $folder 'inventory.csv') -NoTypeInformation -Encoding UTF8
@{Files=$files.Count;Failures=$errors;Note='Raw logs only; no analysis. Running logs are a snapshot. No settings, .env or database files collected.'}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $folder 'collection.json')
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($folder,($folder+'.zip'))
[pscustomobject]@{Zip=($folder+'.zip');Files=$files.Count;Failed=$errors.Count}
if($errors.Count){throw 'Some logs could not be copied; see collection.json in the ZIP.'}
