# One-shop, read-only geometry study

Read [RESULTS.md](RESULTS.md) for the **NO-GO**, exact wall coordinates, owner IDs and bounded next step. [evidence.json](evidence.json) is derived metadata; the private raw geometry is deliberately excluded.

## Reproduce on the Windows host

Requires .NET 8 SDK, the installed CodeWalker.Core 30_dev48/SharpDX files, GTA V Enhanced archives, and Python with numpy. No GUI or GTA launch is used. Outputs must point outside the repository and outside the game installation.

```powershell
$study = 'C:\path\to\repo\native\gta-interior-catalog\studies\v_clotheslo-1693'
$cw = 'C:\Users\Chris.COMRADE\Documents\Codex\tools\CodeWalker30_dev48'
$game = 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'
$scratch = 'C:\path\to\private\scratch'
New-Item -ItemType Directory -Force "$scratch\bin", "$scratch\raw" | Out-Null
dotnet build "$study\extractor\extractor.csproj" -c Release -o "$scratch\bin" "-p:CodeWalkerDir=$cw"
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
Copy-Item "$cw\ShadersGen9Conversion.xml" "$scratch\bin\"
Copy-Item "$cw\ShadersGen9Conversion.xml" "$scratch\"
Push-Location $scratch
try {
    dotnet "$scratch\bin\extractor.dll" $game "$scratch\raw"
    if ($LASTEXITCODE -ne 0) { throw 'Extraction failed' }
} finally { Pop-Location }
$env:X9_RAW = "$scratch\raw\focused.jsonl"
python "$study\analyze_wall.py" "$scratch\derived-evidence.json"
python -m unittest discover -s $study -p test_geometry.py -v
```

Review the emitted `errors` and `collisionScan.errors` before relying on the output. A finished process is not sufficient if a resource failed to parse. The committed final run reports zero errors. NU1900 vulnerability-feed reachability was a build warning in this sandbox; compilation succeeded and this study introduces no NuGet package dependency.

The reader enumerates archive metadata to locate this shop and its hierarchy. Geometry inspection retains this shop's YDRs, its three LOD dictionaries, immediate adjacent structures/nearby placed props, and collision resources intersecting the shop region. The all-YBN query avoids missing an override with an unrelated name; it does not survey other candidate sites. Broadphase is followed by two-sided triangle rays, polygon clipping and oriented-box reconstruction. Capsule/cylinder/sphere bounds are screened separately; none overlaps the investigated passage prism.

The analysis transforms every primary MLO entity with its own inverse raw rotation, then the MLO instance orientation. Ordinary map entities use the actual `YmapEntityDef.Orientation` emitted by the installed DLL. These conventions match [CodeWalker's entity constructors](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/FileTypes/YmapFile.cs). Polygon vertex positions already incorporate geometry centre and the bound's transform; they are not transformed twice. Box corners are reconstructed using the same axis construction as [CodeWalker's collision code](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/Resources/Bounds.cs). The installed DLL, not a moving upstream branch, produced the evidence.

Archive variants/resolutions are reported separately. Their union is a coverage query, not a simulated active game scene. Entity sets are recorded by the reader but not claimed active by the geometry analysis. This limitation cannot change the NO-GO: the shared shell/world collision owners alone already preclude a simple isolated replacement.

Do not commit `focused.jsonl`, resource exports, the CodeWalker DLLs, textures, game keys or other proprietary payloads. The final `provenance.json` records their hashes/identities without distributing them.

## Offline cut continuation

See [CUT-PLAN.md](CUT-PLAN.md) for the implemented partition oracle, exact scope,
instance-specific clone/rebind plan and deployment blockers. Run the public
synthetic/preservation suite with:

```sh
python -m pip install numpy==2.2.6 scipy==1.15.3
python -m unittest discover -s native/gta-interior-catalog/studies/v_clotheslo-1693 -p 'test_*.py' -v
```

The #321 continuation originally did not run private geometry. The local Windows
continuation has now done so; see [REPLAY-AND-ALTERNATIVES.md](REPLAY-AND-ALTERNATIVES.md)
and `replay-results.json` for the actual replay, corrected authorization,
profile-specific glazed alternative and remaining deployment blockers.
