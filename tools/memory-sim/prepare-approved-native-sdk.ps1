# Only approved upstream NuGet compile references. No GTA directory, stubs or redistribution.
# Approval requires both immutable NuGet package SHA256 and assembly SHA256, supplied as CI secrets.
$ErrorActionPreference = 'Stop'
$items = @(
  @{ Name='RPH'; Id='ragepluginhook'; Version='1.124.0'; Dll='RagePluginHook.dll'; PackageHash=$env:W09_RPH_PACKAGE_SHA256; DllHash=$env:W09_RPH_DLL_SHA256 },
  @{ Name='DAMAGE'; Id='damagetrackerlib'; Version='2.0.0'; Dll='DamageTrackerLib.dll'; PackageHash=$env:W09_DAMAGE_PACKAGE_SHA256; DllHash=$env:W09_DAMAGE_DLL_SHA256 }
)
$receiptDir = 'artifacts/memory-k'
New-Item -ItemType Directory -Force $receiptDir | Out-Null
$receipt = @{ kind='w09-external-compile-sdk'; status='blocked'; sources=@(); physicalGta=$false; packaged=$false }
$hashPattern = '^[0-9a-fA-F]{64}$'
if (@($items | Where-Object { $_.PackageHash -notmatch $hashPattern -or $_.DllHash -notmatch $hashPattern }).Count -gt 0) {
  $receipt.reason = 'MISSING_EXTERNAL_PINNED_SDK: reviewed NuGet package+assembly SHA256 approvals are absent'
  $receipt | ConvertTo-Json -Depth 6 | Set-Content "$receiptDir/w09-sdk-preparation.json"
  Write-Output $receipt.reason
  exit 0
}
$dest = Join-Path $env:RUNNER_TEMP 'w09-approved-sdk'
New-Item -ItemType Directory -Force $dest | Out-Null
try {
  foreach ($item in $items) {
    $packageName = "$($item.Id).$($item.Version)"
    $url = "https://api.nuget.org/v3-flatcontainer/$($item.Id)/$($item.Version)/$packageName.nupkg"
    $zip = Join-Path $dest "$packageName.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip
    $packageObserved = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($packageObserved -ne $item.PackageHash.ToLowerInvariant()) { throw "$($item.Name): upstream package SHA256 mismatch" }
    $folder = Join-Path $dest $packageName
    Expand-Archive -LiteralPath $zip -DestinationPath $folder -Force
    $dlls = @(Get-ChildItem -LiteralPath $folder -Filter $item.Dll -File -Recurse)
    if ($dlls.Count -ne 1) { throw "$($item.Name): required exact SDK assembly not unambiguously present; found $($dlls.Count)" }
    $assemblyObserved = (Get-FileHash $dlls[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($assemblyObserved -ne $item.DllHash.ToLowerInvariant()) { throw "$($item.Name): SDK assembly SHA256 mismatch" }
    $receipt.sources += @{
      name=$item.Name; id=$item.Id; version=$item.Version; url=$url;
      packageSha256=$packageObserved; dllSha256=$assemblyObserved;
      referenceName=$item.Dll; referenceInPackage=$dlls[0].FullName.Substring($folder.Length+1)
    }
    # Environment becomes available ONLY after all references verify below.
    if ($item.Name -eq 'RPH') { $rphPath=$dlls[0].FullName } else { $damagePath=$dlls[0].FullName }
  }
  "W09_RPH_DLL_PATH=$rphPath" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  "W09_DAMAGE_DLL_PATH=$damagePath" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  $receipt.status='pass'
  $receipt.reason='Two SHA-approved upstream SDK-only assembly references, compile-only, never redistributed'
  Write-Output 'W09 approved NuGet compile-only SDK references verified'
} catch {
  $receipt.status='fail'
  $receipt.reason=$_.Exception.Message
  Write-Error "W09 SDK verification failed: $($receipt.reason)"
} finally {
  $receipt | ConvertTo-Json -Depth 6 | Set-Content "$receiptDir/w09-sdk-preparation.json"
}
