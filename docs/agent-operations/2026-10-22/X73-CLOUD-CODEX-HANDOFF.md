# X7.3 cloud → local Codex handoff

**Draft PR:** #301 (directly based on draft #300). No GTA launch, Windows access, deployment or merge during cloud implementation. [X7.3 PR](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/301).

## Geometric authority and center obstacle

The existing pure `ImpactSectionSelector` is authoritative. It uses the RPG's **predicted physical sheet-face intersection U/V**, not `aimu`, any prepared `sel=` pair, the player position, or the section insertion order. Five physical sections of width 0.5072 m cover [-1.268,1.268] U; sheet V is [0,2.131]. Exact ties choose the **lower** physical index.

| Actual predicted U | Permitted pair |
| --- | --- |
| [-1.268,-0.5072] | [0,1] |
| (-0.5072,0] | [1,2] |
| (0,0.5072] | [2,3] |
| (0.5072,1.268] | [3,4] |

Historical corrected X7.2b evidence (`native/fragment-x7/evidence/x72b/RESULTS.md`) shows center [1,2] fractured but the player failed to traverse because of a **separate static map obstruction** (`no_clear_lane_0.9m`). The center-v2 [2,3] preset produced a traversable lane. Both presets were assigned *before* the shot. X7.2c's successful preselected [2,3] center test does NOT prove the automatic geometric center should select [2,3]. At mathematical U=0, [1,2] is valid, regardless of whether a player can traverse it. For an actually positive predicted U, [2,3] can validly be chosen. Never bias, offset, or clamp the selector to make a walk test pass. Preserve raw projected U/V, chosen positions and third-party collision hits.

## Expected gameplay — predictions, not GTA claims for #301

A single clean RPG within the face/horizon should commit a real hot swap, with **all five native sections visible and solid**. Only the predicted two adjacent sections have native damage/fracture enabled; the other three remain anchored, colliding, visible and protected. The real RPG should create exactly **two native detached sheets** and a nominal 1.0144 m gap. No scripted detach, synthetic explosion, collision disablement to fake a gap, or ambient-prop deletion. The original should be hidden at commit and restored **9/9 collision witnesses** after one restore; subsequent stopped-game rollback must match every pre-install file hash.

A valid center [1,2] selection can yield (a) **selection correct**, (b) **native fracture PASS**, and (c) **player traversal BLOCKED** due to an independent static map object. Preserve the separate verdicts; overall gameplay is then partial/fail. If the measured projectile intersection is slightly positive, [2,3] may legitimately result and may be traversable based on previous manual evidence. No gameplay result for #301 exists yet.

The test is scoped to one existing site, 2.5 m j1400 fence and controlled RPG. One eligible newly seen projectile must enter the 60 ms plus 1.5× frame-duration commit window (never above 250 ms); baseline projectiles, invalid/receding/passed-face/out-of-sheet samples are not eligible. SHVDN projectile owner/weapon is not independently established. Multi-impact and multi-projectile scenes are NOT covered; no auto retry or fallback.

## Offline tests and source build — runnable without GTA

From repo root:

```powershell
dotnet run --project native/fragment-x7/selection-tests/SelectionTests.csproj -c Release
python -m unittest discover -s native/fragment-x7 -p 'test_*.py' -v
python -m unittest discover -s tools/gta-controller -p 'test_smoke_x73.py' -v
python native/fragment-x7/test_live_selector_source.py
python native/fragment-x7/build_x7.py
git diff --exit-code -- native/fragment-x7/WpsBreachLabX7.3.cs
```

The GitHub `.github/workflows/astra-x7.yml` also checks earlier P2 smoke cases and source validators. Green GitHub Actions checks do not establish SHVDN runtime compilation or gameplay success.

## Local Codex: single narrowly scoped Windows/GTA acceptance

**Do not execute live steps without the user's explicit new authorization.** Codex owns the local test and report; no parallel agents touch GTA or its controller. Before operations, read `docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md` and the validated #300 receipt in `docs/agent-operations/2026-10-22/p2smoke-repair/README.md`. Confirm clean candidate branch/HEAD and store SHA256 of the candidate C# script.

1. **Prepare stopped game:** Confirm `GTA5_Enhanced` and `RAGEPluginHook` processes absent, no unresolved old P2 controller ownership. Back up and hash affected files. Install ONLY the existing x7d pack and the candidate driver with the same approved stopped-game/backup procedure as #300. Do **not** use `native/fragment-x7/test-install-x7.ps1`, which does not support x7d. The historical installer `native/fragment-x7/evidence/x72c/tools/x7_install.py` supports x7d via environment `X7_VARIANT=x7d`, `X7_PACK_DIR=pack-x7d`, `X7_ASSETS_DIR=assets-x7d` but is **not crash-atomic**. Use it only with a stopped-process gate and fresh, verified rollback manifest, otherwise stop before modifying files. Never hot-copy into a running GTA process.
2. **Start one validated Story Mode session through the existing approved local procedure:** Verify the P2-loaded source SHA against the approved installed candidate (independently of heartbeat), check startup identity `pid`/`loadedUtc`/`scriptSha256` and put those fields into `expected.json`. Check original fence 9/9 and dormant twin 0/9. No other sender/controller is allowed.
3. **Run exactly one bounded center smoke** from the cloned PR #301 repo root, substituting real Windows paths, and using an **unused** evidence destination:

```powershell
$Lab = 'C:\PATH\TO\GTA\WpsBreachLab'
$Expected = 'C:\PATH\TO\approved-expected.json'
$Out = 'C:\PATH\TO\new-x73-evidence' # must not exist
python tools/gta-controller/smoke_x73.py --lab $Lab --owner codex --session x73-one-shot --expected $Expected --out $Out
Write-Host "Smoke exit: $LASTEXITCODE"
```

This uses P2 to run **prepare → camera → one real RPG → native bounded player walk → restore**. It refuses to walk if the shot fails evidence acceptance; on definite failure it requests one same-owner restore. A timeout or malformed pending response is **UNKNOWN**: send no replacement shot, restore, or new lock request. Use the same P2 session's `reconcile` path and retain all receipts. The script's exit 0 requires all gameplay and world checks; exit 2 can still contain scientifically useful correct-fracture/obstructed-traversal evidence.
4. **Reconcile and restore:** Stop GTA through its accepted normal procedure; verify it has exited. Restore game files using the SAME recorded stopped-game backup/manifest, compare original SHA256, confirm temporary files/add-on renames removed or restored. Save independently: commands, real impact projected U/V/pair, section states, native debris, collision mask/foreign entity hits, player crossing, frame-time window, **9/9 original**, and filesystem rollback. Release controller ownership only after any pending request is reconciled and restoration receipts have been recorded.

**Decision rule:** Exactly one live center trial. If selected [1,2] fractured but another map prop blocked traversal, report valid geometric/native result AND blocked traversal separately; do not make [2,3] the answer by changing selection. If any native collision/protection/restore gate fails, report failure and stop. No automatic merge, re-shot, threshold tuning, wider matrix or new agent work.

## Model/cost guidance

Codex is sole implementer/test owner. Use strong available reasoning only for ambiguous physics or code-design decisions; use inexpensive routine reasoning for running predefined checks. No idle two-model loop or automatically selecting Opus/ultra/Astra.
