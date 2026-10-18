#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GamePath,
  [ValidateSet('host','probe','typed','tts','audio','lipsync','streaming')]
  [string]$Stage = 'host',
  [string[]]$EnableCapability = @(),
  [string[]]$DisableCapability = @(),
  [switch]$ConfirmPhysicalEffects,
  [switch]$PreflightOnly,
  [string]$Model,
  [ValidateSet('diagnostic','experimental')][string]$ActorMode,
  [ValidateSet('openai','faster-qwen3-tts')][string]$TtsProvider = 'openai',
  [string]$TtsModel,
  [string]$Voice = 'alloy',
  [string]$QwenUrl = 'http://127.0.0.1:8765/v1',
  [switch]$EarlySpeech,
  [switch]$AutoSmoke,
  [ValidateRange(5,120)][int]$AutoDelaySeconds = 30,
  [switch]$ConfirmAutomatedActorAdoption
)
$ErrorActionPreference='Stop'
$game=[System.IO.Path]::GetFullPath($GamePath)
$manifest=Join-Path $game '.LSAStandaloneSmoke/manifest.json'
$nativeActivation=Join-Path $game '.LSAStandaloneSmoke/native-activation.json'
$nativeActivationWritten=$false
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
  throw 'Deploy with Install-Standalone.ps1 first.'
}
if (-not (Test-Path -LiteralPath (Join-Path $game 'RAGEPluginHook.exe') -PathType Leaf)) {
  throw 'RAGEPluginHook.exe is missing from selected GTA profile.'
}
if (Get-Process -Name 'GTA5_Enhanced','RAGEPluginHook' -ErrorAction SilentlyContinue) {
  throw 'Exit all GTA/RPH instances before starting standalone.'
}
& (Join-Path $PSScriptRoot 'Assert-LegacyLSAStopped.ps1') -GamePath $game
$node=Get-Command node -ErrorAction Stop
$companion=Join-Path $PSScriptRoot 'companion'
$service=Join-Path $companion 'service.mjs'
$preflight=Join-Path $companion 'tools/activation-config.mjs'
if (-not (Test-Path -LiteralPath $service) -or
    -not (Test-Path -LiteralPath $preflight)) {
  throw 'Standalone Node companion or activation preflight absent from bundle.'
}
# CLI builds all seven original environment switches from one stage.
# Reset optional credentials/voice settings too; stale process env must not
# accidentally activate a feature. OPENAI_API_KEY remains operator-managed.
# Preserve the invoking PowerShell process environment, including values that
# are absent. The child Node and RPH processes inherit the selected stage on
# launch, but dry-run, normal exit, failure and cancellation restore the caller.
$activationKeys=@(
  'LSA_STANDALONE_MODEL','LSA_STANDALONE_TTS_MODEL',
  'LSA_STANDALONE_TTS_PROVIDER','LSA_STANDALONE_TTS_VOICE',
  'LSA_STANDALONE_QWEN_URL','LSA_STANDALONE_QWEN_VOICES',
  'LSA_STANDALONE_ACTOR_MODE','LSA_STANDALONE_TYPED_MODE',
  'LSA_STANDALONE_TTS_MODE','LSA_STANDALONE_AUDIO_OUTPUT',
  'LSA_STANDALONE_PLAYBACK_CONFIRM','LSA_STANDALONE_LIPSYNC',
  'LSA_STANDALONE_EARLY_SPEECH','LSA_STANDALONE_ACTIVATION_STAGE',
  'LSA_STANDALONE_VOICE_ASSIGNMENTS','LSA_STANDALONE_TTS_SESSION_VOICES',
  'LSA_STANDALONE_TTS_INSTRUCTIONS'
)
$originalActivationEnv=@{}
foreach ($key in $activationKeys) {
  $originalActivationEnv[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
}
try {
$env:LSA_STANDALONE_MODEL=$Model
$env:LSA_STANDALONE_TTS_MODEL=$TtsModel
$env:LSA_STANDALONE_TTS_PROVIDER=$TtsProvider
$env:LSA_STANDALONE_TTS_VOICE=$Voice
$env:LSA_STANDALONE_QWEN_URL=$QwenUrl
# Do not construct a dormant Qwen provider for an OpenAI-only stage.
$env:LSA_STANDALONE_QWEN_VOICES=if ($TtsProvider -eq 'faster-qwen3-tts') { $Voice } else { $null }
# Advanced speech customization from a previous launch is not a stage override.
# The standalone test launcher uses deterministic defaults, never hidden inherited
# assignments, alternate session voice pools, or text instructions.
$env:LSA_STANDALONE_VOICE_ASSIGNMENTS=$null
$env:LSA_STANDALONE_TTS_SESSION_VOICES=$null
$env:LSA_STANDALONE_TTS_INSTRUCTIONS=$null
# These checks run before either dry-run or normal launch. They reject any
# regression that would let stale speech configuration leak into the child.
foreach ($key in @('LSA_STANDALONE_VOICE_ASSIGNMENTS',
  'LSA_STANDALONE_TTS_SESSION_VOICES','LSA_STANDALONE_TTS_INSTRUCTIONS')) {
  if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key,'Process'))) {
    throw "Unexpected inherited standalone speech setting: $key"
  }
}
if ($TtsProvider -eq 'openai' -and
    -not [string]::IsNullOrEmpty($env:LSA_STANDALONE_QWEN_VOICES)) {
  throw 'Inactive Qwen voice pool leaked into OpenAI-only stage.'
}
$requestedEnable=@($EnableCapability)
if ($EarlySpeech) { $requestedEnable += 'early_speech' }
$arguments=@($preflight, $Stage)
foreach ($name in $requestedEnable) { $arguments += "--enable=$name" }
foreach ($name in $DisableCapability) { $arguments += "--disable=$name" }
$activationJson = & $node.Source @arguments
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($activationJson -join ''))) {
  throw 'Standalone activation preflight rejected the requested stage (see above). No game was launched.'
}
$activation = ($activationJson -join '') | ConvertFrom-Json
if ($activation.capabilities.physical_audio.requested -and -not $ConfirmPhysicalEffects) {
  throw 'Experimental physical audio/lip-sync requires -ConfirmPhysicalEffects. No game was launched.'
}
if ($AutoSmoke -and $activation.capabilities.typed_conversation.requested -and
    -not $ConfirmAutomatedActorAdoption) {
  throw 'Automated NPC adoption requires explicit -ConfirmAutomatedActorAdoption. No game was launched.'
}
if ($PSBoundParameters.ContainsKey('ActorMode') -and
    $ActorMode -ne $activation.nativeActorMode) {
  throw "ActorMode conflicts with -Stage $Stage. Use the stage/capability selectors instead."
}
foreach ($setting in $activation.settings.PSObject.Properties) {
  [Environment]::SetEnvironmentVariable($setting.Name, [string]$setting.Value, 'Process')
}
$env:LSA_STANDALONE_ACTIVATION_STAGE=$Stage
Write-Host "Standalone stage: $Stage, native actor mode: $($activation.nativeActorMode)."
foreach ($feature in $activation.capabilities.PSObject.Properties) {
  $state=if ($feature.Value.requested) { 'configured; runtime unverified' } else { 'off' }
  Write-Host "  $($feature.Name): $state"
}
Write-Host 'Native RPH Probe/Arm and GTA validation are separate; offline preflight does not prove device output.'
Write-Host 'RPH console: LSAStandaloneStatus / LSAStandaloneProbe; typed stages also require LSAStandaloneArm, then LSAStandaloneCompose.'
Write-Host 'Do not load LosSantosAlive.dll or other Essential-dependent plugins in this GTA session.'
if ($PreflightOnly) {
  Write-Host 'Activation preflight complete; no companion or GTA/RPH process launched.'
} else {
# The native plugin loads inside GTA, not inside this PowerShell process.
# A short-lived installation-owned file is the authoritative native stage
# even when RPH/GTA do not inherit the launcher environment. Never store
# provider secrets, model names, speech or private conversation data here.
if (Test-Path -LiteralPath $nativeActivation) {
  throw 'Stale native activation file found. Close the previous launcher and run Undo-Standalone.ps1, then reinstall. Refusing to replace it.'
}
$nativeSettings=@{}
foreach ($setting in $activation.settings.PSObject.Properties) {
  $nativeSettings[$setting.Name]=[string]$setting.Value
}
$nativeEnvelope=@{
  kind='lsa-standalone-native-activation'
  version=1
  stage=$Stage
  createdAtUtc=[DateTime]::UtcNow.ToString('o')
  ownerPid=$PID
  settings=$nativeSettings
  autoSmoke=@{
    enabled=[bool]$AutoSmoke
    afterSpawnSeconds=[int]$AutoDelaySeconds
    actorAdoptionAuthorized=[bool]($AutoSmoke -and $ConfirmAutomatedActorAdoption)
  }
}
$temporaryActivation=$nativeActivation+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
try {
  $nativeEnvelope | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryActivation -Encoding UTF8
  Move-Item -LiteralPath $temporaryActivation -Destination $nativeActivation -ErrorAction Stop
  $nativeActivationWritten=$true
} finally {
  Remove-Item -LiteralPath $temporaryActivation -Force -ErrorAction SilentlyContinue
}
Write-Host 'Native activation file: installation-owned, session-bound, secret-free.'
if ($AutoSmoke) {
  Write-Host "Automated smoke: waits $AutoDelaySeconds seconds of safe, in-game player readiness; no human console input required."
}
$companionProc=$null
$logs=Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$stdout=Join-Path $logs "companion-$stamp.stdout.log"
$stderr=Join-Path $logs "companion-$stamp.stderr.log"
Write-Host "Companion diagnostic output: $stdout (RPH game-side logs are separate)."
try {
  $companionProc=Start-Process -FilePath $node.Source -ArgumentList ('"' + $service + '"') -WorkingDirectory $companion -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $rph=Start-Process -FilePath (Join-Path $game 'RAGEPluginHook.exe') -WorkingDirectory $game -PassThru
  $sawGame = $false
  $start = [DateTime]::UtcNow
  while ($true) {
    if ($companionProc.HasExited) { throw 'Standalone Node companion exited; check its console configuration and API model.' }
    $loader = Get-Process -Id $rph.Id -ErrorAction SilentlyContinue
    $runningGame = @(Get-Process -Name GTA5_Enhanced -ErrorAction SilentlyContinue)
    if ($runningGame.Count -gt 0) { $sawGame = $true }
    # RPH may spawn GTA and exit its own launcher process. Keep Node
    # alive for the entire actual game session, not just RPH startup.
    if ($sawGame -and -not $loader -and $runningGame.Count -eq 0) { break }
    if (-not $sawGame -and -not $loader -and
        ([DateTime]::UtcNow - $start).TotalSeconds -gt 30) {
      throw 'RPH ended without starting GTA Enhanced in this profile.'
    }
    Start-Sleep -Seconds 1
  }
} finally {
  if ($companionProc) {
    Stop-Process -Id $companionProc.Id -Force -ErrorAction SilentlyContinue
  }
}
} # no early return; the outer environment cleanup runs on every path
} finally {
  if ($nativeActivationWritten) {
    Remove-Item -LiteralPath $nativeActivation -Force -ErrorAction SilentlyContinue
  }
  foreach ($key in $activationKeys) {
    $previous=$originalActivationEnv[$key]
    if ($null -eq $previous) {
      # PowerShell's Env: provider must remove absent variables, not leave
      # empty process entries that survive into the next RPH invocation.
      Remove-Item -LiteralPath ("Env:" + $key) -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($key,[string]$previous,'Process')
    }
  }
}
