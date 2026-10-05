# LSA Open Research / Validation Questions

Only unresolved questions that can materially change architecture or implementation sequencing belong here.

| ID | State | Question | Needed evidence / unblock |
| --- | --- | --- | --- |
| Q-001 | **UNKNOWN / high priority** | What exact Essential/native seam should mint C-01 `utteranceId` and authoritative start/end timing across stock Talk, MarkedTalk, UX4 and typed input? | Source-time mic/capture probe; confirm turn-allocation ordering and cancellation terminals. |
| Q-002 | **OPEN GTA probe** | What are the controlled player/NPC/vehicle native damage callback counts/order/threading under isolated scenarios? | Controlled GTA damage-callback session with telemetry. |
| Q-003 | **UNKNOWN before PS7** | Can the stock/special turn path deliberately yield/suppress a responder without creating incorrect conversation state? | C-12 turn-yield/responder-reservation probe. |
| Q-004 | **UNKNOWN** | Which game/save signals, if any, can reliably detect rollback/timeline changes automatically? | Save/load experiments. Explicit timeline selection remains the safe baseline. |
| Q-005 | **RESEARCH-GATED** | Which GTA navigation primitives are reliable enough for real `lsawalkto` / `lsadriveto` completion semantics? | ACT6 navigation probes and physical completion evidence. |
| Q-006 | **DEFERRED** | Can LSA reliably detect important third-party script task ownership for promoted peds without false confidence? | Targeted coexistence probes; not required for current ACT0–ACT3 work. |
| Q-007 | **CGE0 probe** | Which head/eye attention mechanism safely coexists with walking/scenarios/vehicles and Essential ConversationLookBehavior? | Native/RAGE GTA probe; CGE yields on uncertainty. |
| Q-008 | **RADIO GTA validation** | Does the audible per-song text ID mapping remain stable enough at runtime to join the public radio catalog without container ambiguity? | R0A/R0–R2 GTA validation; raw facts remain safe regardless. |

Resolved questions should be removed from this active table only after their answer is captured in a contract/decision/status document; historical evidence remains preserved.
