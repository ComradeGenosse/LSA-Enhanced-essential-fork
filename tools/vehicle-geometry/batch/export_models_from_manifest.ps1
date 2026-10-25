param(
    [Parameter(Mandatory=$true)][string]$ManifestCsv,
    [Parameter(Mandatory=$true)][string]$RpfViewCli,
    [Parameter(Mandatory=$true)][string]$GameRoot,
    [Parameter(Mandatory=$true)][string]$OutputRoot,
    [ValidateRange(1,200)][int]$MaxModels=20
)
$ErrorActionPreference='Stop'
$game=[IO.Path]::GetFullPath($GameRoot).TrimEnd('\')
$out=[IO.Path]::GetFullPath($OutputRoot).TrimEnd('\')
if($out.Equals($game,[StringComparison]::OrdinalIgnoreCase) -or
   $out.StartsWith($game+'\',[StringComparison]::OrdinalIgnoreCase)) {
    throw "Export directory must be outside the installed GTA files."
}
foreach($file in @($ManifestCsv,$RpfViewCli)) {
    if(!(Test-Path -LiteralPath $file -PathType Leaf)){ throw "Missing file: $file" }
}
if(!(Test-Path -LiteralPath $game -PathType Container)){throw "Game root not found."}
$entries=@(Import-Csv -LiteralPath $ManifestCsv)
if($entries.Count -lt 1){throw "Empty export manifest CSV."}
New-Item -ItemType Directory -Path $out -Force | Out-Null
$report=@()
$count=0
foreach($v in $entries) {
    if($count -ge $MaxModels){break}
    $model=([string]$v.model).ToLowerInvariant()
    $asset=[string]$v.assetPath
    if($model -cnotmatch '^[a-z][a-z0-9_]{0,31}$' -or
       [string]::IsNullOrWhiteSpace($asset) -or
       $asset.Contains('..') -or
       $asset -notmatch '(?i)\.rpf[\\/]' -or
       $asset -notmatch '(?i)\.yft$') {
        $report+= [pscustomobject]@{model=$model;status='SKIP_INVALID';asset=$asset}
        continue
    }
    $count++
    & $RpfViewCli export-model $asset --out $out --game $game --game-type gta5 --lod high --no-texture-search
    $result=if($LASTEXITCODE -eq 0){'EXPORTED'}else{"FAILED_EXIT_$LASTEXITCODE"}
    $report+= [pscustomobject]@{model=$model;status=$result;asset=$asset}
    Write-Host "$model : $result"
}
$report | Export-Csv -Path (Join-Path $out '_vh8-extraction-results.csv') -NoTypeInformation
Write-Host "Local extraction complete. No GTA game files were modified."
