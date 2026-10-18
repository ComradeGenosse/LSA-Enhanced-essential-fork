# ASTRA-001 offline probes

These are **offline computations**, run on 2026-10-18 in a Linux sandbox (2 vCPU Xeon @ 2.1 GHz, 7 GB RAM, Python 3.13, NumPy 2.5, SciPy 1.18, scikit-sparse 0.5 / SuiteSparse 7.6). **None of them touches GTA.** They test whether the models and data structures proposed in docs 02–03 are internally sound and what they cost, so that in-game experiments (doc 04) start from calibrated expectations.

Research artefacts only — not gameplay code, not built or shipped by any LSA project.

| Script | Output | Purpose (doc 01 §8) |
|---|---|---|
| `p1_ballistics.py` | `p1_ballistics.out.txt` | X-1: Poncelet/plugging penetration model fitted to FM 3-06.11 7.62 mm data, out-of-sample checks (two JSON documents: main run + same-range variant). |
| `p1b_erosion.py` | `p1b_erosion.out.json`, `p1b_erosion_extended.out.json` (`--extended`) | X-1b: voxel crater accumulation vs FM repeated-fire counts — v1 (falsified) and v2 two-constant fit with an out-of-sample 7.62 prediction. |
| `p2_structural.py` | `p2_structural.out.json` | X-2: 3D frame solver, column-removal scenarios (bridging vs collapse) and SuperLU scaling (`--scale`). |
| `p2b_solver_scaling.py` | `p2b_solver_scaling.out.json` (run 1, cited), `p2b_solver_scaling.run2.out.json` (independent re-run) | X-2b: CHOLMOD factorisation vs numeric refactor vs rank-k downdate per support-loss event. The script writes `p2b_result.json` incrementally in the working directory; the committed files are that output, renamed. |
| `p3_facade_tiles.py` | `p3_facade_tiles.out.txt` | X-3: entity budget of projecting a damaged wall with pre-authored props (two JSON documents). |
| `p4_scale_budget.py` | `p4_scale_budget.out.json` | X-4: storage envelopes per representation (arithmetic on stated assumptions). |
| `p5_persistence_replay.py` | `p5_persistence_replay.out.json` | X-5: event-log replay determinism (float vs fixed point), snapshot cost. |

Reproduce (any machine with the packages above):

```bash
python3 p1_ballistics.py
python3 p1b_erosion.py                # ~2 min; add --extended for the wider grid
python3 p2_structural.py --scale      # ~1.5 min in the sandbox
python3 p2b_solver_scaling.py         # ~8 min in the sandbox; needs scikit-sparse (CHOLMOD)
python3 p3_facade_tiles.py
python3 p4_scale_budget.py
python3 p5_persistence_replay.py
```

Caveats are listed per probe in doc 01 §8. In short: penetration constants are *effective* game-model parameters, not material strengths; the structural solver is linear-elastic with brittle member removal; timings are sandbox upper bounds; city-scale numbers are envelopes over assumed archetypes until E7d measures real assets. CHOLMOD's update/downdate module is GPL-2.0 — fine for this research script, not for redistributed code.
