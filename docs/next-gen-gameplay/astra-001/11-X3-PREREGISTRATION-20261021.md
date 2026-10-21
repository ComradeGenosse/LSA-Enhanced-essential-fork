# X3 preregistration — debris, performance and scalability validation — 2026-10-21

Status: **frozen before any X3 GTA execution.** Thresholds below and in [x3-protocol.json](../../../native/fragment-x3/x3-protocol.json) are not changed after any X3 result is seen. If a driver defect is found during the shakedown launch (L0) the defect fix is committed and documented; no gate or threshold moves.

Authority: ASTRA-001 [06 master plan](06-MASTER-PLAN-explosion-destruction-20261020.md) §3 blocker 4 and §5 P2 ("X3 budget and crash caps"), the frozen [X2 final validation](10-X2-FINAL-VALIDATION-20261021.md) (commit `cdc27687`, draft PR #289, unmerged) and the user's X3 brief. X2 is preserved byte-for-byte; X3 lives on `experiment/astra-001-x3-debris-scalability-20261021`, forked from X2, under `native/fragment-x3/`.

## Question

Can the anchored native-fragment wall approach support several destructible structures reliably inside acceptable physics, pool and frame-time budgets, and which debris policy keeps openings usable without manufacturing the breach?

## What is frozen and what is new

| Item | Status |
|---|---|
| Wall asset (`lsa_x2_concrete`, 31 groups, strength 500) | Frozen. Pack SHA-256 `180618ad…f347`. Not rebuilt. |
| Charges: grenade .25 / sticky 3 / rocket 10 (native `AddExplosion` scales) | Frozen from X2 final pass. Not retuned. |
| Targets: centre (0,1 m), left (−.75,1 m), upper (0,1.75 m) | Frozen. |
| X2 driver `WpsBreachLab.3.cs` (`X2-0.10`, SHA `5be72312…`) | Preserved in `native/fragment-x2`. X3 driver (`X3-0.x`) is a superset copy: it keeps the X2 verbs and adds `x3idle`, `x3perf`, `x3breach`, `x3multi`, `x3player`. |
| X2 strict locality definition and 80 % gate | Unchanged; reported on the X3 cohort independently of X2's 14/20. |
| Pool facts | Installed `gameconfig.xml`: Object 2300, phInstGta 15030, FragmentStore 77700; `fragInstGta` not overridden (a community report puts its default limit near 1600). SHVDN exposes only `World.PropCount/PropCapacity` and `EntityColliderCount/Capacity`; **direct fragInstGta usage is not observable and is therefore UNTESTED** — fragment instance load is bounded by design (≤ 16 walls × 31 groups per trial) instead. |

## Definitions (also in the JSON)

- **Baseline valid**: 120/120 blocked ray cells, 0 clear swept columns, 20/20 anchor-face hits, 0 failed ray requests. Invalid baselines are retained and excluded from rates, never relabeled.
- **Destruction success**: explosion detected and ≥ 1 prop explicitly flagged as detached from that wall (native detached-parent evidence).
- **Breach formed**: ≥ 4 formerly blocked ray cells now fully clear, measured with debris present.
- **Opening accuracy**: distance, in the wall plane, from the centroid of the largest 4-connected clear component to the intended impact projection; accurate ≤ 0.5 m. The centroid of all clear cells is reported too.
- **Strict locality** (original, unchanged): centroid of all clear cells in the first post-blast mask within 0.5 m of the intended impact; trials with no clear cell fail; gate ≥ 80 %.
- **Traversal success**: swept-sphere window ≥ 0.6 m (r = 0.30 at 0.5/0.9/1.3/1.7 m — a standing-body approximation) **and** a lab NPC walking through the opening, crossing inside the wall footprint. NPC walks are attempted whenever ≥ 4 cells are clear so sweeps can be checked against actual walking.
- **Opening class**, by precedence: INTACT (no root-collision cell lost) → TRAVERSABLE (window ≥ 0.6) → DEBRIS_OBSTRUCTED (debris blocks ≥ 4 cells and clear + debris ≥ 8) → ELEVATED (largest clear component ≥ 4 cells, lowest row ≥ 2, i.e. bottom edge ≥ 0.5 m) → NARROW (component ≥ 4 cells reaching the ground, window < 0.6) → PARTIAL_OTHER. Classification is computed offline from raw masks and sweeps by the committed analyzer, not inside GTA.
- **Frame time**: Stopwatch delta between consecutive script resumptions, in windows with no shape tests (idle 600 frames, burst 120, active 720, late 1800, post-management 600). Mean, P50, P95, P99, max and counts over 33/50/100 ms are computed from the raw per-frame files. The X3 driver also logs `Game.LastFrameTime`.

## A. Debris and physics budgets — gates

Workload: n simultaneous walls (independent native fixed-joint anchors), one centre rocket per wall detonated in the same frame, debris retained. Layout: up to 4 columns, 7 m column spacing, 9 m row spacing (n=16 only, if reached: 4×4 at 6.5 m). Ladder n ∈ {1, 2, 4, 6, 8, 12}; n = 16 only if n = 12 passes with active P99 ratio ≤ 1.25 and pool use ≤ 10 %. One command per step; escalation only after PASS. Then rounds 1, 2, 3 (15 s apart, same wall set, n = 4) and a 4-cycle spawn/blast/cleanup soak at n = 4 for leak trend.

SAFE: n walls spawned; 20/20 anchor-face hits per wall at baseline; Object and collider pool use ≤ 50 % of capacity; no frame > 1000 ms; no script exception.
PERF (vs the idle baseline of the same wall set, same session): active mean ≤ 1.25× idle mean; active P99 ≤ max(1.5× idle P99, 20 ms); late mean ≤ 1.25× idle mean; burst max ≤ 250 ms; active and late max ≤ 100 ms.
Step outcome: PASS, PERF_REGRESSION, UNSAFE or INVALID. First non-PASS step is the first observed limit; escalation stops there. A practical limit is PROVEN only if the same n passes again on a second fresh launch (otherwise PARTIAL). Cumulative detached fragments per wall ≤ 30 (the wall has 30 chunks). Leak: after cleanup and 120 frames, Prop count within +5 and collider count within +3 of the pre-spawn value, allowing the ambient range measured by `x3idle`.

## B. Debris management — protocol and gates

Initial measurements (grid, sweeps, anchor faces, NPC walk) are taken with native debris untouched, exactly like X2. **Only afterwards** a separately labeled management action is applied and measured again. Modes, each with a matched retain control (`manage=none`, same elapsed time):

| Mode | Action |
|---|---|
| `none` | retain; observe settling to +75 s |
| `freeze` | freeze each detached piece whose speed < 0.1 m/s |
| `cull_corridor` | delete only detached pieces inside the opening corridor (cells that lost root collision, +0.25 m, ±1.2 m depth) |
| `cull_all` | delete every detached piece at once |
| `cull_budget` | delete detached pieces nearest the corridor first, 2 per 6 frames |

Only props explicitly flagged as detached from the lab wall (wall model hash) are ever deleted; the wall root, anchor and unflagged props are never touched. Scenarios: centre grenade, centre sticky, centre rocket, upper rocket (covers debris-obstructed, partial, clean and elevated cases). 4 scenarios × 5 modes = 20 trials, plus `x3perf n=4` × 5 modes for frame-time/pool effects.

Integrity gate (must hold for any acceptable strategy): 40/40 outer cells still blocked, 20/20 anchor-face hits within 0.02 m, root movement ≤ 0.02 m, root-collision cell count never lower than before management, and no more than 2 extra detached wall fragments than the matched retain control. Effectiveness: culled set fully gone, Prop count within +3 of the pre-blast value after `cull_all`. Traversal recovery (DEBRIS_OBSTRUCTED cases): post-management window ≥ 0.6 m and NPC crossing inside the footprint. Management frame spike ≤ 100 ms. Decision rule: see JSON. Freezing and deleting are never used to create the initial breach.

## C. Multiple structures — gates

Independently anchored panels in a row. Cases: 3 panels gap 3 m, blast middle; 3 panels gap 3 m, blast outer pair simultaneously; 3 panels gap 1.5 m, blast middle; 3 panels flush (0.05 m), blast middle; 4 panels, all blasted at once; 3 panels, blasted sequentially 6 s apart. Per panel: baseline validity, detach counts by owner, cells lost, anchoring, root motion, debris from other panels in its grid. Non-target panels (gap ≥ 3 m): zero root-collision cells lost, zero detached fragments, anchored, root motion ≤ 0.02 m, zero foreign-debris cells. Closer gaps are measured and reported, not gated. Live debris ≤ 30 per blasted panel; leak gate as in A.

## D/E. Reliability, repeatability and gameplay

Single-wall `x3breach` trials report destruction success, breach formed, accuracy, traversal and opening class **separately and conditionally**, plus the unchanged strict locality. Representative set (per fresh launch): control, centre rocket, centre sticky, centre grenade, left rocket, upper rocket, control. Required across ≥ 3 fresh isolated launches; the centre rocket must traverse in ≥ 80 % of isolated trials. A full 3 positions × 3 charges × 2 repeats matrix runs on one launch. A player-controlled traversal (computer key hold, judged by logged player coordinates) is attempted once through a breach and once against an intact wall. The representative installed mod stack is a separate single launch (`MOD`); its numbers are never pooled with `ISO` and never generalized.

## Launch plan, safety and STOP conditions

L0 shakedown, L1–L4 `ISO`, L5 `MOD` (≤ 8 launches total). Offline Story Mode only. Temporary changes: `AutoLoadScripts=false` for ISO (backup and SHA-256 of the exact loader bytes; restored and verified) and the lab script `scripts/WpsBreachLab.3.cs` temporarily replaced by the X3 driver (X2 copy preserved and restored; restored SHA must equal `5be72312…`). Packs, existing mods and saves untouched. GTA is shut down when testing ends. STOP conditions S1–S6 are in the JSON; crashes and invalid probes are preserved and diagnosed before any retry.

## Frozen command batches

`native/fragment-x3/batches/` holds the exact command lists per launch (ladder steps are submitted one command at a time and escalated only on PASS, per the rules above).

## GO / NO-GO for the next milestone

GO (to X4, "excise one vanilla wall") requires: ladder practical limit n ≥ 4 PROVEN on two fresh launches; a debris strategy that passes the integrity and effectiveness gates and recovers every DEBRIS_OBSTRUCTED trial it was applied to; all C gates; centre-rocket traversal ≥ 80 % over ≥ 3 isolated launches; no unresolved crash; no leak. Anything weaker is NO-GO or GO-WITH-CONDITIONS and is reported with the exact unmet gate. Remaining M2 acceptance requirements outside X3's scope — strict locality ≥ 80 %, grenade < sticky < RPG area on ≥ 2 of 3 materials (only concrete exists), "pistol chips drywall but not concrete" (no drywall asset) — are carried forward and not claimed.
