# X7.3 projectile-candidate diagnostic (cloud-only)

## Confirmed from immutable evidence

- Successful X7.2c trial in #300 and failed X7.3 trial in #303 use the same scripted RPG launch/aim, `aimU=0`, `aimV=0.8`, `horizon=60` ms and `frameK=1.5`; the pre-fire corridor raycast did not report an obstruction in either.
- X7.2c logged 74 accepted-frame `x7_track` records and committed four frames/28 ms before its observed explosion; exactly two native sections fractured, the player crossed, and world restoration was 9/9.
- X7.3 logged no accepted `x7_track`, no `x7_selection`, no commit, and zero native parts. The original fence lost all nine original witness hits after the shot and restored only 6/9. File hashes and controller rollback still passed.
- These observations do **not** reveal whether X7.3 saw a projectile and rejected it, excluded a preexisting handle, received an empty/null projectile query, or encountered an unobserved explosion. An old `projectileSeen=false` meant *no accepted selector candidate*, not *no physical projectile*.

## Change in this branch

Read-only diagnostic probes in `WpsBreachLabX7.3.cs`, reproduced declaratively by `live_selector_changes.json`:

- Enumerate query frames, empty/null/exception returns, excluded baseline handles, non-existent candidates, observations and unique new handles.
- For new candidates, record the first sample for each reason and a last-48-sample rolling buffer: frame, native handle, world position/velocity, local U/T/V and velocity components, projected time to face, and the current dynamic commit horizon.
- Explain rejections in observational code: nonfinite data, insufficient forward speed, already beyond face, beyond 250 ms, outside U or V bounds, or an unclassified rejection. Report eligible-but-not-yet-ready separately from ready candidates.
- Independently check for a nearby explosion **only while no candidate has been accepted**, without changing the original explosion event, `late` logic, commit state or break conditions.
- Flush the bounded diagnostic rows after shot sampling (not per frame); do not log arbitrary world state or alter the native damage path.

**Not changed:** the tested pure `ImpactSectionSelector`, selected-pair policy, native damage/physics, P2 protocol, launch coordinates, horizon thresholds, single-shot authority, traversal, or restoration implementation. No synthetic explosion, fallback, or selector coercion.

## How to interpret the next *separately approved* one-shot live trial

| Evidence | What it would suggest |
| --- | --- |
| `queryErrors > 0`, `nullResults` or `emptyResults` dominates, `newObservations=0` | Projectile enumeration/availability problem; inspect query environment before touching geometry |
| `baselineExcluded > 0`, few/no new observations | Existing projectile handle exclusion or handle reuse; compare handles and baseline |
| `x7_diag_count` dominated by `normal_speed` / `behind_face` | Local velocity/face orientation and projectile motion disagree; inspect raw frame samples |
| `beyond_prediction_window` then no eligible samples | Window/visibility/timing gap, not necessarily a selector geometry bug |
| `outside_sheet_u` or `outside_sheet_v` | Predicted impact misses the protected sheet; do **not** bias selection for a passing traversal |
| `eligible_early` / `eligible_ready` recorded but no commit | Check ready arbitration and candidate preflight; don't assume the selector is wrong |
| Independent nearby explosion observed without accepted projectile | The RPG or another explosion likely occurred; source identification still requires corroboration |
| No explosion observation, 6/9 restore | Scene collision/witness inconsistency remains possible; no restoration root cause proven |

A one-shot handoff must continue to verify native fracture, three neighbors, traversal only after valid fracture, world restoration 9/9, stopped-game hash restoration, and P2 ownership release. Diagnostic capture itself does not constitute gameplay acceptance.

## Verification

The new `test_x73_diagnostics.py` checks policy-preserving source guards, bounded diagnostics and a frozen-evidence comparison. Existing source-generation tests must reproduce `WpsBreachLabX7.3.cs` byte for byte and all X7 CI checks must pass. The hosted CI runner cannot validate native SHVDN compilation against the installed Enhanced game API or observe a GTA projectile; those remain local validation tasks.

No GTA started, no local Windows files touched, no shot authorized or retried, no merges.
