# X7.3 local validation — FAIL, one shot

Operator and publisher: Codex. October 22, 2026, 15:05 EDT. Tested draft PR #301 at `e981819b79c50409812ff34f0bde746943416edf`, in isolated branch `validation/x73-local-20261022`, based directly on `feature/x73-live-impact-selector-cloud-20261022`. Existing PRs remain unmerged.

**X7.3 is not ready to close; X8 cloud implementation should remain blocked on its live acceptance.** This test did not establish automatic selection or native fracture. There was no second shot, live retune, or second restore attempt.

| Gate | Recorded result |
| --- | --- |
| Offline selector | PASS: 15 tests, 120,221 assertions |
| Python X7 / smoke | PASS: 12 / 9 tests before trial; 10 smoke tests after reporting-only fix |
| Controller / actual C# protocol | PASS: 16 / 16 scenarios; protocol uses offline stubs |
| Generation | PASS: byte-for-byte unchanged generated driver |
| Installed SHVDN compile | PASS: complete script compiled against installed Enhanced API; runtime also reported successful compilation |
| Baseline | PASS: original 9/9, dormant twin 0/9 |
| Commands | Prepare, camera and shot DONE; shot gameplay acceptance failed; one restore ERROR |
| Automatic selection | FAIL / not observed: no `x7_selection`; accepted projectile not seen, no commit |
| Actual predicted impact / pair | Unavailable / unavailable; never inferred from aim coordinates |
| Native fracture | FAIL: no commit, zero native parts; all five replacement sections stayed dormant |
| Other three protected / colliding | Not exercised: no selected pair or active replacement |
| Player traversal | NOT RUN: correctly suppressed after shot acceptance failed |
| Environmental traversal obstruction | NOT ASSESSED; this failure is not the historical [1,2] traversal result |
| Original world restoration | FAIL: 6/9, three other hits, `restoredToOriginal=false` |
| Shutdown / filesystem | PASS: normal quit, GTA absent; all four original SHA256 match, all three temporary files absent; add-on renames absent |
| Ownership / evidence | PASS: pending null, same-owner release after recorded restoration; all 12 collected file hashes verified |

## Exact runtime and one-shot evidence

Candidate, installed and loaded driver SHA256: `9892143a69f465b78259829808584a8a4ec8c1e4f7db87d335946d153bbbb9c1`. Runtime PID `53320`, loaded `2026-10-22T19:05:11.3114160Z`, SHVDN API 3.9.0, game build 2.0.1158.16. Approved identity is in `expected.json`; startup compilation is in `shvdn-live.log`. Session `x73-one-shot-20261022`, owner `codex`, experiment `X7.3-p2-auto-impact`.

The unmodified PR #301 smoke adapter ran `prepare → camera → one native RPG firing call`. Its shot acceptance guard stopped before walk, then requested one same-owner restore. No request timed out or was resent. The restore terminal receipt was ERROR, correctly preserving `original_restore_requires_9_of_9`.

Correlated requests and raw logs are preserved under `live/evidence/`, with `live/request-ids.json` and a SHA256 inventory. Shot request `f5715c9a079c4750b8d93b9159b22333`, run `20261022-190534-db7fdf`; restore request `74c1a00d9c5c429eb2850b5294e04308`, run `20261022-190543-4c1519`.

Recorded launch coordinates: `(1068.386,-1771.470,36.750)`; intended aim `(1065.415,-1772.563,35.551)`. These are **launch/aim coordinates, not measured impact coordinates**. The native firing call was `SHOOT_SINGLE_BULLET_BETWEEN_COORDS` with RPG; actual projected impact U/V and a selected pair were never logged. Selection remains governed by the unmodified pure policy: U=0 selects [1,2]; a genuinely positive U can select [2,3].

`x7_result`: `projectileSeen=false`, `committed=false`, `nativeParts=0`, `originalBlocked=0`, `twinBlocked=0`, `late=false`, `explosionFrame=-1`. The accepted-candidate trace is empty, and the commit-gated collision probe ran zero frames. `x7_secstate` records five existing/attached/root-alive props, all invisible and unselected. This is a failed activation, not successful neighbor protection.

## Diagnosis and focused reporting correction

The current loop sets `seen` and writes `x7_track` only after the projectile passes baseline-handle exclusion and `TryPredictAndSelect`. Enumeration errors and rejected samples are not recorded. Script-mode explosion observation is also gated by `seen`. Consequently, `projectileSeen=false` and `late=false` do not prove that no physical RPG existed or no explosion occurred. The raw record cannot distinguish an excluded handle, enumeration failure, direction/speed rejection, out-of-sheet projection, or horizon rejection. None is established as the root cause. Collision witnesses dropping to zero without a commit also do not establish a successful model hide. Original damage/reacquisition is a hypothesis for the later 6/9 restoration, not a proven object identity.

One demonstrated analyzer defect is corrected: `original_hidden_after_swap` now also requires `committed=true`. A regression covers collision loss without a commit. Reanalysis from the identical immutable rows is in `analysis-after-reporting-fix.json`; the original `live/verdict.json` is preserved unchanged, including its misleading original hidden-after-swap field. The overall FAIL is unchanged. No selector, native driver, generator, asset, collision behavior, protection flag, or horizon changed. The reporting fix was not installed or live-tested.

The next diagnostic change, if undertaken, should record bounded rejected-candidate reasons/raw projectile samples and independent explosion observation before another separately authorized shot. No root-cause gameplay fix is claimed from missing evidence. No broad matrix or orchestration change is proposed.

## Restoration and handoff

Before install, GTA and RAGEPluginHook were absent, prior file hashes matched #300's rollback receipt, no unresolved P2 ownership/slots remained, and a fresh independent preinstall snapshot was hash-verified. The established X7d installer backed up affected paths, installed the existing pack and candidate, and reversibly renamed both DLSS add-ons. GPU preflight independently verified the existing 80% / 460 W power cap; full preset state is not asserted.

After the one failed 6/9 world restore, normal Alt+F4 / confirmation quit ended GTA. Stopped-process rollback used the same backup. `installer-restored.json`, `filesystem-restoration.json` and `shutdown.json` preserve filesystem results independently of the failed live world result. `handoff.json` records both outcomes before ownership release; `controller-before-release.json` has pending null and the ERROR response; `controller-release.txt` records release. No GTA session remains and no new live test is authorized.

## Independent CLI review limitation

Chris explicitly approved transmitting the candidate source and this trial's logs to Claude Sonnet through the existing coordinator. One read-only Sonnet/high task `62d9d769383648ed8c96bd0a0bcbacb8` timed out at its 180-second bound with no stdout, stderr or substantive review. The coordinator terminated its process tree; the recorded Claude PID was independently confirmed absent and the queue was stopped. No review success, root-cause confirmation or peer approval is claimed. No retry or model upgrade occurred. Selection, argv, timeout status and reconciliation receipts are retained in `coordinator/`. The reporting correction is small and covered by Codex's regression; no difficult runtime change was made without independent review.
