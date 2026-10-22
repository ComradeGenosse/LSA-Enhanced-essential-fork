# X7 recovery on COMRADE — actual gameplay, not accepted for X8

October 21, 2026, 20:17–20:26 EDT. Pulled `16bdb98d74d8445b76c1e0a5011f96a3ecf10319`. Reused all existing validated X7a YFT/YTYP/DLC binaries. No X2–X6 edits, physics changes, fake blast, scripted detach or deletion to create a breach.

## What works

| Actual trial | Launch back | Native pieces | Removed m² | Blocking | Centroid error m | Early frames | Commit ms | Frame max ms | Restore |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| j1000 P2, recovery world 1 | 9 | 12 | 2.21 | 55.8% | 0.1675 | 3 | 0.084 | 11.670 | 9/9 |
| j1000 P3, world 1 | 9 | no swap | unavailable | unavailable | unavailable | none | no call | no near-event sample | **6/9** |
| j1000 P3, fresh world 2 | 4 | 12 | 2.05 | 59.0% | 0.2687 | 3 | 0.158 | 11.749 | 9/9 |
| j1000 P1, world 2 | 4 | 4 | 0.72 | 85.6% | 0.1103 | 2 | 0.066 | 13.644 | 9/9 |
| j550 P1, world 2 | 4 | 4 | 0.72 | 85.6% | 0.1103 | 2 | 0.069 | 12.709 | 9/9 |
| j300 P1, world 2 | 4 | 4 | 0.72 | 85.6% | 0.1103 | 1 | 0.068 | 10.570 | 9/9 |

The valid j1000 P2/P3/P1 shots are all LOCAL by the frozen mask/count criteria. Position matters: P2/P3 IoU 0.1181, P2/P1 0.1581, P3/P1 0.1494. The first two comparisons cross clean-world sessions and launch distances; they demonstrate differing holes, not same-session repeatability. Surrounding twin sheet geometry and collision remain, and every valid shot retained the rooted post at 3/3 sampled heights. P3 retained 50% of the sampled top band and 100% of the bottom band; P1 retained both bands 100%. These are grid assets, not torn-metal visual acceptance.

The new `.16 m` first mask row and `.175 m` bottom witness avoid the old known dead lower strip. The sampled domain is now 25×20 cells = 5.00 m². No retrospective correction of the old 1.17 m² results was performed. No new dense intact full-sheet baseline was captured; the sampling fix therefore has useful actual data but not complete baseline qualification.

## What remains broken

**1. Longer P3 launch reliability.** Alignment alone did not solve every shot. World 1's P3 projectile last appeared at local t −5.777 m / u +0.507 / v 1.218, frame 13261, then disappeared. The tightened 1.5 m explosion sphere correctly did not register a target impact; committed=false, no mask. Original collision restored only 6/9. The world was stopped for diagnosis, not used for further shots.

A tiny read-only corridor diagnostic was added to the deterministic X7 generator and compiled driver. It logs launch/aim world coordinates, ray hit/entity/model and remaining distance. `checkonly=1` returns before firing; normal shots refuse a detected obstacle more than 0.75 m before the aim. Two non-firing P3 checks in fresh world 2 (back 9 and 4) reported no ray hit. This did **not identify** the earlier hit entity and does not prove that every swept RPG trajectory is clear. No obstruction cause is claimed as proven. One actual back=4 P3 shot then succeeded. This operational workaround preserves the established predictor and fracture logic.

**2. P1 does not admit the player.** Four tiles give a 0.72 m² low opening, with intact sheet above it. `x7walk` rejected the lack of a 0.9 m full-height lane. A separate physical attempt using the supported `x7walk u=0 w=0.8` option crossed at u −1.617, outside the fence footprint, and failed despite zero upward climb. This was a walk around the edge, not a successful breach traversal. Lowering the existing preset to j550 and then j300 did not change the detached count or mask. Both automatic lane checks still failed. Those two practical calibration diagnostics were not the frozen centre-threshold ladder; no new threshold acceptance is inferred from them. No further tuning followed.

**T*=1000 remains a local-fracture candidate. It is not an accepted playable threshold. Session A did not pass; X7b/Session B stayed locked. No 36-piece asset was exported or tested. Not ready for X8's next gameplay milestone.** A complete fresh ctl/P0/position/traversal acceptance session was not repeated after these targeted recovery diagnostics exposed the remaining passage blocker. The analyzer honestly reports STOP_CONTROL / no accepted T* for these partial sessions.

## Safety, provenance and practical scope

Desktop COMRADE, RTX 5090, GTA Enhanced 2.0.1158.16, SHVDN Enhanced 3.9. Afterburner preset 1 applied before gameplay and confirmed at 460/575 W (80%). The keyboard helper sometimes failed to register short key pulses; no shots were fired until actual RenoDX F6 OFF confirmation: **20:17:11.304** for world 1 and **20:23:30.050** for world 2. No successful toggle was assumed from a tool return alone.

World 1 driver SHA256 `9f4c2b6711777d445b314ef7581c8d632ac8dc711c4f9f7907e2c3a1e639a489`; world 2 with corridor diagnostics `6b3aa048a4836529ea59601d04f578e72c389b0a9cec09076da07a7f3341b692`. Both regenerated and compiled successfully against the installed SHVDN API and in GTA. Every fresh preparation reported original 9/9 and dormant twin 0/9. Six RPG shots total across the two worlds (2 + 4), with two non-firing corridor checks. No crash or fallback blast observed. The inherited reported frame window is still −8/+90 frames, not complete ±1-second qualification.

GTA was stopped after each world using the inherited shutdown tool. Both installations restored all five pre-install hash/existence states. The final independent check confirms GTA/RPH stopped and all original bytes/absence states match. World 1's failed in-world restore remains failed; filesystem rollback does not erase that evidence. No production scripts or X2–X6 were changed.

Published sanitized actual logs, masks, receipts and untouched screenshots live in `retest-a/` and `retest-a3/`; raw host/game logs remain private in this task's work directory. Some screenshots retain fire/player occlusion and the desktop question notification; none is presented as a clean torn-hole visual gate. `retest-comparison.json` combines actual measurements with session provenance and preserves every walk attempt.

## Practical next work

Keep the working native fragment twin, predictive swap, anchor and cleanup. The next gameplay fix is a **player-sized low opening**, not a system rewrite: investigate the actual native four-piece footprint at low impact and why the two lower presets leave it unchanged. Do not remove retained pieces by script or count a path around the edge as success. Use the checked shorter launch position for further diagnosis, while retaining the unresolved long-range failure as a separate blocker. Only after a genuine within-footprint traversal and restored original should X7b's torn-metal visual test or X8 proceed.
