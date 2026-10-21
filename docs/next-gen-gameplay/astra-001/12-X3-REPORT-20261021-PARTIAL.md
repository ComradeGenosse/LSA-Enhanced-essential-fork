# ASTRA-001 X3 — status report (PARTIAL, stopped early)

Branch `experiment/astra-001-x3-debris-scalability-20261021`, based on X2 `cdc27687` (PR #289 untouched). Offline Story Mode only. No production LSA/Essential code touched. Not X4, no persistence, no production-ready claim. Everything below is isolated-lab evidence, not normal gameplay.

**Why partial:** the session usage limit was nearly exhausted. The run was stopped on purpose; GTA was shut down and the install restored. Experiments B (mostly), C, D, E (3-launch repeatability, player demo) and the MOD condition were NOT run. Remaining work is listed at the end.

## Install state
Restored and hash-verified: `ScriptHookVDotNet.ini` = c9ecd8e2… (original), `scripts/WpsBreachLab.3.cs` = X2 5be72312…, asset pack 180618ad… unchanged. Backups under `Codex/2026-10-21/x3/backup/`. GTA closed (launch 1 closed by the user; launch 2 stopped via Steam).

## What was measured (see `x3-evidence/analysis/tables.md`, `summary.json`, `trials.csv`)
Launches used: 2 of 8. Launch 1 driver X3-0.1 (frame baseline ~7.3 ms); launch 2 driver X3-0.2 (adds diagnostic counters only; frame baseline ~26 ms, cause not identified — a second/third F6 press did not change it).

### A. Budgets (single launch unless stated)
| step | result |
|---|---|
| n=1, 2 | PASS (launch 1) |
| n=4 | PASS on launch 1 **and** launch 2 → practical limit n=4 PROVEN (two fresh launches; baselines differed) |
| n=6 | all 6 walls breached, frame ratios ≤1.16 on both launches, pools ~10–12 %. Committed analyzer verdict UNSAFE both times because post-blast anchor-face rays were lost on 1–2 walls. X3-0.2 diagnostic: the lost ray was blocked by **another wall's debris** (missForeignDebris=1); wall roots moved ≤0.003 m. Prereg-literal SAFE list (baseline face hits only) → PASS on both launches. Both verdicts are reported; this rule in the analyzer is stricter than the preregistration text (disclosed, not altered). |
| n=8 | **only 6 of 8 simultaneous rockets registered, reproduced on both launches** (workload not delivered → INVALID). Launch 1 also had a 1.26 s frame stall coinciding with the host link dropping; launch 2 had max frame 29.9 ms. Cause of the 6/8 cap not identified (explosion/projectile budget suspected, untested). |
| n=12, 16 | UNTESTED (escalation stopped at first observed limit n=6 under the committed rule; n=8 repeated only as a diagnostic) |
| rounds (n=4 ×3) | cold launch: PERF_REGRESSION (active max 405 / 506 ms, +67 props after cleanup). Warm repeat: PASS (max 29.5 ms, late max 56 ms). Cold-start first-explosion hitch is the likely cause (supported by the warm repeat, not proven). |
| soak (4 cycles, n=4) | PASS ×4, no leak trend |

Pool use never exceeded 13 % of Object capacity. `fragInstGta` usage is not observable: UNTESTED.

### Regression anchor / controls / R-set (launch 2 only; one launch, so not the 3-launch gate)
Centre rocket (L0, L1 launch 1, rerun on launch 2): breach formed, 64 cells, TRAVERSABLE, NPC crossed. The first R-set centre-rocket on launch 2 was BASELINE_INVALID (wall collision not present at baseline); recorded, rerun once and valid (screenshots in `x3-evidence/screenshots`). Intact controls: 4/4 INTACT and blocked.
R-set launch 2: centre-sticky DEBRIS_OBSTRUCTED (crossed_climbed, not a traversal), centre-grenade DEBRIS_OBSTRUCTED with 0 clear cells (48 debris-blocked), left-rocket NARROW, upper-rocket ELEVATED, rerun centre-rocket TRAVERSABLE.
Strict locality (unchanged metric) is not claimed: too few trials; X2 reference 14/20 = 70 %, gate 80 %.

### B. Debris management
Only 2 of 20 matrix trials ran before the run was interrupted (the NVIDIA overlay took focus and GTA auto-paused; the trial in progress is void). `none` and `freeze` on centre-grenade only; no strategy can be recommended. UNTESTED.

## Analyzer changes made after seeing data (disclosed)
1. Ambient allowance computed per launch rather than per run file (matches the preregistration wording).
2. Added the second "prereg-literal" outcome column beside the committed outcome; no threshold changed. Thresholds are untouched from x3-protocol.json.

## Claims
| claim | status |
|---|---|
| Native fragment wall breached by explosives (centre rocket) in the lab | PROVEN (X2 + X3 regression, 3 launches incl. L0) |
| n=4 simultaneous anchored walls, one rocket each, safe & no frame regression | PROVEN (2 launches) |
| n=6 | PARTIAL (breaches fine; verdict depends on anchor-face rule; artifact explained by foreign debris) |
| n≥8 simultaneous | FAILED/limit: only 6/8 delivered |
| Repeated explosions | PARTIAL (cold hitch fails, warm passes) |
| Debris management strategy | UNTESTED |
| Multi-structure isolation | UNTESTED |
| Opening accuracy / strict locality ≥80 % | UNTESTED |
| Centre-rocket traversal ≥80 % over 3 launches | UNTESTED (3/3 NPC crossings across 3 trials, 2 launches — not the gate) |
| Player-controlled traversal | UNTESTED |
| Mod-stack condition | UNTESTED |

## Recommendation: NO-GO to X4 on current evidence
Unmet: debris strategy, multi-structure gates, D matrix, 3-launch repeatability, player demo, MOD condition. M2 items outside X3 also remain (strict locality ≥80 %, grenade<sticky<RPG area on ≥2 materials, drywall).

## Resume plan (≤6 launches left)
Run `batches/L2-B-geometry.txt` + `L2-B-perf.txt`, `L3-C-multi.txt`, `L4-D-matrix.txt` + `L4-player.txt`, `rset.txt` on two more ISO launches, `L5-mod.txt`; keep GTA focused (disable NVIDIA overlay popups) or it auto-pauses. Commands: `python native/fragment-x3/tools/x3_lab.py isolate|deploy|submit|wait|collect|restore-script|restore-ini`, analysis `python native/fragment-x3/tools/x3_analyze.py docs/next-gen-gameplay/astra-001/x3-evidence`.
