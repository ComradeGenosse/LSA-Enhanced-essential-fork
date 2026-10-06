# System convergence dependency graph

Status: **current dependency synthesis**, updated 2026-10-06. No branch SHAs are normative here; use [../ROADMAP.md](../ROADMAP.md) for exact implementation state.

```text
CURRENT MAIN FOUNDATION
E1–E6 · P0–P2 · UX0–UX4 · PS0–PS3
        │
        ├─────────────── ACT reconciliation ───────────────┐
        │        ACT0/1 → ACT2                             │
        │        + C-13 host/world epoch                   │
        │        + C-06 owner token                        │
        │        + C-02 shared anchors                     │
        │        + C-14 ObserverSituation                  │
        │                                                  │
        └──── C-01 UtteranceLifecycle probe/implementation│
                         │                                 │
                         ├──── PS2 speech hearing          │
                         ├──── CGE0/1                      │
                         └──── social routing foundation   │
                                                            ↓
                         ┌───────────────┬──────────────────┐
                         │               │
                    PS4 / C-04       ACT3 short-range
                    knowledge        physical activities
                    firewall         (incl. stop_and_face)
                         │               │
                         └───────┬───────┘
                                 ↓
                     C-07 + C-08 + C-15
                  timeline-safe Profile v2
                                 ↓
                               PS5
                     experiential memory
                                 ↓
                               PS6
                     Director initiative
                                 ↓
                         PS7  ⇄  ACT7
                  social/direct exchange
                                 ↓
                       later PS8 / ACT6 / E7
```

## Side tracks

- Radio R0–R2 may remain raw factual input; model-visible radio knowledge waits for PS4/C-04.
- CGE remains head/eye-only and waits for C-01.
- UX4 current behavior can be GTA-accepted independently; typed-target integration waits for C-01.
- No later feature may bypass Essential native execution or create a second prompt writer.

The October 5 step-by-step snapshot, including old PS3/UX4 merge gates, is preserved only in [archive/convergence/system-convergence-dependency-graph-audit-20261005.md](archive/convergence/system-convergence-dependency-graph-audit-20261005.md).
