#requires -Version 5.1
param([switch]$PreflightOnly,[string]$ConfigPath=(Join-Path $PSScriptRoot 'lsa-tools.json'))
$ErrorActionPreference='Stop'
$c=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
foreach($p in $c.PSObject.Properties){if($p.Value -is [string]){$p.Value=[Environment]::ExpandEnvironmentVariables($p.Value)}}
if(-not $c.CurrentStandalonePackage){throw 'Deploy standalone first so its package path is registered.'}
if(-not $env:OPENAI_API_KEY){$env:OPENAI_API_KEY=[Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')}
& (Join-Path $c.CurrentStandalonePackage 'Start-Standalone-Test.ps1') -GamePath $c.GamePath -Model $c.ReasoningModel -TtsModel $c.TtsModel -Voice $c.Voice -Stage streaming -EnableCapability physical_audio,lip_sync -AutoSmoke -AutoDelaySeconds 30 -ConfirmPhysicalEffects -ConfirmAutomatedActorAdoption -PreflightOnly:$PreflightOnly
