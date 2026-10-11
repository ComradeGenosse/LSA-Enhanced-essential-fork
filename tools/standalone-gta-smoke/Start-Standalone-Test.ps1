#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GamePath,
  [Parameter(Mandatory=$true)][string]$Model,
  [ValidateSet('diagnostic','experimental')][string]$ActorMode = 'diagnostic',
  [ValidateSet('openai','faster-qwen3-tts')][string]$TtsProvider = 'openai',
  [string]$TtsModel,
  [string]$Voice = 'alloy',
  [string]$QwenUrl = 'http://127.0.0.1:8765/v1',
  [switch]$EarlySpeech
)
$ErrorActionPreference='Stop'
$game=[System.IO.Path]::GetFullPath($GamePath)
$manifest=Join-Path $game '.LSAStandaloneSmoke/manifest.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
  throw 'Deploy with Install-Standalone.ps1 to an isolated GTA profile first.'
}
if (-not (Test-Path -LiteralPath (Join-Path $game 'RAGEPluginHook.exe') -PathType Leaf)) {
  throw 'RAGEPluginHook.exe is missing from selected isolated profile.'
}
if (Get-Process -Name 'GTA5_Enhanced','RAGEPluginHook' -ErrorAction SilentlyContinue) {
  throw 'Exit all GTA/RPH instances before starting standalone.'
}
foreach ($n in @('LosSantosAlive.dll','Los Santos Alive.dll','LSA.PromotedCharacters.dll',
                 'LSA.SessionIdentity.dll','LSA.Intelligence.dll')) {
  if (Test-Path -LiteralPath (Join-Path $game "Plugins/$n")) {
    throw "Refusing concurrent legacy ownership: $n"
  }
}
if ($Model -notmatch '^[a-zA-Z0-9._:-]{2,100}$') {
  throw 'Supply a confirmed OpenAI Responses API model identifier as -Model.'
}
if (-not $env:OPENAI_API_KEY) { throw 'OPENAI_API_KEY must already be set in this terminal; never put keys in bundle files.' }
if ($TtsProvider -eq 'openai' -and [string]::IsNullOrWhiteSpace($TtsModel)) {
  throw 'Supply a supported OpenAI PCM speech model with -TtsModel.'
}
$node=Get-Command node -ErrorAction Stop
$companion=Join-Path $PSScriptRoot 'companion'
$service=Join-Path $companion 'service.mjs'
if (-not (Test-Path -LiteralPath $service)) { throw 'Standalone Node companion absent from bundle.' }
$env:LSA_STANDALONE_ACTOR_MODE=$ActorMode
$env:LSA_STANDALONE_TYPED_MODE='enabled'
$env:LSA_STANDALONE_MODEL=$Model
$env:LSA_STANDALONE_AUDIO_OUTPUT='waveout_experimental'
$env:LSA_STANDALONE_PLAYBACK_CONFIRM='enabled'
$env:LSA_STANDALONE_LIPSYNC='facial_experimental'
$env:LSA_STANDALONE_TTS_MODE='enabled'
$env:LSA_STANDALONE_TTS_PROVIDER=$TtsProvider
$env:LSA_STANDALONE_TTS_VOICE=$Voice
$env:LSA_STANDALONE_TTS_MODEL=$TtsModel
$env:LSA_STANDALONE_QWEN_URL=$QwenUrl
$env:LSA_STANDALONE_QWEN_VOICES=$Voice
$env:LSA_STANDALONE_EARLY_SPEECH=if ($EarlySpeech) { 'enabled' } else { 'off' }
Write-Host "Standalone mode: $ActorMode, typed Luna client configured; no actor adopted until GTA probe + Arm."
Write-Host 'RPH console: LSAStandaloneProbe -> LSAStandaloneStatus -> (experimental only) LSAStandaloneArm -> LSAStandaloneCompose.'
Write-Host 'Do not load LosSantosAlive.dll or other Essential-dependent plugins in this isolated GTA profile.'
$companionProc=$null
try {
  $companionProc=Start-Process -FilePath $node.Source -ArgumentList ('"' + $service + '"') -WorkingDirectory $companion -PassThru
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
