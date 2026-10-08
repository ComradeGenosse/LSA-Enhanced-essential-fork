# System convergence dependency graph

Status: **current dependency synthesis**, updated 2026-10-08. No branch SHAs are normative here; use [../ROADMAP.md](../ROADMAP.md) for exact implementation state. The [unified master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md#13-numbered-implementation-phases-and-dependency-graph) supplies precise phases/tests/gates; [PR #21's PS4 plan](PS4-code-level-implementation-plan-20261008.md) remains its MVP detail.

```text
IMMEDIATE: C-02/C-13 → qualified PS2/C-14 + PS3 → frozen PS4 → MVP acceptance
                                                 │
AFTER MVP (independent slices, stable master phase IDs):
  shared refs + native playback/ownership probe → 10a playback-only gaze
      10a + C-01 lifecycle (phase 8) → 10b player-listening gaze
      C-01 lifecycle → phase 9 proximity hearing (separate from listening gaze)

  PS4 + C-06 truthful/native admission + C-11 ticket/intake/playback gate
      → 13a early passive PS6 speech (Profile v1; PS5/C-01/ACT3+ not required)

  C-05 receipts + C-06 owner truth + qualified ACT facts → ACT4/ACT5
  C-07/C-08/C-15 → P2 v2/timelines (auto writer off)
      C-05 + validated timeline/schema → PS5 automatic memory
      PS5 + 13a → 13b optional memory-aware reactions (same Director pipeline)
  Radio R0–R5/v2 → PS2/PS3 → frozen PS4 contributor (own validation)

LATER: C-01/C-12 + 13a + appropriate ACT gates → PS7 social / ACT7 DI
       timeline-safe P2 → durable relationships/commitments
       accepted producers/capabilities → individual PS8 / ACT6 / E7 scope

ALL POLICIES: qualified bounded input → selection → unchanged admission shell
              → C-11 speech ticket OR ACT proposal → Essential execution
```

## Side tracks

- Radio R0–R5/v2 is unmerged; reuse producer/catalog/witness code, replace R5's independent prompt ingress with frozen PS4/C-04 contributions.
- CGE remains head/eye-only: 10a uses exact existing playback; 10b player-listening requires C-01. Essential look ownership always wins; a safe mechanism/ownership probe is required for supplemental commands.
- UX4 current behavior can be GTA-accepted independently; typed-target integration waits for C-01.
- No later feature may bypass Essential native execution or create a second prompt writer.
- Radio/gaze/hearing/memory/Director/Genesis additions never block visual MVP PS4. Reuse existing PS2 stores, provider layer, P2 persistence and ACT engine.

The October 5 step-by-step snapshot, including old PS3/UX4 merge gates, is preserved only in [archive/convergence/system-convergence-dependency-graph-audit-20261005.md](archive/convergence/system-convergence-dependency-graph-audit-20261005.md).

PS6 response entitlement and playback delivery are independent of PS5 durable writes. Phase numbers are stable identifiers rather than mandatory chronology. Memory-aware policy uses the same bounded queue/tickets/acknowledgements after its own gate; alternative selection policies cannot bypass admission, ACT or Essential. No model-specific phase or additional inference infrastructure is planned.
