param(
    [Parameter(Mandatory = $true)][string]$DamageDll,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$taskProject = Join-Path $PSScriptRoot 'PerceptionNativeProbe.csproj'
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskEssentialJson = Join-Path $taskOutput 'essential.json'
$taskDamageJson = Join-Path $taskOutput 'damage.json'
$taskMethods = @(
    'GunshotReflexDetector::Update', 'GunshotReflexDetector::UpdatePlayerShotDetection',
    'GunshotReflexDetector::HasRecentShotActivity', 'GunshotReflexDetector::TryResolveRecentGunshotSource',
    'ReflexAwarenessService::Record', 'ReflexAwarenessService::TryGetMemory',
    'PerceptionSnapshot::Capture', 'PerceptionSystem::TryGetSnapshot',
    'SpecialGeminiTurnScheduler::Submit', 'SpecialGeminiTurnScheduler::SubmitAfterCurrentTurn',
    'SpecialGeminiTurnService::SendNow', '0x0600068f', '0x06000690', '0x0600067c',
    '0x0600067b', '0x0600159a', '0x060015b8', '0x060015a4', '0x06000616'
)
dotnet build $taskProject --nologo
if ($LASTEXITCODE -ne 0) { throw 'Probe build failed.' }
dotnet run --no-build --project $taskProject -- (Join-Path $taskRepo 'lsa-essential-e1-candidate/upstream/LosSantosAlive.dll') $taskEssentialJson @taskMethods
if ($LASTEXITCODE -ne 0) { throw 'Essential probe failed.' }
dotnet run --no-build --project $taskProject -- $DamageDll $taskDamageJson --damage 'DamageTrackerService::Run' 'DamageTrackerService::InvokePedDamageEvent' 'DamageTrackerService::InvokeVehicleDamageEvent'
if ($LASTEXITCODE -ne 0) { throw 'Damage probe failed.' }
node (Join-Path $PSScriptRoot 'summarize-evidence.mjs') $taskEssentialJson $taskDamageJson (Join-Path $taskOutput 'evidence.json')
if ($LASTEXITCODE -ne 0) { throw 'Evidence summarization failed.' }
node (Join-Path $PSScriptRoot 'verify-source-seams.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Source-seam proof failed.' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $taskOutput 'evidence.json')).Hash -ne
    (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot 'evidence.json')).Hash) {
    throw 'Generated evidence differs from the checked-in evidence.'
}
Write-Output 'Reproduced the checked-in static evidence exactly.'
