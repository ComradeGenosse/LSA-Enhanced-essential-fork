# Read-only Windows render preflight. Never launches/applies Afterburner or changes hardware.
[CmdletBinding()]
param(
    [ValidateRange(0, 32)][int]$GpuIndex = 0,
    [string]$ProfilePath = 'C:\Program Files (x86)\MSI Afterburner\Profiles\VEN_10DE&DEV_2B85&SUBSYS_205710DE&REV_A1&BUS_1&DEV_0&FN_0.cfg',
    [ValidateRange(1, 200)][double]$ExpectedPercent = 80,
    [ValidateRange(0.01, 5)][double]$ToleranceWatts = 1,
    [string]$OutFile
)
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
    checkedUtc = [DateTime]::UtcNow.ToString('o')
    status = 'UNKNOWN'
    gpuIndex = $GpuIndex
    expectedPercent = $ExpectedPercent
    expectedSource = 'parameter/default'
    scope = 'GPU power limit only; full preset, clock offsets, voltage curve and fan policy not verified'
    settingsChanged = $false
}
$code = 2
try {
    # Read the saved preset unless the operator explicitly supplied an expectation.
    if (-not $PSBoundParameters.ContainsKey('ExpectedPercent')) {
        $section = ''
        $profilePercent = $null
        foreach ($line in Get-Content -LiteralPath $ProfilePath) {
            if ($line -match '^\s*\[([^\]]+)\]\s*$') { $section = $Matches[1] }
            elseif ($section -eq 'Profile1' -and $line -match '^\s*PowerLimit\s*=\s*(\d+(?:\.\d+)?)\s*$') {
                $profilePercent = [double]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture)
            }
        }
        if ($null -eq $profilePercent -or $profilePercent -lt 1 -or $profilePercent -gt 200) {
            throw 'Profile1 has no usable PowerLimit; provide -ExpectedPercent explicitly.'
        }
        $ExpectedPercent = $profilePercent
        $report.expectedPercent = $ExpectedPercent
        $report.expectedSource = $ProfilePath + ' [Profile1] PowerLimit'
    }
    $smi = (Get-Command nvidia-smi.exe -ErrorAction Stop).Source
    $raw = @(& $smi "--id=$GpuIndex" '--query-gpu=power.limit,power.default_limit' '--format=csv,noheader,nounits' 2>&1)
    if ($LASTEXITCODE -ne 0 -or $raw.Count -ne 1) { throw "nvidia-smi query failed: $($raw -join ' ')" }
    $fields = ([string]$raw[0]).Split(',')
    if ($fields.Count -ne 2) { throw 'Unexpected nvidia-smi response.' }
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $current = [double]::Parse($fields[0].Trim(), $culture)
    $baseline = [double]::Parse($fields[1].Trim(), $culture)
    if ($baseline -le 0 -or $current -le 0) { throw 'Invalid GPU power telemetry.' }
    $expected = $baseline * $ExpectedPercent / 100
    $limitMatches = [Math]::Abs($current - $expected) -le $ToleranceWatts
    $report.currentLimitWatts = $current
    $report.defaultLimitWatts = $baseline
    $report.expectedLimitWatts = $expected
    $report.actualPercent = [Math]::Round(100 * $current / $baseline, 3)
    $report.toleranceWatts = $ToleranceWatts
    $report.status = if ($limitMatches) { 'PASS' } else { 'MISMATCH' }
    $report.action = if ($limitMatches) { 'No preset action needed for the power cap.' } else { 'Stop preflight and review settings; nothing was changed.' }
    $code = if ($limitMatches) { 0 } else { 2 }
} catch {
    $report.error = $_.Exception.Message
    $report.action = 'Cannot verify power cap; nothing was changed.'
}
$json = $report | ConvertTo-Json -Depth 4
if ($OutFile) { [IO.File]::WriteAllText($OutFile, $json, [Text.UTF8Encoding]::new($false)) }
$json
exit $code
