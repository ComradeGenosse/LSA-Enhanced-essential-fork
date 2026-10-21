# ASTRA-001 X3 — Phase 1 closeout (review response, cleanup fix, accepted limitations)

Date: 2026-10-21. Scope: close X3 draft PR #290 only. Nothing in X4 was started. The X2 branch/PR #289 was not touched.

## 1. What this closes

X3 stopped PARTIAL (`12-X3-REPORT-20261021-PARTIAL.md`). The owner's review of PR #290 found one defect that must be fixed (P0) and several interpretation limits (P1/P2). This document records the response to each, the fix, the one targeted validation run, and the limitations that are **explicitly accepted** rather than re-tested. The X3 test matrix was **not** repeated.

**Original X3 results and verdicts are preserved unchanged.** No historical gate classification, analyzer output, evidence file, report text or run file was edited. The only new evidence is one run, `x3-evidence/runs/P1-cleanup-20261021-150938-8e5dd5.*`, which is a regression check of the fix and is not a gate result. The 180-row per-frame timing file for that run was not published; its summary is the `perf` row in the jsonl (mean 8.1 ms, p99 11.4 ms, max 12.1 ms over the 180-frame burst).

## 2. Review response

| # | Finding | Response |
|---|---|---|
| P0 | `ScanDebris` adds any new non-pre-snapshot prop to `debris`; `CleanupAll` deletes everything in `debris`, so ambient GTA props that stream in near the wall can be deleted. | **Fixed in driver X3-0.3** (section 3). Validated once (section 4). |
| P1 | "6/8" is a sphere-detector result, not proof of a hard cap; per-wall detached counts disagree on launch 2 (n6 `[14,14,15,0,0,0]`, n8 `[0,15,15,0,0,0,0,15]`). | **Accepted, not re-tested.** The n=8 outcome is a detector outcome (it detected fracture/openings on 6 of 8 walls); the data do not show a hard engine cap, and no cap is claimed. Left as reported. |
| P1 | The global prop-count delta conflates our debris with unrelated streaming. | **Accepted, not re-tested.** The prop-count delta is an upper bound that includes ambient streaming. The cold-run spikes (405/506 ms, +67 props) remain unattributed between lab-owned and ambient props. X3-0.3 now separates owned vs ambient *deletions* (section 3) but does not retroactively split historical counts. |
| P2 | Freeze trial confounders; 19/20 anchor-face result may be ray occlusion. | **Accepted, not re-tested.** The freeze comparison is treated as indicative only. The n=6 anchor-face artifact was already attributed to foreign-debris ray occlusion; both the as-committed and prereg-literal analyzer verdicts remain reported, unchanged. |

## 3. The fix (driver `X3-0.3`, `native/fragment-x3/WpsBreachLab.3.cs`)

Deletion is now ownership-verified at the moment of deletion. A handle is deleted only if it still exists, is a `Prop`, is not itself a lab handle, `HasBeenDetachedFromParentEntity` is true, and `ParentEntityDetachedFrom` is one of this lab's walls (checked against `labHandles` and the `owned` list). Re-verifying at deletion time also protects against stale handles being reused for a different entity.

- `CleanupAll` now calls `CleanupDebris()`, which deletes only verified lab debris. Anything else is left alone, counted as `cleanupSkippedAmbient`, and (first 25) logged as `x3_cleanup_skipped` with handle and model hash.
- `DoDelete` (used by the freeze/cull management modes) uses the same guard, and `MgmtCandidates` additionally filters on `IsVerifiedLabDebris`.
- `x3_leak` rows now carry `cleanupDeletedOwned` and `cleanupSkippedAmbient`.
- **Classification is intentionally unchanged.** Newly appearing ambient props still count as debris in ray masks and perf telemetry (that is how the original results were produced). Only *deletion* is guarded. This keeps the preserved results comparable.
- New verb `x3cleanuptest` and batch `batches/P1-cleanup-regression.txt`; new checker `tools/x3_cleanup_check.py`. `tools/x3_analyze.py` is unchanged.

Driver SHA-256: `7d28c099a8ca25864bf0d2cbbaa7fe1d18d760d6723621b5ea895de1cdafe003` (X3-0.2 was `9351fe6f…`). Compiled by the in-game SHVDN compiler (loaded, IDLE, SHA matched the installed file).

Note: the original README sentence that management "only ever touches" detached props was true of the management modes but not of end-of-trial cleanup; that is the P0 defect and is now corrected in the README.

## 4. Minimal targeted validation

One launch, one wall, one grenade, one run (`P1-cleanup-regression`), Story Mode offline. Two unrelated sentinel props (`prop_roadcone02a`) were created by the script and are not lab-owned: a control created before the pre-blast snapshot, and one created *after* the snapshot, which is exactly the "new ambient prop" case the old cleanup would have deleted.

| Check | Result |
|---|---|
| Native fragments detected as detached from the wall | 16 (all alive before cleanup) |
| Post-snapshot sentinel was in the old delete set (bug scenario reproduced) | true |
| Post-snapshot sentinel survives cleanup | **true** |
| Pre-snapshot sentinel survives cleanup | **true** |
| Lab fragments remaining after cleanup | 0 (16 deleted as verified lab debris) |
| Wall removed | true |
| `cleanupSkippedAmbient` | 1 (the post-snapshot sentinel, logged with its model hash) |
| Error rows | 0 |
| `pass` | **true** |

Honest limits of this validation: the sentinels are script-created stand-ins for streamed world props, not props the game streamed in by itself; the freeze/cull management path shares the same guard but was verified by code review and compile only, not exercised in game; this is one run, not a statistical claim. It was deliberately kept this small per the instruction not to repeat the matrix.

## 5. Explicitly accepted remaining limitations

The owner accepts these as-is; none block closing X3. They stay open as stated facts about the evidence, not as passes.

1. Launch 1 had a ~7 ms frame baseline and launch 2 ~26 ms; cause unknown, so cross-launch frame-time comparisons are not clean.
2. n=6 anchor-face result is a foreign-debris ray-occlusion artifact (both verdicts reported).
3. n=8: 6/8 is a detector outcome, not a proven hard cap; per-wall detached counts disagree between runs.
4. Cold-run spikes (405/506 ms, +67 props) are unattributed between lab-owned and ambient props.
5. B matrix covered 2 of 20 planned trials; C, D, the player demo, the MOD stage and 3-launch repeatability were not run.
6. Debris count is not the same as a usable opening; X3 does not show that fragment counts translate to a traversable gap.
7. Freeze-trial results have confounders and are indicative only.
8. Historical X3-0.2 runs used the old cleanup; whether it deleted any ambient props in those runs is not quantified. The fix removes the possibility going forward.

## 6. Environment

Install restored after the test: loader INI `c9ecd8e2…` (byte-for-byte), deployed script back to the X2 driver `5be72312…`, pack `180618ad…` untouched, GTA closed through Steam. No original game files were modified.
