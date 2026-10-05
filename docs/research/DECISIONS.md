# LSA Durable Architecture Decisions

These IDs are stable references for plans, reviews and implementation prompts. Evidence and detailed rationale live in the convergence package and domain research.

| ID | Maturity | Decision | Primary contract / evidence |
| --- | --- | --- | --- |
| D-001 | **LOCKED** | Essential is the sole native GTA executor. LSA planners/adapters request through validated Essential seams; they do not create a competing TASK/session/playback lifecycle. | convergence architecture; C-11 |
| D-002 | **LOCKED** | CharacterId is durable identity only. Physical effects use current validated native tuples / run-local refs. | P1 research; C-02/C-15 |
| D-003 | **LOCKED** | P2 is the single durable character/profile store. Later memory, relationships and commitments extend/migrate it rather than create parallel stores. | convergence architecture; C-08 |
| D-004 | **LOCKED** | World facts, observer knowledge, salience, memory and action authority remain separate. A callback/global query never automatically becomes something an NPC knows. | PS architecture |
| D-005 | **SETTLED** | C-01 UtteranceLifecycle is the one source-time representation of player speech for STT/hearing/gaze/social/memory consumers. | C-01, R-01 |
| D-006 | **SETTLED** | C-02 shared anchors become the common run-local entity reference service used across PS/ACT/Director joins. | C-02, R-03 |
| D-007 | **LOCKED** | Salience entitlement and consumption are distinct; only an acknowledged consumer delivery consumes the relevant entitlement. | C-03, R-06 |
| D-008 | **SETTLED** | PS4 TurnKnowledgeFrame is the single writer of model-visible knowledge. ACT/radio/social subsystems contribute typed lane items, never independent prompt blocks. | C-04, R-02 |
| D-009 | **SETTLED** | Dialogue actions need C-05 receipts so physical action/self-knowledge does not depend on assistant playback/history commit. | C-05, R-05 |
| D-010 | **SETTLED** | Primary physical behavior exposes one truthful owner/mode token for arbitration. | C-06, R-12 |
| D-011 | **SETTLED** | TimelineGuard + one Profile v2 migration + SubjectRef land before automatic durable experiential memory, relationship edges or commitments. | C-07/C-08/C-15 |
| D-012 | **LOCKED** | Essential owns committed conversation-partner lifetime. UX selection may commit a target but must not clear/redirect the partner merely because PTT input ended. | C-10 |
| D-013 | **SETTLED** | Scene Director proposes intent; ACT executes physical activities and LSA-directed interactions under ACT ownership/leases; Essential remains the executor. | C-11, R-08 |
| D-014 | **SETTLED** | CGE is a yielding head/eye presentation overlay. Whole-body orientation belongs to ACT3 `stop_and_face`; CGE does not compete with Essential look behavior. | R-09; CGE plan |
| D-015 | **SETTLED** | Radio is a factual producer. NPC knowledge requires PS2 witness → PS3 salience → PS4 projection; radio never owns a prompt writer. | C-04; radio v2 |
| D-016 | **LOCKED** | Existing Essential E1 turn lifecycle remains: exact tuple identity, genuine player input once, assistant history only after matching successful playback, no fake player turns from special/internal events. | E1/P0 convergence lock |
| D-017 | **LOCKED** | No broad task clears or automatic replay of already-published side effects. Handler acceptance is not physical completion. | Essential action audit; ACT research |

Changing a **LOCKED** decision requires contradictory evidence and an explicit architecture review. Changing a **SETTLED** decision requires updating this file, the relevant contract, dependency graph and roadmap impact.
