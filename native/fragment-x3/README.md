# ASTRA-001 X3 — debris, performance and scalability lab

Experimental continuation of the frozen X2 lab (`native/fragment-x2`, unchanged). Offline Story Mode only. Not production LSA/Essential code. Read `docs/next-gen-gameplay/astra-001/11-X3-PREREGISTRATION-20261021.md` first: gates, definitions and the launch plan were frozen before any X3 GTA execution.

## What is here

- `WpsBreachLab.3.cs` — X3 driver (`X3-0.x`). A superset copy of the X2 driver (`X2-0.10`, SHA-256 `5be72312…`): every X2 verb keeps its behaviour; new verbs add telemetry and scenarios (see below). The wall asset is the frozen X2 pack (`native/fragment-x2/pack/dlc.rpf`, SHA-256 `180618ad…`); it is not rebuilt.
- `x3-protocol.json` — machine-readable thresholds, definitions and matrix (frozen).
- `batches/` — frozen command lists per launch. `hold=N` may be appended by the orchestrator to chosen commands purely to pause for screenshots (recorded in the run header); it changes no measurement.
- `tools/x3_lab.py` — file-level lab control (hash-backed loader isolate/restore, deploy/restore of the lab script, command submission, status polling, sanitised evidence collection). It re-implements the file steps of the X2 PowerShell helpers (`native/fragment-x2/tools`) for a shell that cannot run Windows processes; the X2 helpers remain the reference. GTA launch/stop, F6 and key presses use Claude's computer-control tools.
- `tools/x3_analyze.py` — offline analyzer (opening classes, three outcomes, unchanged strict locality, frame-time gates, management integrity, isolation, leaks). The classification code is the authority; the driver only emits raw masks, sweeps and counters.

## New verbs

| Verb | Purpose |
|---|---|
| `x3idle seconds=N` | Empty-site frame baseline and ambient pool noise |
| `x3perf n=… rounds=… manage=…` | N simultaneous anchored walls, simultaneous charges, frame windows (idle 600, burst 120, active 720, late) with no shape tests, pool and debris telemetry, optional labelled management, leak check |
| `x3breach …` | One wall: X2 geometry (baseline, 180-frame burst, grid, sweeps, anchor faces, NPC walk) plus optional matched second phase (`manage=none|freeze|cull_corridor|cull_all|cull_budget manageat=… until=…`) |
| `x3multi n=… gap=… targets=… simul=…` | Several independently anchored walls with per-wall isolation, foreign-debris and anchoring checks |
| `x3player` | The player (not a ped) is placed in front of the wall and walks; telemetry logs the crossing; used with computer-controlled key hold |

Debris management and end-of-trial cleanup only delete props that are verified, at deletion time, as natively detached from one of this lab's walls (driver `X3-0.3`; see `docs/next-gen-gameplay/astra-001/13-X3-PHASE1-CLOSEOUT-20261021.md`). The wall root, the anchor and any unverified or ambient prop are never deleted or frozen. Drivers before `X3-0.3` could delete newly streamed ambient props at end-of-trial cleanup (PR #290 review, P0); that is fixed.

`x3cleanuptest` (driver `X3-0.3`) is the Phase 1 regression of the cleanup fix: one wall, one grenade, two unrelated sentinel props, checked with `tools/x3_cleanup_check.py`.

## Reproduce without GTA

```text
python native/fragment-x3/tools/x3_analyze.py docs/next-gen-gameplay/astra-001/x3-evidence
```
