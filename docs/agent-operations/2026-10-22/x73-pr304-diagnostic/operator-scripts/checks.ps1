$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot 'repo')
$out=Join-Path $PSScriptRoot '..\outputs'
function Check($name,[scriptblock]$action){ & $action *> (Join-Path $out ($name+'.txt')); if($LASTEXITCODE -ne 0){throw ($name+' failed')}; Write-Output ($name+' PASS') }
Check generation {python native/fragment-x7/build_x7.py; git diff --exit-code -- native/fragment-x7/WpsBreachLabX7.3.cs}
Check python-x7-tests {python -m unittest discover -s native/fragment-x7 -p 'test_*.py' -v}
Check smoke73 {python -m unittest discover -s tools/gta-controller -p test_smoke_x73.py -v}
Check smoke72 {python -m unittest discover -s tools/gta-controller -p test_smoke_x72c.py -v}
Check controller {python -m unittest discover -s tools/gta-controller -p test_controller.py -v}
Check runtime {python tools/gta-controller/test_runtime_offline.py}
Check selection {dotnet run --project native/fragment-x7/selection-tests/SelectionTests.csproj --configuration Release}
Check source {python native/fragment-x7/test_live_selector_source.py}
foreach($v in '','b','c','d'){Check ('validate'+$v) {python ('native/fragment-x7/validate_x7'+$v+'.py')}}
$g='C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'
Check shvdn-compile { & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:library /out:..\WpsBreachLabX7.dll /reference:"$g\ScriptHookVDotNet3.dll" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll native\fragment-x7\WpsBreachLabX7.3.cs }
git rev-parse HEAD
