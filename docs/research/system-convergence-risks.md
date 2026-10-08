# Current system convergence risks

Status: **active risk register**, updated 2026-10-08. Implementation mitigations are phased in the [unified master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md).

The frozen October 5 audit is archived at [archive/convergence/system-convergence-risks-audit-20261005.md](archive/convergence/system-convergence-risks-audit-20261005.md). This file lists only risks that remain materially relevant now.

| ID | Priority | Current risk | Required mitigation |
| --- | --- | --- | --- |
| R-01 | P0 | Player speech still lacks one authoritative source-time utterance lifecycle across stock Talk, MarkedTalk, UX4 and typed input. | C-01 before PS2 player speech, player-listening CGE or social routing; playback-only CGE uses existing native events and its separate ownership/mechanism gate. |
| R-02 | P0 | The live prompt path still needs one epistemic firewall before more model-visible context writers ship. | C-04 PS4 TurnKnowledgeFrame. |
| R-07 | P0 | Automatic durable experience can become save/timeline-incoherent. | C-07 + C-08 + C-15 before PS5/relationships/commitments. |
| R-03 | P1 | PS, ACT and P2 still have overlapping run-local entity-reference concepts. | C-02 shared anchor service before ACT3/PS4 joins require it. |
| R-05 | P1 | Dialogue actions can execute independently of spoken-history commit without a durable self-fact receipt. | C-05 before ACT4/PS5. |
| R-10 | P1 | ACT callback vocabulary/correlation can drift when adding C-05 or later capabilities to merged ACT0–ACT2. | Preserve current canonical callback tests and add publication/ordinary-actor/ambiguity tests in master phase 6. |
| R-12 | P1 | Primary physical behavior ownership is not yet one truthful runtime token; merged ACT2 still writes idle after residual behavior. | C-06 sampled owner truth in master phase 6; relevant native admission subset is required for early passive PS6, without waiting for PS5. |
| R-13 | P1 | Run/world epoch fences are fragmented across channels. | C-13 shared hostRunId/world epoch. |
| R-16 | P1 | Stock/special turn yield semantics for multi-character responder reservation remain unproven. | C-12 probe before PS7. |
| R-27 | P2 | Activity/situation vocabularies can diverge between ACT and PS consumers. | C-14 ObserverSituation normalization. |

## Resolved architecture defects from the October 5 audit

These should not be reopened from archived prose unless new evidence contradicts current main:

- **R-04:** UX4 no longer clears Essential's committed conversation partner on successful PTT release.
- **R-06:** PS3 grant/consumption semantics are separated with acknowledgement and stale-key fencing.
- **R-08:** Director/ACT directed-interaction ownership is settled: Director proposes, ACT7 executes.
- **R-09:** CGE yields to Essential look behavior; body orientation belongs to ACT3.
- **R-11:** the PS3 skipped-test/import-discovery failure was fixed; corrected full-suite verification is recorded in the PS3 status doc.
- **R-22:** stale-research search pollution was addressed by the 2026-10-06 archive/hygiene pass.

For unresolved evidence questions rather than architectural risks, use [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).
