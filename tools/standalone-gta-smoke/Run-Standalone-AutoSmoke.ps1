#requires -Version 5.1
# Opt-in all-capabilities single-session GTA smoke. Does not install or
# alter legacy files; invoke only after verified off-game controller backup.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$GamePath,
  [Parameter(Mandatory=$true)][string]$Model,
  [Parameter(Mandatory=$true)][string]$TtsModel,
  [ValidateRange(5,120)][int]$AfterSpawnSeconds = 30,
  [switch]$ConfirmPhysicalEffects,
  [switch]$ConfirmAutomatedActorAdoption,
  [switch]$PreflightOnly
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmPhysicalEffects -or -not $ConfirmAutomatedActorAdoption) {
  throw 'Automated full smoke requires BOTH -ConfirmPhysicalEffects and -ConfirmAutomatedActorAdoption.'
}
$commands = @{
  GamePath = $GamePath
  Stage = 'streaming'
  Model = $Model
  TtsModel = $TtsModel
  EnableCapability = @('physical_audio','lip_sync')
  ConfirmPhysicalEffects = $true
  AutoSmoke = $true
  AutoDelaySeconds = $AfterSpawnSeconds
  ConfirmAutomatedActorAdoption = $true
  PreflightOnly = [bool]$PreflightOnly
}
& (Join-Path $PSScriptRoot 'Start-Standalone-Test.ps1') @commands
if (-not $?) { throw 'Standalone automated smoke launcher failed.' }
