# System ownership matrix

Status: **current ownership synthesis**, updated 2026-10-08. Detailed code seams and phased integrations: [unified intelligence master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md).

The detailed October 5 audit matrix is archived at [archive/convergence/system-ownership-matrix-audit-20261005.md](archive/convergence/system-ownership-matrix-audit-20261005.md).

| Concern | Current authority | Other participants | State |
| --- | --- | --- | --- |
| Native ped/task validity | GTA + Essential | LSA anchors revalidate at use | LOCKED |
| Turn/session/generation/playback | Essential | companion observes/requests | LOCKED |
| Conversation partner lifetime | Essential | UX4 may commit at PTT start; readers are read-only | LOCKED; UX4 clear-on-release fixed |
| Explicit UX selection | UX4 | commits through Essential seam | CLEAN |
| Durable CharacterId | P1 | P2 consumes authenticated binding | LOCKED |
| Durable profile/canon/manual memory store | P2 | later PS/ACT schemas extend it | LOCKED |
| Source-time utterance identity/window | C-01 host adapter at proven Essential mic seam | STT/hearing/CGE/UX/social consumers share one id | PLANNED; no live receipt yet |
| Run-local entity references | intended C-02 shared anchor service | PS/ACT/P2 currently overlap | OPEN convergence item |
| Facts / episodes / observations | PS0–PS2 | native producers supply evidence | CLEAN |
| Salience | PS3 | PS4/PS5/PS6 future consumers acknowledge use | CLEAN; C-03 implemented |
| Model-visible knowledge | PS4 TurnKnowledgeFrame | ACT/radio/social contribute typed lane items | PLANNED single writer |
| Physical activity planning/arbitration | ACT | Director may propose | SETTLED |
| Native physical execution | Essential | ACT dispatches through Essential | LOCKED |
| Scene initiative | Director/PS policy | ACT executes physical proposals | SETTLED |
| Directed interaction | ACT7 owns execution | Director/PS7 propose; Essential executes | SETTLED |
| Supplemental gaze | CGE head/eye only | yields to Essential look behavior | SETTLED |
| Whole-body orientation | ACT3 | CGE does not own it | SETTLED |
| Automatic durable experience | P2/Profile v2 behind TimelineGuard | PS5/PS7/ACT7 future writers | BLOCKED on C-07/C-08/C-15 |
| Run/world epoch | future C-13 shared service | current channels have local epochs | OPEN |
| Situation/activity normalization | future C-14 | PS3/ACT consumers | OPEN |
| Radio / nearby speech evidence | PS2 witness and PS3 relevance | catalog/STT/playback supply qualified data; PS4 assembles | Radio unmerged; player hearing gated; no extra prompt writer |
| Provider/voice identity and retries | existing provider stack / P1 voice assignment | C-09 may read health; no new broker/router/store | EXISTING reuse |

## Non-negotiable ownership rules

- Essential remains the only native executor.
- CharacterId is identity, never an effect address.
- Facts do not become NPC knowledge without observer-relative projection.
- Director proposes; ACT arbitrates physical behavior.
- PS4 is the only model-facing knowledge assembler.
- Successful UX4 input release does not clear Essential's committed conversation partner.
