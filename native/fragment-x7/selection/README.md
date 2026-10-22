# X7.2c offline impact selection

`ImpactSectionSelector.cs` is pure C# (language version 7.3 in its test build), with no GTA, SHVDN, native calls or package dependencies. The driver does **not** call it yet. It does not turn native fracture on, swap models or mutate a fence.

Run from the repository root with a .NET 8 SDK/runtime installed:

```powershell
dotnet run --project native/fragment-x7/selection-tests/SelectionTests.csproj --configuration Release
```

The console harness links the exact selector source, exits nonzero on any failed assertion, and checks the frozen dimensions against `spec.py`. The local NuGet configuration clears package feeds, so this build needs no package download.

`TrySelect(projectedU, projectedV, out selection)` takes the **predicted face intersection**, never the scripted aim or the projectile's present U. Coordinates use the whole-sheet frame: U=0 at centre, V=0 at the sheet bottom. NaN, infinity and intersections outside the 2.536m x 2.131m sheet are rejected; no misses are clamped onto an edge. Bounds themselves are inclusive. The non-sheet upper band, including the rooted rail below the 2.351m post height, is excluded. Plain sec1 drawable height is 2.22m; the post variant reaches 2.351m.

The policy selects the adjacent pair whose midpoint is closest to projected U. Exact ties choose the lower physical index. This yields masks `00011`, `00110`, `01100`, `11000` (bit 0 is the negative-U section). Centre chooses positions [1,2], U=-0.65 chooses [0,1], and U=+0.65 chooses [3,4]. These are physical positions; the existing `x7SecLabs` insertion order is [2,0,1,3,4].

`TryPredictAndSelect` accepts local U/T/V position and velocity. T must increase toward the selected front face. It requires normal speed >3m/s, rejects samples already beyond the face, and accepts the hit only within a positive caller-supplied horizon capped at 250ms. The cap is a proposed bounded offline policy, not a measured safe arming interval or a stale-sample detector; the driver must still supply its actual current commit horizon. The helper is linear and one-sided, matching the present approach basis. Projectile identity, sample freshness, obstructions, acceleration, opposite-side impacts, native call timing and actual breakage require separate adapter checks and gameplay evidence.

On `false`, ignore the default output. On `true`, an adapter must validate live entity ownership and latch the result **once** at commit. Later samples and subsequent impacts must not change the latched profile or recreate missing pieces. This stateless module deliberately provides no retry, restoration or second-impact lifecycle.

Bounds and ties use actual double values. Widening a GTA float does not recover an exact decimal: `(double)(float)1.268` lies slightly outside the nominal edge and is rejected, while `(double)(float)0.5072` lies above the pair tie. Float-origin tests preserve this fail-closed behavior. Do not add a broad tolerance or clamp a miss during integration.
