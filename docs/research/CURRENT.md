# LSA Research Corpus — Current Architectural Truth

**Architecture reconciliation — October 17, 2026.** This document preserves settled architecture, not release status. Latest reviewed canonical main is c9ad717a (#231); #224 integrated Memory K + ElevenLabs EA, #32/#223 radio is mainline, #213/#214 and #229–#231 add later source/reliability improvements. Read the [canonical roadmap](../ROADMAP.md), [current phase/evidence matrix](../IMPLEMENTATION-STATUS-20261017.md) and [implementation queue](../NEXT-PHASES-20261017.md). The [October 8 master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md) and older v1 milestone are retained technical and historical artifacts, not a bound on today's next-phase queue. Normative D-001–D-017 and C-01–C-15 remain unchanged.

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

**Authority is the [implementation matrix](../IMPLEMENTATION-STATUS-20261017.md), not the October 11 snapshot.** E1–E6, P0–P2, UX0–UX4, ACT0–ACT2, PS0–PS4, radio, Phase 13a, and Memory K M0–M9 modules are integrated on main with independent activation/acceptance requirements. ACT3 is contract/scaffolding only; ACT4–ACT7, PS7, PS8, CGE and standalone cutover remain future tasks. #35/#37/#47/#50/#222 are open branch work; #224 replaces #216/#138. Current install, production net481 build and GTA validation must be proven per exact binary.

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

Use the [priority roadmap](../ROADMAP.md) and [scoped tasks](../NEXT-PHASES-20261017.md), not a legacy Phase 6-only milestone. Immediate owner/readiness/memory/voice/PS6 GTA checks and open-PR triage precede new feature claims. Next implement ACT3 first capability and ACT4/ACT5 using existing architecture; C-01 source-time hearing can reconcile in parallel before PS7/ACT7. Preserve the detailed research dependencies without rerunning already implemented phases.

## Important historical-status rule

The original October 5 convergence audit is preserved under `docs/research/archive/convergence/` as historical evidence. The active convergence architecture, ownership, dependency and risk documents are status-neutral/current-safe syntheses. Never use an archived snapshot to answer what is merged, deployed or validated today; use the roadmap and phase status docs.
