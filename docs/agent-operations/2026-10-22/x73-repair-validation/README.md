# PR #306 one-shot validation — PASS

Codex operated and analyzed this trial on October 22, 2026, 16:24 America/New_York. Exactly one RPG firing request, one traversal, and one world restore. No runtime behavior changes, retuning, forced selection, artificial explosion, second shot, merge, X8 work, or external model call.

**Verdict: the repair worked in the authorized configuration. X7.3 can close for this bounded live impact-selection acceptance.** This is one successful trial, not repeatability certification. The separate failure-path restoration defect from #305 remains open; this trial does not claim to repair a damaged exposed original.

## Source, builds and identity

Exact #306 head `8210588b1a948d7e009df52f9fee9dda04dc8f4d`, direct evidence branch `validation/x73-repair-20261022`; #305 head `f74909592be75b292b04ec59ae4201f196053d68` verified ancestor. Draft evidence PR targets #306's `fix/x73-baseline-projectile-provenance-20261022` branch. Generated driver matched byte-for-byte, checkout clean before installation. Driver generated/installed/loaded SHA256 `0e9950e9d640b4e4ee3e44c5c94dfa0ef6f73eaf689fb5f9cfad8017c9c0104a`.

PASS: 16 X7 Python tests; 10 X7.3 and six X7.2c smoke tests; 16 controller tests; 16 actual C# protocol/lifecycle scenarios (offline stubs); 18 pure C# tests / 120,238 assertions; selector source guards; all four asset validators; installed SHVDN compilation. Host controller tests passed after sandbox temporary-file access failures. Initial Windows PowerShell stderr handling interrupted the script; final PowerShell 7 host logs are authoritative. Python 3.12 ran the live controller to support seven-digit .NET timestamps without modifying controller code. An operator-only heartbeat reader normalized fractional seconds for Python 3.10; it was not installed.

Runtime PID 3892, loaded `2026-10-22T20:23:23.4854516Z`, SHVDN API 3.9.0. Fresh advancing P2 heartbeat plus independent installed-source hash required before commands. Startup log independently confirms successful compilation. GPU power cap 460/575 W (80%); no render/settings retune. Full Afterburner preset identity is not asserted.

## One physical shot and selected pair

Unmodified `smoke_x73.py` used the previous configuration: `lsa_x7d_secp_j1400`, target `(1065.758,-1773.716,34.851)`, `pu=0`, `back=4`, `aimu=0`, `aimv=.80`, `probe=1`, base horizon 60 ms, frameK 1.5. Measured launch `(1068.386,-1771.470,36.750)` and aim `(1065.415,-1772.563,35.551)` exactly match #305. Launch ray corridor unobstructed. Aim coordinates are not measured impact coordinates.

- Selected actual projected impact `U=.006, V=.808`, pair **[2,3]**, mask 12, `readyCount=1`, origin `projected_intersection`. Positive measured U legitimately selects [2,3]; no center-pair substitution.
- Fire frame 8299; commit 8381; explosion 8385; fracture first seen 8388. Commit preceded explosion by four frames / 30 ms; TTC 68.468 ms versus dynamic horizon 70.001 ms. Commit call .374 ms. No late/fallback result.
- Exactly two native parts. Final five-strip collision probe `300 300 000 000 300`: three wall hits in sections 0,1,4, no wall/debris/other hits in selected 2,3. All three protected roots remain existing, visible, attached, alive, displacement 0. Selected roots can remain attached after their native panel parts fracture; visibility alone is not the fracture test.
- Opening width 1.0 m at lane U=.232. Actual player crossed at U=.236, within footprint, maxRise=0, passed=true, 1,824 ms.
- Six foreign/map collision hits occurred at negative U (-.608/-.508), handle 0, outside this successful lane. They did not block this traversal and are not destruction failures. They do not identify the exact obstructing map object.
- Maximum measured commit-window frame 14.126 ms; zero frames over 50 ms. All five P2 commands DONE. Full correlated rows and receipts in `live/evidence/`.

## Baseline identity and admission diagnosis

Pre-fire baseline contains handle **269314**, model -1707997257, position `(1068.879,-1771.492,35.864)`, zero velocity. The same handle appears in baseline flight samples, all 26 accepted `x7_track` rows, and the selected intersection. One baseline handle was observed; 39 plausible samples, one promoted handle, 38 promoted observations, 48 excluded observations. Zero query errors/null results/invalid candidates. Twelve admitted observations remained beyond the unchanged 250 ms prediction window before 22 early and four ready samples.

This is positive evidence of a baseline-listed projectile transitioning into the physical flight selected for the authorized RPG. First accepted track frame 8359, 433 ms after fire, TTC 246.637 ms, normal speed 6.924 m/s. Last moving frame 8384 has world `(1065.753,-1772.452,35.589)`, velocity `(-7.413,-2.277,-.657)`, TTC 45.779 ms, followed by zero velocity at explosion frame 8385. The selected frame speed is 7.698 m/s. Trajectory, forward velocity, timing, proximity, and single-ready selection agree.

Independent calculations from rounded raw baseline samples (`provenance-metrics.json`) show direction cosine about .960 throughout the retained moving samples, advancing along the launch axis, and corridor error narrowing from .750 m at frame 8338 to .139 m at commit and .091 m at frame 8384. Frame 8347 is already within .637 m, forward speed 6.088 m/s. Exact promotion frame is not explicitly logged and should not be reconstructed at the .65 m boundary from rounded values. Runtime corroboration counters establish admission; the pure offline tests cover the two-frame guard.

**The old permanent baseline-membership rule would exclude the actual selected flight in this run.** This validates the repair's targeted admission mechanism and strongly supports baseline exclusion as the prior X7.3 root cause. It cannot retroactively prove #305's excluded object's identity, because that run did not log it. Nor does this establish actual pool-handle recycling versus a preexisting launcher projectile becoming active: post-baseline model/weapon/owner identity is not logged. Do not call all 680 late #305 observations the rocket; they appeared after explosion.

Telemetry limitations: `t` in `x7_track`/`x7_diag_sample` is local thickness coordinate (the common row time key is overwritten). Use `ms` on tracks and game frame for timing. Independent explosion diagnostic is -1 in this success because that diagnostic stops once `seen`; `x7_result.explosionFrame=8385` is the accepted-flight path, not a missing explosion. No telemetry/runtime changes made.

## Independent restoration investigation

Current trial: original_before and original_armed **9/9**; dormant replacement **0/9**. After swap the original witness is 0/9 as expected. After one restore the original witness is **9/9**, otherHits=0, exists=true, restoredToOriginal=true. This checks collision against the reacquired original via nine bidirectional locations at three columns and three heights; it is stronger than visibility or file hashes. It does not verify collision over the entire model.

Separately re-read immutable #305 raw shot/restore rows and inspected `X7Restore`, `X7Witness`, `Classify`, `X7Commit`, `CleanupAll` in this exact candidate. #305 original went 9/9 before shot to 0/9 after shot, with committed=false; its one restore stayed 0/9, otherHits=0, exists/visible=true. Thus loss preceded restoration and was not caused by removal of the replacement during restore. No successful hidden swap occurred in that failure. Zero other hits does not support an environmental occluder explanation at those witnesses.

`X7Restore` deletes owned replacements/debris, removes a model hide only if active, waits 60 frames, reacquires the matching model within 1.5 m, and probes it. It has **no explicit restoration of an exposed original's broken collision**. Existence/visible flags do not reconstruct fragment collision. Natural damage from the uncommitted RPG explosion remains the leading explanation, supported by the now-successful pre-explosion hide and subsequent 9/9 restore, but it is not proven forensic identity/damage-state evidence. Geometry drift/reacquisition ambiguity is not fully excluded in #305. Current 9/9 restores the successful-swap path; it does not repair or exercise failed-admission recovery.

Minimum next action: accept this bounded X7.3 selection/fracture/traversal acceptance and retain the exposed-original restoration failure as a separate defect. Before any future failure-path live validation, design the smallest evidence-backed original collision recovery/identity check offline, then obtain separate authorization. No additional shot or speculative runtime repair is justified here. If project closure requires guaranteed restoration after every failed admission, that broader closure remains blocked by this defect; the approved successful-path X7.3 gates themselves passed.

## Shutdown, rollback and custody

Normal Alt-F4 plus confirmation produced a black screen while GTA remained alive; the exact executable/PID was verified and force-stopped. GTA/RPH absence was independently confirmed before rollback. The stopped-game installer restored the same fresh backup: all four original SHA256 values and three original absences match; both DLSS addon rename suffixes absent. P2 pending=null; same-owner release completed; controller.json/request.txt/command.txt absent. See `shutdown.json`, `filesystem-restoration.json`, `controller-before-release.json`, `cleanup-verified.json`, `controller-release.txt` and `handoff.json`. This filesystem PASS is independent of live collision PASS.

Automatic approval review blocked an unrelated-surface Steam capture and a premature rollback while GTA was still present. No blocked screenshot was retried; launcher was verified from installed Steam metadata. No rollback ran until independent stopped-process evidence. There are no remaining approval blockers.

All 15 manifest-listed live evidence hashes independently verified. `source-identity.json`, build logs, raw evidence, provenance calculations, comparison rows and receipts are published together. No external reviewer was necessary; Codex owns the final analysis. No source/runtime file changes in this evidence branch.
