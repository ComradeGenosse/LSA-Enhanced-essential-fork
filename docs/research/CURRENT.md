# LSA Research Corpus — Current Architectural Truth

Updated: 2026-10-05.

This document summarizes **what the research corpus currently believes**. It is not the implementation/deployment ledger; use [../ROADMAP.md](../ROADMAP.md) for that.

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

Current `main` contains the dialogue/provider foundation E1–E6, P0–P2, UX0–UX4, PS0–PS3, and bounded intelligence JSONL telemetry. PS3 is deployed in shadow and live PS2→PS3 evaluation/telemetry has been exercised.

ACT0/ACT1 and ACT2 are substantial implemented-but-unmerged branches. Radio R0–R2 is implemented but unmerged. CGE and PS4+ remain planned/researched rather than implemented.

For exact gates and GTA acceptance state, use [../ROADMAP.md](../ROADMAP.md).

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
ACT0/1 + ACT2 reconciliation
          │
          ├── C-02 shared anchors
          ├── C-06 owner token
          ├── C-13 host/world epoch
          └── C-14 ObserverSituation

C-01 UtteranceLifecycle
          │
          ├── PS2 speech hearing
          ├── CGE
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

PS6 Director proposals
          │
          └── PS7 social/directed exchange ⇄ ACT7 execution
```

## Current next-work interpretation

The roadmap currently prioritizes fresh UX4 acceptance, ACT0/1 reconciliation, then ACT2 reconciliation. After ACT consolidation, **PS4 TurnKnowledgeFrame and ACT3 rich short-range activities are the next major architectural implementations** and can proceed in parallel once their prerequisites are met.

Radio R0–R2 can remain a raw-facts side track. Radio model-visible knowledge waits for PS4. CGE waits for C-01 and remains head/eye-only.

## Important historical-status rule

The convergence audit was a snapshot taken earlier on October 5. Its architecture, contracts, risks and dependency conclusions remain authoritative, but its branch/deployment tables are **historical evidence as of that audit timestamp**. Do not use them instead of the current roadmap to answer whether PS3, UX4 or another phase is merged/deployed today.
