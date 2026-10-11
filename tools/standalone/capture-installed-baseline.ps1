# Phase 0 / first-deployment baseline only. Read-only by default.
# Never reads a JSON config, password, character profile, logs or API key.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $GameRoot,
    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $GameRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $root 'GTA5_Enhanced.exe') -PathType Leaf)) {
    throw 'Expected GTA5_Enhanced.exe at the selected GTA V Enhanced game root.'
}

$relatives = @(
    'GTA5_Enhanced.exe',
    'RagePluginHook.exe',
    'RagePluginHook.dll',
    'Plugins/LosSantosAlive.dll',
    'Plugins/LosSantosAliveServer/server.bundle.mjs',
    'Plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll',
    'Plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Bootstrap.dll',
    'Plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll'
)

$result = [ordered]@{
    schemaVersion = 1
    capturedUtc = [DateTime]::UtcNow.ToString('o')
    purpose = 'Local installed binaries only; no config or personal data included'
    files = @()
}
foreach ($relative in $relatives) {
    $absolute = Join-Path $root ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
    if (Test-Path -LiteralPath $absolute -PathType Leaf) {
        $file = Get-Item -LiteralPath $absolute
        $hash = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
        $result.files += [ordered]@{
            relativePath = $relative
            present = $true
            bytes = [long] $file.Length
            sha256 = $hash
        }
    } else {
        $result.files += [ordered]@{
            relativePath = $relative
            present = $false
        }
    }
}

$json = $result | ConvertTo-Json -Depth 6
if ($OutputPath) {
    $destination = [IO.Path]::GetFullPath($OutputPath)
    $directory = [IO.Path]::GetDirectoryName($destination)
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw 'Output directory does not exist; refusing to create or overwrite external folders.'
    }
    if (Test-Path -LiteralPath $destination) {
        throw 'Output file already exists; refusing to overwrite baseline evidence.'
    }
    [IO.File]::WriteAllText($destination, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Write-Host ('Saved sanitized installed-file fingerprint manifest: ' + $destination)
} else {
    Write-Output $json
}
