# Validate packaging scope with a fake GTA folder; never launch RPH or touch the user's game.
$ErrorActionPreference = "Stop"
$temp = Join-Path $env:RUNNER_TEMP ("wps-e0-pack-" + [guid]::NewGuid().ToString("N"))
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { $temp = Join-Path $env:TEMP ("wps-e0-pack-" + [guid]::NewGuid().ToString("N")) }
$results = Join-Path $temp "game\Plugins\LSA.WPS.Lab.Results"
New-Item -Path $results -ItemType Directory -Force | Out-Null
try {
  $run = "abcdef1234567890"
  $manifest = @{
    type = "E0_pre_shot_unattended"; run = $run; state = "completed_with_blockers"
    results = @(@{probe="E0.0"; status="GTA_VERIFIED"; log="probe.jsonl"; summary="probe.summary.json"})
  } | ConvertTo-Json -Depth 6
  $name = "20261019-pre-shot-$run.suite.json"
  Set-Content -LiteralPath (Join-Path $results $name) -Value $manifest
  Set-Content -LiteralPath (Join-Path $results "probe.jsonl") -Value "fake evidence"
  Set-Content -LiteralPath (Join-Path $results "probe.summary.json") -Value "{}"
  Set-Content -LiteralPath (Join-Path $results "unrelated.log") -Value "MUST NOT LEAK"
  $gameRoot = Join-Path $temp "game"
  & (Join-Path $PSScriptRoot "..\pack-pre-shot.ps1") -GameRoot $gameRoot -OutputDirectory $temp | Out-Null
  $archive = Join-Path $temp ("WPS-E0-pre-shot-$run.zip")
  if (-not (Test-Path -LiteralPath $archive)) { throw "ZIP not created" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
  try { $names = @($zip.Entries | ForEach-Object { $_.Name } | Sort-Object) }
  finally { $zip.Dispose() }
  $expected = @($name,"probe.jsonl","probe.summary.json" | Sort-Object)
  if ($names.Count -ne 3 -or ($names -join "|") -ne (@($expected | Sort-Object) -join "|")) {
    throw "ZIP included missing/unexpected entries: $($names -join ', ')"
  }
  Write-Output "PASS: latest E0 suite ZIP includes only manifest and referenced evidence"
}
finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force } }
