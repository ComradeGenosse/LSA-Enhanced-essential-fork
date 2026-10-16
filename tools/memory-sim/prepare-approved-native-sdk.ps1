# Compile-only official NuGet SDK references, byte-pinned in the source tree.
# No GTA directory, replacement stubs, or SDK binary redistribution.
# Optional CI secrets may enforce additional approval, but cannot override a pin.
$ErrorActionPreference = 'Stop'
$pinPath = 'tools/memory-sim/w09-approved-official-sdk-pins.json'
$pins = Get-Content -LiteralPath $pinPath -Raw | ConvertFrom-Json
$items = @($pins.sources)
if ($pins.schemaVersion -ne 1 -or $items.Count -ne 2 -or
    $items[0].name -cne 'RPH' -or $items[0].id -cne 'ragepluginhook' -or
    $items[0].version -cne '1.124.0' -or $items[0].dll -cne 'RagePluginHook.dll' -or
    $items[1].name -cne 'DAMAGE' -or $items[1].id -cne 'damagetrackerlib' -or
    $items[1].version -cne '2.0.0' -or $items[1].dll -cne 'DamageTrackerLib.dll') {
  throw 'W09 source-reviewed official SDK manifest is malformed or points to unexpected versions'
}
$receiptDir = 'artifacts/memory-k'
New-Item -ItemType Directory -Force $receiptDir | Out-Null
$receipt = @{ kind='w09-external-compile-sdk'; status='blocked'; sources=@(); physicalGta=$false; packaged=$false; pinPath=$pinPath }
$hashPattern = '^[0-9a-fA-F]{64}$'
$provided = @{
  RPH = @{ Package=$env:W09_RPH_PACKAGE_SHA256; Dll=$env:W09_RPH_DLL_SHA256 }
  DAMAGE = @{ Package=$env:W09_DAMAGE_PACKAGE_SHA256; Dll=$env:W09_DAMAGE_DLL_SHA256 }
}
if (@($items | Where-Object { $_.packageSha256 -notmatch $hashPattern -or $_.dllSha256 -notmatch $hashPattern }).Count -gt 0) {
  $receipt.reason = 'MISSING_EXTERNAL_PINNED_SDK: reviewed NuGet package+assembly SHA256 pins are absent or malformed'
  $receipt | ConvertTo-Json -Depth 6 | Set-Content "$receiptDir/w09-sdk-preparation.json"
  Write-Output $receipt.reason
  exit 0
}
$dest = Join-Path $env:RUNNER_TEMP 'w09-approved-sdk'
New-Item -ItemType Directory -Force $dest | Out-Null
try {
  foreach ($item in $items) {
    $secrets = $provided[$item.name]
    if ($null -eq $secrets) { throw "Unknown SDK pin name $($item.name)" }
    if (![string]::IsNullOrWhiteSpace($secrets.Package) -and
        $secrets.Package.ToLowerInvariant() -ne $item.packageSha256.ToLowerInvariant()) {
      throw "$($item.name): optional package hash approval differs from source-reviewed pin"
    }
    if (![string]::IsNullOrWhiteSpace($secrets.Dll) -and
        $secrets.Dll.ToLowerInvariant() -ne $item.dllSha256.ToLowerInvariant()) {
      throw "$($item.name): optional assembly hash approval differs from source-reviewed pin"
    }
    $packageName = "$($item.id).$($item.version)"
    $url = "https://api.nuget.org/v3-flatcontainer/$($item.id)/$($item.version)/$packageName.nupkg"
    $zip = Join-Path $dest "$packageName.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip
    $packageObserved = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($packageObserved -ne $item.packageSha256.ToLowerInvariant()) {
      throw "$($item.name): upstream package SHA256 mismatch"
    }
    $folder = Join-Path $dest $packageName
    Expand-Archive -LiteralPath $zip -DestinationPath $folder -Force
    $dlls = @(Get-ChildItem -LiteralPath $folder -Filter $item.dll -File -Recurse)
    if ($dlls.Count -ne 1) { throw "$($item.name): required exact SDK assembly not unambiguously present; found $($dlls.Count)" }
    $relativePath = $dlls[0].FullName.Substring($folder.Length+1).Replace('\','/')
    if ($relativePath -cne $item.referenceInPackage) {
      throw "$($item.name): official package assembly path differs from reviewed pin"
    }
    $assemblyObserved = (Get-FileHash $dlls[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($assemblyObserved -ne $item.dllSha256.ToLowerInvariant()) {
      throw "$($item.name): SDK assembly SHA256 mismatch"
    }
    $receipt.sources += @{
      name=$item.name; id=$item.id; version=$item.version; url=$url;
      packageSha256=$packageObserved; dllSha256=$assemblyObserved;
      referenceName=$item.dll; referenceInPackage=$relativePath
    }
    if ($item.name -eq 'RPH') { $rphPath=$dlls[0].FullName; $rphHash=$assemblyObserved }
    else { $damagePath=$dlls[0].FullName; $damageHash=$assemblyObserved }
  }
  # Only after ALL packages and references pass the source-reviewed hash gate.
  "W09_RPH_DLL_PATH=$rphPath" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  "W09_DAMAGE_DLL_PATH=$damagePath" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  "W09_RPH_DLL_SHA256=$rphHash" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  "W09_DAMAGE_DLL_SHA256=$damageHash" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  $receipt.status='pass'
  $receipt.reason='Both reviewed NuGet archives and compile-only assembly references independently SHA256-verified'
  Write-Output 'W09 approved official NuGet compile-only SDK references verified'
} catch {
  $receipt.status='fail'
  $receipt.reason=$_.Exception.Message
  Write-Error "W09 SDK verification failed: $($receipt.reason)"
} finally {
  $receipt | ConvertTo-Json -Depth 6 | Set-Content "$receiptDir/w09-sdk-preparation.json"
}
