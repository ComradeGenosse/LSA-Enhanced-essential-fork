# System convergence dependency graph

Status: **current dependency synthesis**, updated 2026-10-08. No branch SHAs are normative here; use [../ROADMAP.md](../ROADMAP.md) for exact implementation state. The [unified master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md#13-numbered-implementation-phases-and-dependency-graph) supplies precise phases/tests/gates; [PR #21's PS4 plan](PS4-code-level-implementation-plan-20261008.md) remains its MVP detail.

```text
CURRENT MAIN: E1–E6 · P0–P2 · UX0–UX4 · PS0–PS3 · ACT0–ACT2
        │
        └── C-02 shared anchors + C-13 host/world context
                │
                ├── C-14 + qualified paired PS2/PS3 inputs
                │       → frozen PS4/C-04 → all Luna requests → MVP acceptance
                │
                ├── C-01 source-time lifecycle (independent of visual MVP)
                │       ├── PS2 proximity hearing → PS4 CONVERSE
                │       ├── CGE supplemental head/eye gaze
                │       └── later C-12 social routing / typed-target annotation
                │
                └── ACT3 exact short-range capabilities (own physical probes)

AFTER MVP: separate enrichment slices through the SAME PS4 assembler
  C-05 dialogue receipts + C-06 owner truth + qualified ACT facts → ACT4/ACT5
  Radio R0–R5/v2 → witness/salience → frozen lane items (own validation)
  C-07 + C-08 + C-15 → P2 v2/timelines (auto writer off)
  C-05 + validated timeline/schema → PS5 experiential memory

LATER: PS6 passive Director → C-12/PS7 ⇄ ACT7 social/DI/commitments
       → individual PS8 / ACT6 extensions → enabled-scope E7 acceptance
```

## Side tracks

- Radio R0–R5/v2 is unmerged; reuse producer/catalog/witness code, replace R5's independent prompt ingress with frozen PS4/C-04 contributions.
- CGE remains head/eye-only and waits for C-01.
- UX4 current behavior can be GTA-accepted independently; typed-target integration waits for C-01.
- No later feature may bypass Essential native execution or create a second prompt writer.
- Radio/gaze/hearing/memory/Director/Genesis additions never block visual MVP PS4. Reuse existing PS2 stores, provider layer, P2 persistence and ACT engine.

The October 5 step-by-step snapshot, including old PS3/UX4 merge gates, is preserved only in [archive/convergence/system-convergence-dependency-graph-audit-20261005.md](archive/convergence/system-convergence-dependency-graph-audit-20261005.md).
