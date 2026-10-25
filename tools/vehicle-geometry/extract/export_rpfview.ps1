param(
    [Parameter(Mandatory=$true)][string]$RpfViewCli,
    [Parameter(Mandatory=$true)][string]$GameRoot,
    [Parameter(Mandatory=$true)][string]$OutputRoot
)
$ErrorActionPreference='Stop'
$game=[IO.Path]::GetFullPath($GameRoot).TrimEnd('\')
$out=[IO.Path]::GetFullPath($OutputRoot).TrimEnd('\')
if($out.StartsWith($game+'\',[StringComparison]::OrdinalIgnoreCase) -or $out -eq $game) { throw 'OutputRoot must be outside the installed game directory.' }
if(!(Test-Path -LiteralPath $RpfViewCli -PathType Leaf)){throw 'RPFView CLI executable was not found.'}
if(!(Test-Path -LiteralPath $game -PathType Container)){throw 'GameRoot was not found.'}
New-Item -ItemType Directory -Force -Path $out | Out-Null
$models=@('x64e.rpf\levels\gta5\vehicles.rpf\buffalo_hi.yft','x64e.rpf\levels\gta5\vehicles.rpf\buffalo.yft')
foreach($model in $models){
    & $RpfViewCli export-model $model --out $out --game $game --game-type gta5 --lod high --no-texture-search
    if($LASTEXITCODE -ne 0){throw "RPFView failed for $model (exit $LASTEXITCODE)."}
}
Write-Host "Export complete. Game archives were read only; outputs are under $out."
