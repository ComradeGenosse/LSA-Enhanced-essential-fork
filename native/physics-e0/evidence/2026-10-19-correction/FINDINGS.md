# E0 correction verification — 19 October 2026

**Outcome:** E0.0–E0.3 completed in GTA V Enhanced single-player. Automatic destination collision gating and return were verified. The four earlier physics anomalies persisted, including delayed confirmations. `GTA_VERIFIED` means executed observations; it does not accept the complete material/thickness/inside-exit hypotheses.

## Build and recovery

The initial latest successful PR build was head `19bf17e74e04e6ccd4c9497778cef07c44df36dd`, [CI 39254354255](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39254354255), artifact 12186817265. Its ZIP SHA-256 `e4aa30bd5e7b2ff1b7ce346097d157e73d9da16d562fa16a09ffd24b37a4aa7d` matched GitHub, and DLL `cdc4af0b04437ddc7bc5d2148fa01da169d4fcf38ad05b78d37ee77280f885af` matched BUILD-RECEIPT.json. Its automatic suite ran E0.0/E0.1 but stopped with `blocked_safe_navigation_or_collision_timeout` before teleporting or performing physics measurements. See [preserved initial attempt](attempt-1-blocked/analysis.json). This attempt is not counted as 0/30 failed physics checks; none ran.

Two genuine lab defects were corrected on PR #285's experiment branch:

1. [6a019695](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/commit/6a01969548773d8e6a6c5acd63737c8478279c5f): request one bounded remote navmesh region before safe-pavement queries, release the request at suite termination, and record loaded state/query misses/rejections. The earlier code requested collision but no remote navmesh. Native references distinguish [navmesh region requests](https://github.com/citizenfx/natives/blob/master/PATHFIND/AddNavmeshRequiredRegion.md) from collision requests. Missing navmesh was a source-level explanation for the timeout; the successful rerun supports the repair, without proving every possible timeout has that cause.
2. [6f4a9fa0](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/commit/6f4a9fa0eb599ccc876b04749cbcd91588a21363): measure the 800 ms window from the first successful collision poll, resetting on a failed/out-of-area poll. Three late successful polls plus 800 ms since teleport were insufficient to prove 800 ms continuously observed readiness. Added eight temporal regression cases and a navigation source/integration regression to CI. Existing safety gates and safe-coordinate bounds remain enforced.

Final deployed build: **6f4a9fa0eb599ccc876b04749cbcd91588a21363**, successful Windows [CI 39256743463](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39256743463), artifact **12187843894**. All CI jobs passed, including genuine SDK compile/import audit, source tests, installer/packaging tests, analyzer, and navigation regression. Local tests passed **51 offline checks**, navigation regression, installer and package scope tests, analyzer self-test, and whitespace checks. NuGet vulnerability metadata was unavailable in the restricted local environment; CI completed successfully.

- Archive SHA-256: `101bbad8f9c5e535ed6a321a85f5bf4104d2f1a4765bfcff23294da45c74242f` — matches GitHub digest.
- DLL SHA-256: `87538ce9b7c92d19c2c146cb4f6ff5bd227b7790a1d3878cc653d0363a773aef` — matches receipt and deployed DLL.
- Private sample SHA-256: `0df2a02dd906eefae0791bc70a380a37bd9ae2fb665c44066fa842792e7b7a96` — unchanged from baseline; 30 surfaces and 10 walls.
- Updated artifact installer used for both builds. All three automatic options true; all five destructive permits false. Backups outside Plugins; no backup load errors in final run. Existing ReloadAllPlugins loaded the DLL.
- Existing unrestricted RPH launch method used. One initial game session and one justified restart for the new CI binary; no startup crashes in this correction run. No manual teleport, movement, shooting, or sample manipulation. The stopped first attempt's console was inspected while investigating a retry; no retry command was submitted. The final automatic suite ran without input interference.

## Runtime verdicts and baseline comparison

Runtime: GTA Enhanced 1.0.1158.16 / RPH 1.132.1428.17748. Final suite **016609b140414d319a44800287bdbe0a**.

| Probe | Runtime verdict | Interpretation |
|---|---|---|
| E0.0 | GTA_VERIFIED | Installed current DLL and no-op observation captured. |
| E0.1 | GTA_VERIFIED | 10/10 matrix entries callable, zero reported native exceptions. Uncalibrated local ray only. |
| E0.2 | GTA_VERIFIED | All 30 primary evaluations executed; 28 indexed-hash matches, 2 misses, 0 wrong-material hits. |
| E0.3 | GTA_VERIFIED | All 10 primary paired measurements executed; 8/10 within the same 1 cm diagnostic tolerance as baseline. |

[Baseline](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/e0-live-40-samples-20261019/native/physics-e0/evidence/2026-10-19-live-40/FINDINGS.md) suite: `300c6937234f4d999e43c53a59e31d2a`. All 30 primary material hit/hash/match outcomes and all ten primary wall measured-thickness/error values are identical to baseline. Entity handles are session-local and differ between launches; only equality within each ray pair is meaningful.

| Metric | Baseline | Corrected run |
|---|---:|---:|
| Indexed material matches | 28/30 | 28/30 |
| Missing surface hits | 2/30 | 2/30 |
| Wrong-material surface hits | 0 | 0 |
| Bare-name hash matches | 0/30 | 0/30 |
| Paired wall measurements | 10/10 | 10/10 |
| Wall error <= 1 cm | 8/10 | 8/10 |
| Same-entity wall pairs | 8/10 | 8/10 |
| Both wall materials expected | 9/10 | 9/10 |
| Mean absolute thickness error | 0.034989762660 m | 0.034989762660 m |
| Max absolute thickness error | 0.254730227031 m | 0.254730227031 m |
| Inside-solid midpoint ray hits | 0/10 | 0/10 |

The 1 cm tolerance is the baseline's explicit analysis criterion, not a new pre-registered universal acceptance threshold. All primary shape tests returned completed state 2. Full reference comparisons for all samples are in [measurements.csv](measurements.csv) and [wall-reference-comparison.csv](wall-reference-comparison.csv), with private labels, material names and coordinates removed.

## Four anomalies and delayed confirmation

| Sample | Corrected primary observation | Delayed observation | Conclusion |
|---|---|---|---|
| Material 2 | completed ray, no hit, material hash 0 | +509 ms: completed ray, no hit, hash 0 | persisted |
| Material 6 | completed ray, no hit, material hash 0 | +519 ms: completed ray, no hit, hash 0 | persisted |
| Wall 3 | reference 0.50262451 m; measured 0.59771728515625 m; error +0.09509277515625 m | +506 ms: identical measurement/error; different entities | persisted |
| Wall 4 | reference 0.50387573 m; measured 0.75860595703125 m; error +0.25473022703125 m | +520 ms: identical measurement/error; different entities | persisted |

Wall 3 forward hash 1639053622, reverse 3108646581: reverse differs from the expected material. Wall 4 has expected hash 1187676648 on both sides, but the two directions hit different entities. The other eight wall pairs hit the same entity and match expected materials. The 10 midpoint-to-end inside-solid rays all missed; the delayed wall confirmations repeat only exterior forward/reverse rays, not inside-solid rays.

These are repeatable discrepancies after a verified ready interval and another approximately half-second delay. They are not explained by the former gate-order bug alone. Overlapping collision/patch precedence or a mismatch between the selected private reference primitive and actually streamed geometry remains a hypothesis, not a proven cause. Material misses do not establish a wrong hash mapping. Inside-solid exit detection remains unconfirmed.

## Destination and return verification

- Automatic teleport performed, using native safe pavement selection. Remote navmesh loaded; 9 safe-coordinate queries (8 misses, 0 rejected candidates), followed by one accepted coordinate.
- Destination: **35 collision polls, 35 consecutive successes; 816 ms successful-poll window; 1636 ms total since relocation**. Readiness was written and logged before E0.2 started. At least 800 ms and three consecutive successes were satisfied. This is sampled native readiness evidence, not a claim that every reference collider is loaded or agrees with an individual exported YBN.
- Manifest position status: `destination_collision_verified_return_streaming_original_position_restored`.
- Return: collision verified after **419 ms / 17 polls**; measured 3D position error **0 m** and wrapped heading error **0 degrees** at verification, within the native values' precision. Original-area visuals rendered correctly after return. The bounded navmesh request was released (`navRegionRequested=false` at completion).
- RPH timestamps: suite queued **09:05:56.182 EDT**, destination ready **09:06:02.284**, E0.2 start **09:06:02.292**, return confirmed **09:06:05.799**. Queue-to-restored execution **9.617 seconds**; final unrestricted launch-to-restored **127.844 seconds**. CI/investigation time excluded. First blocked attempt lasted 32.416 seconds queue-to-timeout and never teleported, so its `restoredOriginalPosition=true` was vacuous, not return proof.

## Timing, exceptions and limits

| Probe | Recorded intervals | p50 / p95 / p99 / max ms |
|---|---:|---|
| E0.0 | 0 | no timing evidence |
| E0.1 | 0 | no timing evidence |
| E0.2 | 71 | 25 / 27 / 27.3 / 28 |
| E0.3 | 50 | 25 / 27 / 28 / 28 |

Confirmation waiting contributes intervals, so these totals differ from baseline. Short game-fiber tick samples under the existing mod/graphics setup are not isolated native costs or a controlled performance benchmark. All four final logs pass the current strict analyzer; cleanup succeeded. No E0 native exceptions, destination/return timeout, or lab-backup loader errors were recorded in the final run.

## Remaining work

Transport correction is GTA-verified for this exact build/run. Complete 30/30 material and 10/10 single-primitive thickness acceptance remains open; all inside-solid exit probes still miss. Next use the existing private asset workflow to identify which streamed collider/entity/model each anomalous ray actually hits, reconcile patch/IPL precedence, and privately inspect alternative entry/exit rays for the two walls and missing faces. Add read-only model/identity and per-ray distance diagnostics to the isolated lab if needed; do not change reference values to make a test pass. A separate long-run timing test would be required for performance acceptance.

Published evidence contains sanitized JSONL, summaries, manifest, DLL/config/sample fingerprints, receipt, per-sample and confirmation tables, RPH excerpts, and the original blocked attempt. Original ZIPs and private samples remain local. No GTA assets, XML, material-name tables, sample coordinates, screenshots, unrelated logs, or credentials are published. No LSA gameplay or existing-system changes, destructive experiments, Online use, or main merge occurred.
