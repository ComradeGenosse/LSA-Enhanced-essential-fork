# LSA Research Corpus — Current Architectural Truth

Updated: 2026-10-08. Source reconciliation: `main@7e54b17` and PR #21; this update is planning only.

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

Current `main` contains the dialogue/provider foundation E1–E6, P0–P2, UX0–UX4, PS0–PS3, ACT0–ACT2, and bounded intelligence JSONL telemetry. PS3 is deployed in shadow and live PS2→PS3 evaluation/telemetry has been exercised. ACT0–ACT2 merged through PR #18 on October 6; the 83-file install and integrated GTA smoke test are recorded, while focused capability probes/default-off gates remain open.

Radio R0–R5/v2 is implemented on the unmerged `feature/radio-track-perception-v2-text-id@ad6cad61` stack; its fresh offline/build/GTA/catalog release gates are not closed. Its R5 live observer/contextText writer must be converted to the frozen C-04 seam before incorporation. CGE, proximity routing and PS4+ remain planned/researched rather than implemented. Existing P2 canon/manual memories already enrich dialogue; PS2/PS3 world awareness still stops before Luna requests.

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

The [unified intelligence master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md) is the implementation sequencing blueprint. Preserve the [PR #21 PS4 code-level plan](PS4-code-level-implementation-plan-20261008.md) as its detailed MVP specification. Next: C-02/C-13 actor/host association → qualified PS2/C-14 → frozen C-04 → all Luna request paths → controlled MVP acceptance. ACT0–ACT2 do not need rebuilding/remerging. Fresh UX4 physical acceptance and focused ACT probes remain separate validation obligations.

After accepted baseline PS4, prioritize C-06/admission and early PS6 passive speech (13a), plus independently probed playback-only gaze (10a). PS5 is not required for transient reactions; C-01 is required for player-listening (10b), not native playback engagement. ACT/C-05 self-knowledge, radio, hearing, timeline-safe automatic memory and advanced social/physical autonomy retain their separate gates. Optional radio, gaze, proximity, Genesis and autonomy never block baseline PS4. ACT3 can develop after shared references; advanced physical execution still needs its own probes. Reuse existing PS2 stores, providers, P2 persistence and ACT engine; no new event ledger, service, database or inference router is required. Future decision-policy variation replaces only a bounded Director selection function; all policies share C-11 validation/tickets, quotas/receipts and ACT/Essential authority. No alternative production policy is added.

## Important historical-status rule

The original October 5 convergence audit is preserved under `docs/research/archive/convergence/` as historical evidence. The active convergence architecture, ownership, dependency and risk documents are status-neutral/current-safe syntheses. Never use an archived snapshot to answer what is merged, deployed or validated today; use the roadmap and phase status docs.
