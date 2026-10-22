# X7 Windows Session A — stopped, milestone not accepted

October 21, 2026, desktop COMRADE (ASUS desktop / RTX 5090), offline Story Mode, GTA Enhanced 2.0.1158.16, SHVDN Enhanced API 3.9.0.0. Cloud base `437a8e26bb94e6b83730656ac21108e53f59acf8`. Six RPG projectiles, one ladder shot, approximately four minutes from first shot command to final in-world restore. No P3/P1/traversal trial or Session B followed the invalid-control stop.

## Build and safety

Blender 5.2.2 exported all twelve actual grid6x5 variants using installed Sollumz. CodeWalker 30_dev48 converted and reloaded all twelve GEN9 v171 fragments with 31 bones each, plus the 12-archetype YTYP. Strict validation checks exact root/sheet physics, 4.5 kg masses, 2.536 × 2.351 m bounds, 43 high-LOD geometry entries (below 128), identical vertex/index/collision buffer hashes across the matrix **and frozen X6**, and receipt hashes against actual YFT/YTYP/DLC bytes. See conversion and pack receipts beside this file. The DLC SHA256 is `d062d4331a6cbb2c2f94a4280b9918b383534a392c50cf7b0594e3947d3e26c4`.

The runtime driver was regenerated, compiled against the installed API, and compiled/loaded by SHVDN in GTA. Its measured SHA256 is `1d5b7f5954de252c809fad927dbe9ef41dbf0f8eeda5b87e4216a51f39ad209c`; the runtime driver was not changed during these tests. X2–X6 source/assets were not modified. The pack-specific allowlist was installed beside the isolated script. Every fresh preparation logged original 9/9 and dormant twin 0/9 before firing.

MSI Afterburner preset 1 applied before Blender and GTA: `nvidia-smi` confirmed 460 W against a 575 W default, i.e. 80%. One F6 press after Story Mode loaded produced `19:49:07:544 ... F6: DLSS Neural Rendering OFF.` in the live RenoDX/ReShade log. Raw runtime logs and full host logs remain private in this task's work folder; sanitized actual command logs, screenshots and numerical receipts are published here.

## Actual measurements

| Shot | Model / point | Detached | Removed m² | Sheet blocking | Centroid error m | Commit ms | Frames early | Near-event max ms | In-world restore |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | ctl / P0 | 30 | 5.25 | 0% | 0.0128 | 0.086 | 3 | 11.357 | 9/9 |
| 2 | sx / P0 | 0 | 0.25 | 95.24% | 0.9900 | 0.065 | 3 | 10.886 | 9/9 |
| 3 | hx / P0 | 5 | 1.17 | 77.71% | 0.2134 | 0.066 | 3 | 10.483 | 9/9 |
| 4 | j1000 / P0 | 5 | 1.17 | 77.71% | 0.2134 | 0.068 | 3 | 10.804 | 9/9 |
| 5 | j1000f / P0 | 5 | 1.17 | 77.71% | 0.2134 | 0.062 | 3 | 10.347 | 9/9 |
| 6 | j1000 / P2 | 0 lab-owned parts; **no swap** | unavailable | unavailable | unavailable | no call | unavailable | 10.500 | **6/9, false** |

`ctl` is WHOLE. The frozen classifier labels `sx` SMALL because of the 0.25 m² clear row, although its actual fragment count is zero. `hx`, `j1000`, and `j1000f` are LOCAL by the frozen numerical criteria. Their largest connected removed component is 0.92 m². The point observations support an impulse/strength mechanism; no effect of the coupled transmission variant was observed at this one threshold/point. This does not establish the engine's general fracture formula or strength-response curve.

**Observed T*=1000 is a P0 candidate, not an accepted Session A threshold.** No neighboring threshold was needed because the first ladder level was LOCAL. No CLIFF or no-LOCAL fallback was reached, so F1 redesign is not justified by this run. The unmodified native shot path used no fallback blast, scripted detach, scripted impulse or deletion to create the opening. All five committed shots were three frames / 27–28 ms early, and the logged traces reported zero frames over 50 ms. No crash was observed.

## Stop evidence and limits

P2 command: `x7shot label=a06_j1000_p2 aimu=-0.70 aimv=1.10`. See `logs/20261021-235312-d95087.jsonl`. The last projectile sample is frame 31196, local t = −5.749 m, TTC 687.206 ms, onCourse true. An explosion is detected at frame 31197; no commit was called. The driver correctly did not invent a fallback explosion. An early collision/obstruction is consistent with the trace, but neither the hit entity nor exact cause is recorded and no cause is claimed as proven. The broad 6 m explosion detection sphere can observe such an event before the projectile reaches the fence.

The following restore (`logs/20261021-235336-6ace9c.jsonl`) reports originalExists true but originalBlocked 6/9 and restoredToOriginal false. The unswapped vanilla original suffered native damage. This is an invalid restoration control: testing stopped at six shots, without retries, a new session, fabricated masks, or threshold changes. P2 locality/centroid is unavailable; P0/P2/P3 hole overlap cannot be computed. Player traversal, repeatability, alternative impact positions and the 36-piece visual gate remain untested. **Session A FAIL; Session B NOT RUN; X7 milestone NOT MET.**

The `sx` mask's lowest row is clear despite zero detached pieces, and its bottom-band witness is 0/24 while its upper band is 24/24 and post is 3/3. This exposes a pre-existing lower-edge alignment/sampling or collision issue: a dense intact baseline is needed before any future acceptance can treat all clear cells as newly removed sheet. The published 1.17 m² is the frozen analyzer's raw value, not a silently corrected 0.92 m². The entire sampled sheet is 5.25 m²; sampling discretizes the authored 5.404 m² footprint. Piece states inferred from the mask are occupancy estimates, not direct native per-bone state.

The logged performance window is inherited: −8 to +90 frames around the event, with a 60-frame baseline. It does not establish the full prescribed ±1 s at this approximately 110 FPS rate. The reported timing is useful evidence, not complete performance acceptance. Fire obscures the immediate after screenshots; adjacent vanilla fence panels also receive native blast damage. No torn-hole visual acceptance is claimed.

## Shutdown, rollback and next blockers

X6's inherited shutdown tool stopped GTA. X7's installer restored and independently rechecked all five pre-install hash/existence states: original INI and dlclist bytes, and original absence of the X7 DLC, driver and allowlist. `install-restored.json` and `final-safety.json` prove the filesystem rollback. This does **not** turn the failed 6/9 in-world P2 restoration into a pass.

Before a separately authorized new bounded session: diagnose early projectile collision using an observed clear firing corridor (without deleting scene entities), verify a fresh original collision control, qualify dense intact/lower-band measurements, and extend performance measurement to the required time window. Preserve the existing predictive one-tick commit, physical anchor, native fracture, ownership cleanup and hash restore. No need to redesign threshold architecture from this failed environmental control. Session B remains gated on a complete, valid Session A.

## Tooling corrections

- Add script-directory import resolution for Blender `--python`, and document `--python-exit-code 1`.
- Validate Sollumz `VertexBuffer`/`IndexBuffer` and collision `Bounds`, including frozen-X6 equality and actual conversion/pack receipt hashes.
- Join chronologically named command logs for analysis, read frame timing before the result row, and keep restoration/walk receipts in following command files.
- Preserve no-mask failed swaps with their real timing and restoration failures. Two synthetic parser regression tests cover these cases; synthetic fixtures are never evidence.

X7-0 recovered the preserved previous X6 pack's strength 500 / min damage force 100 / health 100 / transmission .25. Base and update installed explosion.ymt numbers agree for the five requested explosive types. Only numbers and archive provenance are published in `../x7-0-forensics.json`; Onigiri runtime override precedence was not independently resolved.
