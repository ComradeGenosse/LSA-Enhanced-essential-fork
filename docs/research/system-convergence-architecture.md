# System convergence architecture

Status: **current architecture synthesis**. Updated 2026-10-08. The [unified intelligence master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md) supplies the code-level cross-system implementation sequence; the original [PS4 plan](PS4-code-level-implementation-plan-20261008.md) remains the baseline detail.

This file intentionally contains no branch-head or deployment snapshot. Use [../ROADMAP.md](../ROADMAP.md) for implementation/deployment truth. The original October 5 audit is archived at [archive/convergence/system-convergence-architecture-audit-20261005.md](archive/convergence/system-convergence-architecture-audit-20261005.md).

## One-sentence architecture

**Essential is the sole native GTA executor; LSA layers durable identity, observer-relative evidence, knowledge, planning and orchestration around Essential through bounded contracts.**

## Ownership that must not split

| Concern | Authority |
| --- | --- |
| Native GTA tasks, conversation/session lifecycle, playback | Essential |
| Durable CharacterId / authenticated binding | P1 |
| Durable character/profile store | P2 |
| Raw world evidence / observer observations | PS0–PS2 |
| Deterministic salience | PS3 |
| Model-visible knowledge assembly | PS4 TurnKnowledgeFrame |
| Physical activity planning/arbitration | ACT |
| Autonomous scene policy | Director proposes; ACT/Essential execute |
| Explicit talk selection/input | UX; Essential owns committed conversation-partner lifetime |
| Supplemental conversation gaze | CGE head/eye only; yields to Essential |
| Provider inference / STT / TTS | Stateless service; no native authority |

## Core composition

```text
GTA / Essential
   ↓
native facts + exact lifetime fences
   ↓
PS0–PS2 evidence / observer observations
   ↓
PS3 deterministic salience
   ↓
PS4 TurnKnowledgeFrame (single model-facing knowledge writer)
   ↓
provider decision / Director proposal
   ↓
ACT arbitration when physical behavior is required
   ↓
Essential executes and emits receipts/playback state
```

Durable identity/persistence (P1/P2) joins this flow only through authenticated identity and recognition/timeline gates. CharacterId is never a physical effect address.

## Convergence contracts

Already landed in current runtime behavior:

- **C-03** — salience grant is not consumption; explicit acknowledgement consumes it.
- **C-10** — successful UX4 PTT release does not clear Essential's committed conversation partner.

Settled architecture still requiring implementation/reconciliation includes:

- **C-01** one source-time UtteranceLifecycle;
- **C-02** shared run-local anchor/reference service;
- **C-04** PS4 TurnKnowledgeFrame as the single epistemic firewall;
- **C-05** dialogue-action receipts independent of spoken-history commit;
- **C-06** one truthful primary-behavior owner token;
- **C-07/C-08/C-15** TimelineGuard + Profile v2 + SubjectRef before automatic durable experience;
- **C-09** bounded capability/health read model;
- **C-11** Director proposes, ACT owns physical activity/directed-interaction execution;
- **C-12** responder reservation / turn-yield semantics;
- **C-13** shared hostRunId/world epoch;
- **C-14** normalized ObserverSituation/activity view.

Normative definitions live in [system-contract-register.md](system-contract-register.md).

## Composition rules

1. Facts are not knowledge; knowledge is not salience; salience is not action authority.
2. No feature creates a second native task/session/playback lifecycle beside Essential.
3. No feature uses CharacterId, names, model hashes or appearance as a native effect address.
4. No subsystem writes its own free-form model prompt block once PS4 exists; it contributes typed lane items.
5. Director/PS may propose behavior but ACT arbitrates physical behavior and Essential executes it.
6. Automatic durable memory/relationships/commitments wait for timeline-safe persistence.
7. Archived branch snapshots are evidence only and never answer current merge/deploy state.
8. Baseline requested-turn PS4 delivery does not wait for radio, gaze, proximity hearing, automatic memory, Director or Genesis expansion. Reuse PS2 stores/provider infrastructure; do not create competing event ledgers, databases or routers.
