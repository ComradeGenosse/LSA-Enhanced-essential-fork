# X7.2c offline validation receipt

October 22, 2026; Windows / PowerShell; .NET SDK 10.0.301 targeting net8.0 with C# 7.3. Based on X7 head `a613f8e2987fba85e63c4444b61b8d037dc2b56c`. Results cover this change's pure selector and source tooling, not GTA/native behavior.

| Check | Result |
| --- | --- |
| `dotnet run --project native/fragment-x7/selection-tests/SelectionTests.csproj --configuration Release` | **PASS: 15 deterministic tests, 120,221 assertions.** The exact selector source is linked into the package-free harness. Includes float-origin edge/tie regression. |
| `python -m unittest discover -s native/fragment-x7 -p 'test_*.py' -v` | **PASS: 12 existing tests.** |
| `python native/fragment-x7/build_x7.py` then `git diff --exit-code -- native/fragment-x7/WpsBreachLabX7.3.cs` | **PASS: runtime byte-identical to baseline.** |
| `python native/fragment-x7/validate_x7.py` | **PASS: source checks; real exports not validated.** |
| `python native/fragment-x7/validate_x7b.py` | **PASS: source geometry checks; no native gameplay proof.** |
| `python native/fragment-x7/validate_x7c.py` | **PASS: source checks; real exports/traversal not tested.** |
| `python native/fragment-x7/validate_x7d.py` | **PASS: source checks; real exports/gameplay not tested.** |
| Local Markdown target resolution and `git diff --check` | **PASS.** |

Runtime SHA-256 before and after regeneration: `e16d89ad3c48faa86416f649ba3d52cea0093e4d064fed3f4276fd7f7975750d`.

The generator repair was additionally checked using a scratch-copy mutation of a source anchor: drift rejects before output is written. CI now runs the C# harness and the independent-section source validator, alongside existing Python tests and driver reproduction.

No GTA launch, game DLL compilation, Blender/CodeWalker export, asset rebuild, game installation, native fracture/protection test, traversal test or new restoration test was performed. Prior committed gameplay evidence is cited in the design and remains scoped to its original runs. The selector is not wired into the runtime. [Gameplay discriminators](X7.2c-design.md#required-gameplay-discriminators-and-acceptance) remain required; this receipt does not pass X7a/X7b/X8 or authorize merging.
