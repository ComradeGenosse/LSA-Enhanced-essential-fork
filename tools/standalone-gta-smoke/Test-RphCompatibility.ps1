#requires -Version 5.1
<#
.SYNOPSIS
Offline, fail-closed binary signature scan for the exact standalone GTA payload.
Does not start RPH, GTA, or the standalone companion, and never writes to the game.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RphReferencePath,
  [Parameter(Mandatory=$true)][string]$HostDll,
  [Parameter(Mandatory=$true)][string]$CoreDll,
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [string]$ExpectedHostDll
)
$ErrorActionPreference = 'Stop'
$reference = (Resolve-Path -LiteralPath $RphReferencePath -ErrorAction Stop).Path
$hostBinary = (Resolve-Path -LiteralPath $HostDll -ErrorAction Stop).Path
$coreBinary = (Resolve-Path -LiteralPath $CoreDll -ErrorAction Stop).Path
if ([IO.Path]::GetFileName($reference) -cne 'RagePluginHook.dll') {
  throw 'RPH reference must be the real SDK/RagePluginHook.dll; RAGEPluginHook.exe is the launcher, not the API.'
}
if ([IO.Path]::GetFileName($hostBinary) -cne 'LSA.Standalone.RageHost.dll' -or
    [IO.Path]::GetFileName($coreBinary) -cne 'LSA.Standalone.Core.dll') {
  throw 'HostDll/CoreDll must be the actual standalone payload binaries.'
}
$hostSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $hostBinary).Hash
if ($ExpectedHostDll) {
  $expected = (Resolve-Path -LiteralPath $ExpectedHostDll -ErrorAction Stop).Path
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $expected).Hash -cne $hostSha) {
    throw 'The packaged RAGE host does not match the verified clean Release build.'
  }
}
$packagedProject = Join-Path $PSScriptRoot 'native/standalone-host/tests/RphSignatureAudit.csproj'
$project = if (Test-Path -LiteralPath $packagedProject -PathType Leaf) {
  $packagedProject
} else {
  Join-Path $PSScriptRoot '../../native/standalone-host/tests/RphSignatureAudit.csproj'
}
if (-not (Test-Path -LiteralPath $project -PathType Leaf)) {
  throw 'Compatibility validator project unavailable; use the complete verified package or repository.'
}
# The tool reads raw ECMA-335 metadata and does not load or execute RPH DLL code.
& dotnet run --project $project --configuration Release -- $reference $hostBinary $coreBinary $ReportPath
if ($LASTEXITCODE -ne 0) { throw "Standalone ABI scan rejected the payload; inspect $ReportPath" }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $hostBinary).Hash -cne $hostSha) {
  throw 'Host DLL changed while being scanned.'
}
Write-Host "Verified standalone host SHA256: $hostSha"
Write-Host "Binary compatibility report: $ReportPath"
