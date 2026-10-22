param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet('start','stop','status','submit','handoff','cancel','resolve','work')]
    [string]$Action,
    [string]$Queue = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '..\agent-queue'),
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Arguments
)
# Keep arguments separate; never Invoke-Expression or construct a shell command.
& python (Join-Path $PSScriptRoot 'coordinator.py') --queue $Queue $Action @Arguments
exit $LASTEXITCODE
