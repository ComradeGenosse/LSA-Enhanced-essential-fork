# ASTRA-002 offline experiments (X-1 … X-6)

> **These are offline, sandbox computations. No GTA process, RPH, Essential binary or AI provider was used.**
> They test *contracts and algorithms* (representation, validation, verification, adaptation, novelty measurement,
> mystery logic). They cannot establish GTA runtime feasibility, performance or fun. Each result maps to an in-game
> experiment in [`../05-falsifiable-experiment-ladder.md`](../05-falsifiable-experiment-ladder.md) that can confirm or
> refute it.

## Contents

| Path | What it is |
| --- | --- |
| `gea/capability_catalog.json` | **E0 desk census**: every fluent (observable), actor policy, staging and presentation capability the Game Master could use, with evidence tier A/B/C/D/X and a repository or native-DB/RPH reference. |
| `gea/world.py` | Abstract world model ("digital twin lite"): 19 places named after Los Santos districts, vehicles/peds/items/props, ordinary player verbs, actor policies, wanted/busted, damage. Deliberately coarse. |
| `gea/search.py` | Bounded breadth-first search over player macro-actions: solvability, failure reachability, distinct solution "shapes". |
| `gea/validator.py` | Hard critics H1–H13 and soft critics S1–S7 (LLM-Modulo style). |
| `gea/fixtures.py` | Researcher-written reference experiences: a 3-stage job (#23), a tail/intercept action scene (#6), a companion outing (#3), and the X-4 variant. |
| `gea/generator.py` | Template baseline (shape of existing GTA mission-generator mods) and the fluent/policy **algebra** generator. Neither is an LLM. |
| `gea/novelty.py` | IR-level mechanical signature, mechanic features, surface variety, archetype classifier. |
| `gea/adaptation.py` | Episode simulator for adaptation strategies S0–S4 with synthetic players. |
| `gea/monitor.py` | Objective monitors M0–M3 including the proposed evidence ladder. |
| `gea/mystery.py` | Mystery construction, exact fair-play solver and clue-loss repair. |
| `gea/runner.py` | Parallel validation runner. |
| `x1_capability_census.py` | X-1: composable gameplay per evidence tier; ranked blockers. |
| `x2_validator_fault_classes.py` | X-2: critic coverage of 19 fault classes; false rejections; faults that slip through. |
| `x3_novelty_expressive_range.py` | X-3: surface vs mechanical novelty; expressive range; validation bias. |
| `x4_adaptation_strategies.py` | X-4: static vs LLM re-planning vs critic-gated re-planning vs precompiled accommodation vs hybrid. |
| `x5_monitor_fault_injection.py` | X-5: fabricated-completion resistance and latency of objective monitors. |
| `x6_mystery_solvability.py` | X-6: unchecked vs solver-guided mysteries; repair after clue loss. |
| `results/*.json`, `results/x3_expressive_range.png` | Outputs of **run 2**, the run quoted in the dossier. |
| `results/run1-superseded/` | Outputs of run 1, kept unchanged for transparency (see revision log). |

## Reproduce

Python ≥ 3.10, standard library only (`matplotlib` optional, only for the X-3 figure).

```sh
cd docs/next-gen-gameplay/astra-002/offline-experiments
python3 x1_capability_census.py          # ~3 min on 2 cores
python3 x2_validator_fault_classes.py    # ~1 min
python3 x3_novelty_expressive_range.py   # ~2 min
python3 x4_adaptation_strategies.py      # ~15 min on 2 cores (X4_EPISODES=40 for a quick run)
python3 x5_monitor_fault_injection.py    # seconds
python3 x6_mystery_solvability.py        # seconds
```

All runs are seeded; outputs are deterministic for a given Python version. Recorded runs: Python 3.13.16, Linux, 2 vCPU, 2026-10-19.

## Abstract-model semantics (read before quoting a number)

* One step ≈ 10–20 s of play. A player `goto` is executed hop-by-hop so actor policies keep acting.
* Combat: an armed hostile co-located with an on-foot player deals 1 damage per step (player HP 6); a vehicle shields the player except from vehicle chasers; `snipe` lets the player shoot an armed ped in an adjacent place.
* Police: killing/ramming/destroying/carjacking in urban places raises the wanted level; ≥3 stars on foot for 2 steps, or ≥2 stars at Mission Row, means *busted*.
* A ped that dies drops what it carried **where it died**; a destroyed vehicle kills its occupants and destroys fragile items inside it or held by an occupant; other items drop at the wreck.
* `near` means "same abstract place". There is no line of sight, traffic, navmesh, streaming, physics or AI tactics.
* "Valid" = passes all hard critics **and** the bounded search finds a success path and failure is possible. It is a statement about the abstract model only.

## Revision log

**Run 1** (2026-10-19, 07:29–08:02) produced the first X-1…X-6 results. Reviewing them before writing the dossier found five problems:

1. **World-model bug (kill/snipe):** a killed ped's carried items were dropped at the *player's* place, so sniping a carrier from an adjacent place teleported the loot to the player (too lenient).
2. **World-model bug (destroy):** a vehicle's occupants were processed before the items they held, so a fragile item held by the driver survived the destruction of its vehicle (fragile-item threats almost never fired).
3. **X-4 design flaw:** the exogenous disturbance could only hit *critical* roles; in the courier job those are an item and a place, so **no disturbance ever fired there** — the "normal" vs "turbulent" contrast and the accommodation-coverage sweep measured nothing for that fixture.
4. **X-4 metric flaw:** a success reached only after the goalposts moved (an unchecked bad re-plan in S1, or S4's generic fail-forward that swaps a blocked objective for an easier escape) was counted as success.
5. **X-2 reporting gap:** faults that slipped past the hard critics were not listed.

**Run 2** (2026-10-19, from 08:08) fixed all five: `world.kill_role` / `world.destroy_vehicle` implement the corrected semantics and are shared by player verbs and X-4 disturbances; disturbances may now hit the roles that *carry* critical roles (holder ped, its vehicle); X-4 reports `END_SUCCESS_MOVED` separately from `END_SUCCESS`, plus `concluded`, `failed`, `disturbances` and `redesigns`; X-2 lists accepted negatives with their soft warnings. The soft critic `S7_ONLY_VIA_ACCOMMODATION` (added after X-1…X-3 of run 1 had run) is active in every run-2 result.

Effect: X-1 `lab` valid/distinct 211/174 → 208/171; X-3 algebra 186/155 → 185/154; X-2 unchanged except that its single accepted negative is now recorded (flagged by S1 and S7); X-5 and X-6 identical; X-4 changed materially (see [05](../05-falsifiable-experiment-ladder.md#x-4-adaptation-strategies-run-2)). Run-1 outputs are preserved in `results/run1-superseded/` (including the X-4 console table).

## What these experiments do **not** show

* That any capability works in GTA V Enhanced (E0 measures that).
* How often a real LLM produces each fault class or how fast it re-plans (E1/E3 with the owner's provider).
* That generated experiences are fun (E6 with blind player evaluation).
* Performance or entity budgets in Enhanced (E0.8/E8).
