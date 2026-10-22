# PR #304 controlled Windows/GTA diagnostic — FAIL

Codex ran exactly one RPG shot on October 22, 2026 (15:54 America/New_York). Candidate PR #304 remains draft, stacked on draft #303. No second shot, selector manipulation, physics/horizon retuning, merge or X8 work occurred. X7.3 is **not ready to close**.

## Verified source and build

- Exact candidate: `6faf2e8cbef6c27f32b96b811a0f01f1d0f40505`; #303 head `c728f879b997027634149271b85ecfc07fe2aef9` is an ancestor.
- Generated, installed and loaded driver SHA256: `1e77f4d82e681030132010d97cf6386c4a45234430ecab89e198d2955f59cc64`. Generation was byte-for-byte unchanged; isolated worktree was clean before deployment.
- Local: 16 X7 Python tests, 10 X7.3 smoke tests, six X7.2c smoke tests, 16 controller tests, 16 actual C# protocol/lifecycle scenarios, 15 selector tests / 120,221 assertions, source guards, four validators, dry-run layouts and evidence table passed. Controller temporary-file tests initially hit sandbox access denial; the ordinary host run passed. Final logs are included.
- Full driver compiled against the installed `ScriptHookVDotNet3.dll`; warnings only. GTA then independently logged successful script compilation, API 3.9.0 and startup. Approved runtime: PID 32244, loaded `2026-10-22T19:53:21.1486139Z`; fresh advancing P2 heartbeat and independently matching installed source required before commands.
- Exact-head GitHub X7 offline check succeeded: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39841186794/job/120042313326 . Seven unrelated checks were skipped.
- GPU power preflight passed at 460/575 W (80%); no settings changed. This check covers power only.

## Separate verdicts

| Gate | Result |
| --- | --- |
| Original/twin baseline | PASS: 9/9 original, 0/9 dormant twin |
| P2 shot command | DONE once; no transport error or timeout |
| Predicted selection / native fracture | FAIL: no eligible sample, selection or commit; zero lab native parts |
| Exactly two fracture / three protected | NOT EXERCISED: dormant sections are not proof of active protection |
| Player traversal | NOT RUN: smoke correctly stopped after failed shot acceptance |
| Live world restoration | FAIL: 0/9, originalExists=true, visible flag=true, otherHits=0; terminal ERROR `original_restore_requires_9_of_9` |
| Stopped-game file restoration | PASS: four original hashes and three original absences match; both addon renames restored |
| Final cleanup / ownership | PASS: GTA/RPH stopped, P2 owner released, request/legacy slots absent |
| Overall / X7.3 closure | FAIL / NOT READY |

## New diagnostics and timing

Shot request `c4bc05b339e44cf0ab6a7fcab9d88774`, session `x73-diag-one-shot-20261022`, run `20261022-195402-37b2c6`. Full correlated raw rows and a 12-file SHA256 manifest are in `live/evidence/`; `FINAL.json` reproduces the structured summary and comparison.

- One baseline handle. 893 query frames, zero query exceptions, null returns or invalid candidates; 135 empty queries; 78 baseline exclusions. Exclusions are observations, **not** 78 distinct entities.
- 680 new-candidate observations of one handle, `142082`: 674 `normal_speed`, one `outside_sheet_v`, five `beyond_prediction_window`. No `eligible_early` or `eligible_ready` rows.
- Fire frame 8396. Independent nearby explosion at frame 8474, 588 ms after fire, with zero explosion-query errors. This probe is independent of selector acceptance; the legacy `explosionFrame=-1` and `late=false` do not mean no explosion happened.
- First new candidate at frame 8610, **136 frames after the independently observed explosion**: world `(1069.012,-1770.911,36.185)`, velocity `(0,0,0)`, local `(u=.309,t=-3.980,v=1.434)`. Rejected for normal speed.
- Frame 8611 velocity `(-15.540,-4.993,23.719)`, local `vt=16.308`, `vv=23.719`, TTC 231.921 ms, dynamic horizon 75.955 ms. Rounded logged values project to approximately `U=.472,V=7.172`, well above sheet V `[0,2.131]`; this is a rejected candidate projection, **not the RPG impact**.
- First prediction-window rejection frame 8753: `vt=4.130`, TTC 856.141 ms, horizon 71.118 ms. Remaining recent samples show near-stationary motion. Their rejected projections must not be promoted to an actual shot impact or chosen pair.
- There is no valid predicted RPG impact coordinate or section pair to report. The independent explosion probe supplies radius/proximity timing, not exact explosion coordinates, weapon attribution or excluded projectile identity.

## Diagnosis: established cause and remaining uncertainty

**Established immediate failure:** the runtime admitted no post-baseline candidate that passed the pure selector. All 680 admitted observations were rejected for the recorded reasons, and their first appearance was after the observed explosion. Accordingly `best` never became eligible, `X7Commit` never ran, and the original was left exposed. This is not a demonstrated P2 failure, multi-ready arbitration failure, frame-stall miss, commit exception or too-small dynamic commit horizon. The pure selector was never given an accepted live-flight sample in this run.

**Leading mechanism, not proven root cause:** the pre-launch handle exclusion may have suppressed the actual RPG during flight (a preexisting/attached projectile transition or handle reuse are possibilities). The count of 78 exclusions equals the 78 fire-to-explosion frames and the old successful code did not have this filter. However, #304 logs neither excluded handle identities nor their per-frame positions/velocities/times. Counts do not prove that those exclusions occurred on consecutive pre-explosion frames, nor that the excluded object was the fired RPG. An unrelated preexisting object plus unavailable rocket enumeration remains possible. No exact underlying exclusion/enumeration cause is established by this shot.

**Restoration is independently failed:** original witnesses went 9→0 after the uncommitted shot and remained 0 after one restore. Natural damage to the exposed original is consistent with the explosion and previous failures, but exact damage/reacquired-entity identity is not established. Removing model hides/reacquiring an existing map prop is not proof of rebuilding its collision. Do not relabel filesystem rollback as live world restoration.

## Comparison with successful X7.2c and failed X7.3

The successful #300 run `20261022-175645-5efa53` has identical launch `(1068.386,-1771.470,36.750)`, aim `(1065.415,-1772.563,35.551)`, `aimU=0`, `aimV=.8`, 60 ms base horizon, frameK=1.5 and clear corridor. It logged 74 accepted `x7_track` rows (handle 315394), committed four frames/28 ms before explosion at TTC 65.635 ms versus horizon 70.270 ms, produced two native parts, traversed and restored 9/9. Its first accepted TTC was 1029.776 ms; X7.3 legitimately limits pure-selector projection to 250 ms, but baseline-filtered samples cannot be tested against that boundary from current logs.

The earlier #303 trial had no accepted track/selection/commit and restored only 6/9. This run reproduces the admission failure and adds positive nearby-explosion evidence plus quantified rejected observations. Restoration here is worse at 0/9; do not conflate the two trials. Prior X7.2c preselected [2,3] is not evidence that automatic center must choose [2,3].

## Recommended minimal next change

First fill the precise observability gap, preserving behavior: retain bounded baseline and excluded-candidate samples (handle plus current entity identity available from SHVDN, frame, elapsed since fire, position, raw/reconstructed velocity and local geometry), including their pre-explosion flight interval. Flush after sampling as #304 does. Add focused offline cases for a baseline object that stays unrelated, a baseline projectile transitioning into flight, and genuine handle reuse as supported by the API. Do not simply remove all baseline filtering or force a pair.

If identity/motion proves the controlled rocket is suppressed, replace permanent handle-only exclusion with the smallest provenance-aware admission rule that admits the authorized shot while still rejecting unrelated preexisting projectiles and ambiguity. This is a conditional design recommendation, not an implemented or GTA-validated fix. No physics, horizon or native fracture changes are justified. Live restoration still needs its own evidence-supported repair/acceptance. Any further GTA shot requires Chris's explicit approval.

## Cleanup and evidence integrity

One same-owner restore was attempted and failed definitively; there was no timeout, retry or second restore. GTA was quit through its normal UI. Stopped-process gates preceded rollback; the same fresh installer manifest and independent baseline snapshot were used. `filesystem-restoration.json`, `shutdown.json`, `cleanup-verified.json` and `controller-release.txt` record cleanup. Evidence hashes were independently rechecked before publication. All source/runtime code remains unchanged from #304.

## Bounded independent review

One Claude Sonnet High diagnosis completed in about 79 seconds through the existing coordinator, task `64ee439fef564e958a29d83b520e1967`, after Chris explicitly approved source/log export. No follow-up or expensive fallback. `coordinator/answer.json` preserves its response; `selection.json` records sonnet/high.

The reviewer independently read source and diagnostic documentation but **could not open the raw JSONL evidence**; its evidence statements rely on Codex's supplied summary. It agreed that no eligible candidate reached commit, baseline suppression is suggested rather than proven, and telemetry should precede changing exclusions. This is a limited review, not independent raw-evidence validation.

Codex rejects these overstatements in that response: nearby explosion detection alone does not prove that this specific RPG arrived; original damage remains an inference; and run `195412` is the restore request, not an earlier shot. No second shot occurred. The final diagnosis and numbers above come from Codex's direct parsing and hash verification of the raw files.
