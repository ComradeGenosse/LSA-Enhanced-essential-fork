# LSA Research Corpus — Current Architectural Truth

**Repository reconciliation — October 11, 2026.** The [playable LSA v1.0 milestone](../lsa-v1-implementation-milestone.md) is still the **scoped implementation boundary**; its October 9 execution language and the [October 8 master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md) are retained as dated implementation specifications. They do not supersede later merged source and observed GTA evidence. Phase 6/PS4/early PS6 are now merged experimentally, without closing all GTA gates. Radio and ballistics remain open draft PRs.

This document summarizes **current architectural ownership and repository interpretation**. For exact merge/deployment/acceptance status, prefer [../ROADMAP.md](../ROADMAP.md) and the [implementation evidence ledger](../unified-intelligence-implementation-status.md). Normative D-001–D-017 and C-01–C-15 are unchanged.

## One-sentence architecture

**Essential is the sole native GTA executor; LSA adds durable identity, evidence, knowledge, planning and orchestration around Essential through bounded contracts, while every physical effect remains fenced by current native identity and ownership.**

## Authority map

| Concern | Authority |
| --- | --- |
| GTA physical execution, sessions/turns/generations, playback, native action lifecycle | Essential |
| Durable CharacterId and owner-authenticated identity | P1 |
| Durable character profile/canon/manual memory store | P2 |
| Run-local entity evidence / witness facts | PS native adapters |
| Episode/observation construction | PS2 |
| Deterministic relevance / salience | PS3 |
| Model-visible knowledge assembly | **PS4 TurnKnowledgeFrame — single writer** |
| Activity planning / physical behavior arbitration | ACT |
| Autonomous scene policy | Director proposes; ACT/Essential execute |
| UX selection / controls | UX; it may select/commit but does not own Essential conversation lifetime |
| Supplemental conversation gaze | CGE head/eye-only, yielding to Essential |
| Provider inference / STT / TTS | Stateless service; no native authority |

## Current repository state

Current `main` has E1–E6, P0–P2, UX0–UX4, PS0–PS3 and ACT0–ACT2. The October 5 PS2→PS3 shadow telemetry and October 6 ACT smoke test remain prior GTA evidence, not proof that today's main was redeployed. **Phase 6 C-05/C-06, PS4 TurnKnowledgeFrame and early PS6/Phase 13a Director speech are also merged experimentally** via [PR #23](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/23), with subsequent [#27–#30](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/30), [#31](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/31) and [#33](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/33) reliability/acknowledgment/grounding fixes.

PR #23 recorded **one actual PS4→Luna supported gunfire-observation exchange in GTA** with the model response played. Troubleshooting also observed native Director playback start/completion; the fixes for rejected grant acknowledgment, missing Director context and reconnect churn were subsequently merged. Full baseline PS4 audit, exact new installed payload, repeated contextual spontaneous speech, native grant consumption and phase-specific GTA acceptance remain open. Do not convert a passing CI run or one exchange into a v1.0 release claim.

The [PS6 testing preset PR #34](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/34) is merged and **opt-in**: normal 4 attempts/minute and testing 12 attempts/minute enforced separately by both companion and native DLL. Activation requires rebuilding/installing both layers plus compatible experimental settings, without relaxing real safety/identity/PS3 gates. See [preset guide](../ps6-testing-chatter-preset.md).

[Radio R0–R5/v2 PR #32](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/32) and [contextual ballistics R0 PR #35](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/35) are **unmerged draft branches** with independent reconciliation, build, physical producer and GTA acceptance gates. The current radio PR uses the existing PS4 selector, not a second model-facing writer. Contextual ballistics does not yet establish precise air/ground/surface impact classification. CGE, C-01/proximity hearing, automatic PS5 memory, PS7, advanced ACT and memory-aware PS6 remain separate future deliverables.

The older `main@7e54b17` source pins and research proposals inside the master plan document **its October 8 audit**, not a claim that PS4 is still unimplemented on today's `main`.

## Locked / settled architecture

1. **Essential remains the sole native executor.**
2. **CharacterId is durable identity, never a physical effect address.**
3. **P2 remains the single durable character store.**
4. **Facts, observer knowledge, salience, memory and action authority are separate concepts.**
5. **One source-time utterance lifecycle (C-01) must join mic/typed input, STT, hearing, gaze, social routing and future memory.**
6. **Run-local entity references converge on one shared anchor service (C-02).**
7. **A salience grant is an entitlement, not proof of consumption (C-03).**
8. **PS4 TurnKnowledgeFrame is the single model-facing knowledge assembler (C-04).**
9. **Dialogue physical actions require receipts independent of spoken-history commit (C-05).**
10. **Primary physical behavior has one truthful owner token (C-06).**
11. **Automatic durable memory/relationships/commitments require timeline-safe Profile v2 + SubjectRef first (C-07/C-08/C-15).**
12. **Feature state/health is a read model; subsystem gates remain local (C-09).**
13. **Essential owns conversation-partner lifetime; UX readers/writers follow C-10.**
14. **Director proposes; ACT owns physical activity / directed-interaction execution (C-11).**
15. **Social routing requires explicit responder reservation / turn-yield semantics (C-12).**
16. **One hostRunId / world epoch coordinates run lifetime across subsystems (C-13).**
17. **ObserverSituation supplies one normalized activity/situation view (C-14).**

The normative contract definitions are in [system-contract-register.md](system-contract-register.md).

## Current dependency spine

```text
Merged ACT0–ACT2 + PS/P2 shared-host convergence
          │
          ├── C-02 shared anchors
          ├── C-06 owner token
          ├── C-13 host/world epoch
          └── C-14 ObserverSituation

C-01 UtteranceLifecycle
          │
          ├── PS2 speech hearing
          ├── player-listening CGE (10b; playback-only 10a uses existing events)
          ├── UX4 typed-target follow-up
          └── social routing / future memory

PS4 = C-04 TurnKnowledgeFrame
          │
          ├── C-05 DialogueActionReceipt
          ├── radio witnessed context
          ├── ACT activity lane items
          └── future recalled memory lane

Profile v2 + TimelineGuard + SubjectRef
          │
          ├── PS5 experiential memory
          ├── PS7 relationship edges
          └── ACT7 durable commitments

PS4 + C-06 native admission + C-11 ticket/playback proof
          │
          ├── early PS6 passive speech (13a; no PS5 dependency)
          ├── existing playback → early gaze (10a; no C-01 dependency)
          └── later PS7 social/directed exchange ⇄ ACT7 execution

PS5 + 13a → optional memory-aware reactions (13b; same Director pipeline)
```

## Current next-work interpretation

The immediate work is now **integration and physical acceptance of already merged experimental PS4/Phase 6/PS6**, rather than rebuilding baseline C-02/C-13, C-04 or early Director from scratch. Verify the exact matching native DLL/companion version and mode first. Exercise supported witness facts all the way to real Luna requested-turn input, sustained observer/PS3 continuity, Director ticket/turn/playback and the original grant-consumption receipt. In [PR #33](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/33), deterministic Director event text can be delivered on a special turn even if optional PS4 `PERCEIVED` is unavailable on the installed build; those are distinct tests.

Next reconcile [radio #32](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/32) and [ballistics #35](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/35) separately against fresh `main` and close each matching source/CI/native/GTA gate before considering merge. Existing ACT0–ACT2 require focused physical probes, not remerging. Gaze 10a remains conditional on an Essential look-mechanism probe, while player-listening 10b requires C-01. PS5 memory requires the settled timeline-safe P2 migration; PS7/social and ACT7 physical proposals require later scoped evidence/authority.

Preserve the [original PR #21 PS4 specification](PS4-code-level-implementation-plan-20261008.md), [master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md) and locked architecture as design/provenance; keep actual implementation, deployment, activation and acceptance recorded distinctly in the [roadmap](../ROADMAP.md). No new event ledger, parallel executor, shadow speech-hearing inference or automatic durable memory is licensed by this reconciliation.

## Important historical-status rule

The original October 5 convergence audit is preserved under `docs/research/archive/convergence/` as historical evidence. The active convergence architecture, ownership, dependency and risk documents are status-neutral/current-safe syntheses. Never use an archived snapshot to answer what is merged, deployed or validated today; use the roadmap and phase status docs.
