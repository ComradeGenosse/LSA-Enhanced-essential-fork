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
| Q-008 | **RADIO GTA validation** | Does v2 text-ID/station mapping and same-vehicle audibility hold for known/unknown/commercial/off content and listener changes? | Unmerged v2 Gate B plus master phase 7 initial-stable/new-listener/exit tests; not an MVP prerequisite. |
| Q-009 | **C-05 integration probe** | Which pinned publication→native callback association disambiguates exact tuple/body/action, including ordinary actors and overlapping same-name actions? | Master phase 6 passive receipt probe/tests; callback payload currently has no full tuple and ACT ring is gated to owned sessions. Ambiguity stays unknown; baseline visual PS4 is independent. |

Resolved questions should be removed from this active table only after their answer is captured in a contract/decision/status document; historical evidence remains preserved.
