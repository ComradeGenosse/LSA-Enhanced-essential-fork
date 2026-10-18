#requires -Version 5.1
param(
  [Parameter(Mandatory=$true)][ValidateSet('Essential','Standalone')][string]$Mode,
  [switch]$PrepareOnly,
  [string]$ConfigPath=(Join-Path $PSScriptRoot 'lsa-tools.json')
)
$ErrorActionPreference='Stop'
$c=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
foreach($p in $c.PSObject.Properties){if($p.Value -is [string]){$p.Value=[Environment]::ExpandEnvironmentVariables($p.Value)}}
function Run-Git([string[]]$Command){$r=& git.exe @Command 2>&1;if($LASTEXITCODE){throw ($r -join "`n")};($r -join "`n").Trim()}
# Reuse the already-tested process checks and mode switcher.
if(-not $PrepareOnly){& {param($g,$p,$helper) . $helper;Assert-SwitchStopped $g $p} $c.GamePath $c.CurrentStandalonePackage (Join-Path $PSScriptRoot 'existing/Switch-To-Essential.ps1')}
$ref=if($Mode -eq 'Standalone'){'refs/pull/'+$c.StandalonePullRequest+'/head'}else{$c.EssentialRef}
$repo=if($Mode -eq 'Essential'){$c.EssentialSourcePath}else{$c.RepositoryPath}
$null=Run-Git -Command @('-C',$repo,'fetch','origin',$ref)
$sha=Run-Git -Command @('-C',$repo,'rev-parse','FETCH_HEAD')
$package=$null
if($Mode -eq 'Essential'){
  if(Run-Git -Command @('-C',$repo,'status','--porcelain','--untracked-files=no')){throw 'Essential build checkout has local edits; refusing to overwrite them.'}
  $null=Run-Git -Command @('-C',$repo,'checkout','--detach',$sha)
  $cache=Join-Path $env:USERPROFILE '.nuget/packages'
  $env:LSA_IDENTITY_RPH_REFERENCE=Join-Path $cache 'ragepluginhook/1.124.0/lib/net472/RagePluginHook.dll'
  $env:LSA_IDENTITY_FRAMEWORK_ROOT=Join-Path $cache 'microsoft.netframework.referenceassemblies.net481/1.0.3/build'
  $env:LSA_INTELLIGENCE_DAMAGE_REFERENCE=Join-Path $cache 'damagetrackerlib/2.0.0/lib/DamageTrackerLib.dll'
  $env:LSA_RNUI_REFERENCE=Join-Path $cache 'ragenativeui/1.9.3/lib/net472/RAGENativeUI.dll'
  $buildLog=Join-Path $PSScriptRoot 'essential-build.log'
  Push-Location $repo
  try{& node 'lsa-essential-e1-candidate/tools/buildPS4Candidate.mjs' *> $buildLog;if($LASTEXITCODE){throw "Build failed; see $buildLog"}}finally{Pop-Location}
}else{
  $token=$env:GH_TOKEN;if(-not $token){$token=$env:GITHUB_TOKEN}
  if(-not $token){$credentials="protocol=https`nhost=github.com`n`n"|& git.exe credential fill 2>$null;foreach($line in $credentials){if($line -match '^password=(.+)$'){$token=$Matches[1]}};$credentials=$null}
  if(-not $token){throw 'GitHub authentication missing. Use Git Credential Manager or GH_TOKEN.'}
  $headers=@{Authorization=('Bearer '+$token);Accept='application/vnd.github+json';'User-Agent'='LSA-personal-tools'};$token=$null
  $api='https://api.github.com/repos/'+$c.Repository
  $runs=Invoke-RestMethod -Uri ($api+'/actions/runs?head_sha='+$sha+'&per_page=100') -Headers $headers
  $run=$runs.workflow_runs|Where-Object {$_.head_sha -eq $sha -and $_.name -eq 'Standalone Phase 4 Native Audio' -and $_.conclusion -eq 'success'}|Select-Object -First 1
  if(-not $run){throw 'Latest standalone commit has no successful CI build yet.'}
  $artifacts=Invoke-RestMethod -Uri ($api+'/actions/runs/'+$run.id+'/artifacts') -Headers $headers
  $artifact=$artifacts.artifacts|Where-Object {$_.name -eq ('standalone-gta-smoke-'+$sha) -and -not $_.expired}|Select-Object -First 1
  if(-not $artifact){throw 'Exact-head standalone artifact unavailable.'}
  $dir=Join-Path (Join-Path $PSScriptRoot $c.PackageRoot) ($sha.Substring(0,8)+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
  New-Item -ItemType Directory -Path $dir -Force|Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri ($api+'/actions/artifacts/'+$artifact.id+'/zip') -Headers $headers -OutFile (Join-Path $dir 'artifact.zip')
  Expand-Archive -LiteralPath (Join-Path $dir 'artifact.zip') -DestinationPath (Join-Path $dir 'artifact')
  $package=Join-Path $dir 'bundle';Expand-Archive -LiteralPath (Join-Path $dir 'artifact/lsa-standalone-gta-smoke.zip') -DestinationPath $package
  if((Get-Content (Join-Path $package 'BUILD_SHA.txt') -Raw).Trim() -ne $sha){throw 'Artifact revision mismatch.'}
  foreach($line in Get-Content (Join-Path $package 'SHA256SUMS.txt')){
    if($line -notmatch '^([A-Fa-f0-9]{64})\s+(.+)$'){throw 'Invalid checksum list'};$hash=$Matches[1];$name=$Matches[2]
    if($name -match '(^|[\\/])\.\.([\\/]|$)|:' -or [IO.Path]::IsPathRooted($name)){throw 'Invalid artifact path'}
    if((Get-FileHash -LiteralPath (Join-Path $package $name)).Hash -ne $hash){throw "Checksum mismatch: $name"}
  }
  # Small personal launcher; leave the downloaded upstream scripts unchanged.
  $g=$c.GamePath.Replace("'","''");$m=$c.ReasoningModel.Replace("'","''");$t=$c.TtsModel.Replace("'","''");$v=$c.Voice.Replace("'","''")
  @('param([switch]$PreflightOnly)',
    'if (-not $env:OPENAI_API_KEY) { $env:OPENAI_API_KEY = [Environment]::GetEnvironmentVariable(''OPENAI_API_KEY'',''User'') }',
    ('& (Join-Path $PSScriptRoot ''Start-Standalone-Test.ps1'') -GamePath '''+$g+''' -Model '''+$m+''' -TtsModel '''+$t+''' -Voice '''+$v+''' -Stage streaming -EnableCapability physical_audio,lip_sync -AutoSmoke -AutoDelaySeconds 30 -ConfirmPhysicalEffects -ConfirmAutomatedActorAdoption -PreflightOnly:$PreflightOnly')
  )|Set-Content -LiteralPath (Join-Path $package 'Run-MySmoke.ps1') -Encoding UTF8
}
if($PrepareOnly){[pscustomobject]@{Mode=$Mode;Revision=$sha;Package=$package;Built=$true;Deployed=$false};return}
$state=Join-Path $c.SwitchBackupPath 'switch-state.json'
if(-not(Test-Path -LiteralPath $state) -and (Test-Path -LiteralPath (Join-Path $c.GamePath '.LSAStandaloneSmoke'))){throw 'Unmanaged standalone installation: restore it before deploying.'}
if(Test-Path -LiteralPath $state){if((Get-Content $state -Raw|ConvertFrom-Json).phase -ne 'essential'){
  & (Join-Path $PSScriptRoot 'existing/Switch-To-Essential.ps1') -GamePath $c.GamePath -BackupPath $c.SwitchBackupPath -PackagePath $c.CurrentStandalonePackage
}}
if($Mode -eq 'Standalone'){
  & (Join-Path $PSScriptRoot 'existing/Switch-To-Standalone.ps1') -GamePath $c.GamePath -BackupPath $c.SwitchBackupPath -PackagePath $package
  $c.CurrentStandalonePackage=$package;$c|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}else{
  foreach($r in @('.LSAStandaloneSmoke','Plugins/LSA.Standalone.RageHost.dll','Plugins/LSA.Standalone.enabled')){if(Test-Path -LiteralPath (Join-Path $c.GamePath $r)){throw 'Standalone remains installed; restore Essential first.'}}
  & (Join-Path $PSScriptRoot 'existing/Deploy-Essential.ps1') -SourcePath $repo -GamePath $c.GamePath -BackupRoot (Join-Path $PSScriptRoot $c.BackupRoot) -ExpectedRevision $sha
}
Write-Host "$Mode deployed at $sha. GTA was not launched."
if($package){Write-Host "Package: $package (Run-MySmoke.ps1 starts the test separately)."}
