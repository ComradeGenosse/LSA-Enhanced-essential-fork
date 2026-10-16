# Discovery only: fingerprint official NuGet SDK packages before an explicit
# versioned pin is reviewed. Never compile against unpinned bytes or upload DLLs.
$ErrorActionPreference = 'Stop'
$items = @(
  @{ Id='ragepluginhook'; Version='1.124.0'; Dll='RagePluginHook.dll' },
  @{ Id='damagetrackerlib'; Version='2.0.0'; Dll='DamageTrackerLib.dll' }
)
$dest = Join-Path $env:RUNNER_TEMP 'w09-sdk-discovery'
New-Item -ItemType Directory -Force $dest | Out-Null
$entries = @()
foreach ($item in $items) {
  $packageName = "$($item.Id).$($item.Version)"
  $url = "https://api.nuget.org/v3-flatcontainer/$($item.Id)/$($item.Version)/$packageName.nupkg"
  $archive = Join-Path $dest "$packageName.zip"
  Invoke-WebRequest -Uri $url -OutFile $archive
  $packageHash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  $expanded = Join-Path $dest $packageName
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
  $dlls = @(Get-ChildItem -LiteralPath $expanded -Recurse -File -Filter $item.Dll)
  if ($dlls.Count -ne 1) { throw "${packageName}: expected exactly one $($item.Dll), found $($dlls.Count)" }
  $dllHash = (Get-FileHash $dlls[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $relativePath = $dlls[0].FullName.Substring($expanded.Length + 1).Replace('\','/')
  $entries += [ordered]@{
    id=$item.Id; version=$item.Version; url=$url;
    packageSha256=$packageHash; dll=$item.Dll; dllSha256=$dllHash;
    referenceInPackage=$relativePath
  }
  Write-Output "W09_SDK_DISCOVERY id=$($item.Id) version=$($item.Version) packageSha256=$packageHash dllSha256=$dllHash file=$relativePath"
}
$receipt = [ordered]@{ kind='w09-official-sdk-discovery-unapproved'; status='observed'; sources=$entries; approvedForCompile=$false; packaged=$false }
New-Item -ItemType Directory -Force artifacts/memory-k | Out-Null
$receipt | ConvertTo-Json -Depth 6 | Set-Content 'artifacts/memory-k/w09-sdk-discovery.json'
