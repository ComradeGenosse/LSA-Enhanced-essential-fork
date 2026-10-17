# PS6 Phase 13a — source audit, verified gaps and GTA acceptance (2026-10-17)

Target: latest #138 `aefd4d96f975f892ce4a26edb50cb0b487555be3`. This is a **source/offline** assessment, not a controlled GTA V Enhanced run. PRs #201, #207 and #212 are preserved by building on #138. Phase 13a, not 13b/PS7/M9.

## Source-level event coverage

| Category | Source native producer | PS2/PS3 route | PS6 production readiness | GTA Enhanced proof |
|---|---|---|---|---|
| Gunfire / firing_burst | Native `IS_PED_SHOOTING` sampled 50 ms, rising-edge; native `CaptureWitnesses` frontal LOS or carefully qualified gunshot hearing | `EpisodeCorrelator.firing` -> witnessed `firing_burst`; PS3 can grant | Full wired selection/admission/playback/ack exists; momentary native priority preflight previously burned candidate, now fixed | Previously heard by user; **not retested by this PR** |
| Vehicle impacts / collisions | DamageTracker `OnVehicleTookDamage` and native callback collision coordinate; vehicle-state samples are NOT proof of an impact | `vehicle_damage` maps to `vehicle_impact`, but this native callback does not attach an independently sampled witness; vehicle targets are not self ped observers | **Blocked for normal nearby-NPC speech** until valid owner-fiber impact/witness proof and bounded correlation; don't infer crash from vehicle state | Previously heard, exact source chain unknown; unverified |
| NPC injury / attack | DamageTracker `OnPedTookDamage` when loaded/pinned and captured target exists; state `injury_state` sample | State injury edges have LOS witnesses; callback `damage` has no positive bystander receipt. Attacker identity can be unknown | **Conditional** on actual sampled injury and witness; native damage callback alone does not authorize a bystander reaction | Not verified |
| Player injury / attack | DamageTracker `OnPlayerTookDamage` and player state sampling | Player not a promoted NPC observer; sampled injury can be LOS-witnessed; damage callback has no bystander receipt | **Conditional** on positive native visual witness. No implied assault perpetrator | Not verified |
| Promoted NPC injury / attack | DamageTracker ped callback plus native state injury/death edge | Same current observer/victim gets independently qualified self-receipt; bystanders need actual native LOS | **Conditional**; source, lifetime, player-priority and cooldown gates required | Not verified |
| Witnessed death | Native state `dead: false→true` sampler emits `death`; owner retirement has extra sample path | LOS/self witness -> `death_seen`, PS3 safety rules can grant | **Conditionally wired**; snapshot sampling and observer ownership may be missing | Not verified |
| Discovered body | `body_found` exists as PS2/PS3 event and Director context vocabulary, **but there is no independent discovered-body native producer** in current PS1 / correlator mapping | Schema alone does not produce a live observation | **Blocked**, leave unimplemented until source-time body-discovery provenance is verifiable | Not verified |
| Other threats | `threat` is in schema/PS3/Director, but there is no general native PS1 `threat` edge | May arrive only from supported source-specific PS2 evidence; no freeform 'danger nearby' inference | Selection allowed only with real PS3 entitlement and supported direct evidence | Not verified |
| Radio, location, activity, chatter, routine actions | Signals exist for various routines, including radio | Eligible PS3 context is not itself a Phase13a reaction grant | **Explicitly excluded** from spontaneous speech selection in this PR | No reaction expected |

Sources: `native/intelligence/{SensorAdapters,DamageSensors,IntelligenceIntegration,WitnessPolicy}.cs`; `lsa-essential-e1-candidate/src/perception/{episodeCorrelator,shadowRuntime,salienceEngine,sceneDirector,sceneDirectorAdmission,sceneDirectorOrchestrator,directorProduction,directorContext,directorPlayback}.mjs`.

## Confirmed reliability defect and bounded fix

The original `DirectorObservationPump.tick()` wrote `seen[decisionKey]` before calling `stampFor`. Missing/stale native C-06 player priority or P2 ownership made the orchestrator fail admission, **but still spent the per-epoch decision key**, so an otherwise fresh grant could never run after the native proof returned. The fix requires the current stamp *before* marking that decision attempted. No claim, native ticket or model call is created while proof is missing. Native/PS3 vetoes **after** that gate remain one-shot and consume normal budgets. Offline tests verify recovery and no replay after true attempts. A fresh phase13a selector event allowlist prevents routine PS3 events from accidentally producing unsolicited speech.

## Other blockers / guardrails

- Native damage callbacks are not supplemented with source-time witness receipts; do **not** use current proximity or later LOS as fabricated historical witness proof. Owner-fiber, source-time attested callback/witness joining would require its own contract and native validation.
- `vehicle_state` cannot be treated as a verified collision; `body_found` and generic `threat` are schema-recognized but producer-incomplete. Explicitly document, not fake.
- C-06, original PS3 entitlement, P2 ownership, player-priority, current world epoch, per-scene/per-speaker cooldowns (20/5 seconds standard, 5/2 testing), 4/minute normal or mutually opted-in 12/minute testing, native tuple checks, and completed-audio acknowledgment stay unchanged.
- The PS3 response entitlement is acknowledged only after native validated completed playback. An interrupted/failed/no-audio result is never success.
- The existing `director_gate`, `director_candidate`, `director_admission_veto`, `director_handoff`, `perception_trace`, native `[PS]`, `knowledge_request_stale`, and `turn_stage` events provide stage codes. Never treat a capability flag or a 13a schema entry as runtime witness proof.

## GTA acceptance checklist (Nathan, free roam)

1. Start current experimental PS6 + native matching preset. Verify startup native `[PS]` shows enabled shooting/state/damage producers and Director mode; companion native channel hello and a fresh `director_priority` event. Never interpret 'connected' alone as witness evidence.
2. **Gunfire, Nathan looking/on foot:** nearby controlled gunfire. Look for `[PS]` shooting count advancing, `perception_trace` PS2 witnessed `firing_burst`, PS3 eligible/urgent, `director_candidate`, reservation/handoff, `turn_stage` Luna/TTS, native completed playback and acknowledgment. One response maximum per qualified incident. If silent, follow the first absent stage.
3. **Gunfire without sight / outside hearing:** no PS2 positive receipt and no spontaneous line. Negative control.
4. **Collision:** safely bump a stationary vehicle. Observe `vehicle_damage` callback count. If PS2 no independently witnessed impact, **silence is expected** with current gap; a visible `vehicle_impact` alone does not establish eligibility.
5. **Player injury / promoted NPC injury / ambient NPC injury:** trigger controlled minor damage away from missions. Confirm `playerDamage` or `pedDamage`/sampled `injury_state`, witness identity, PS3 entitlement before expecting a line. A callback with no witness is a valid block.
6. **Witnessed death:** controlled nearby death in Nathan's direct view. Confirm sampled state death, native LOS and `death_seen`, then PS3/PS6 chain. Unseen death must not be claimed as witnessed.
7. **Discovered body / unspecified threat:** no currently proven producer; record missing-source evidence rather than expecting dialogue.
8. **Player talking, keyboard input, other NPC already speaking, vehicle, mission:** create a qualified event while busy. Native C-06/player priority must veto; test again with a NEW event after verified idle rather than replaying an old grant.
9. **Long session / reconnect / world change / Nathan dismiss/re-promote:** repeat gunfire. Verify epoch clears dedupe and old captureRefs/tickets cannot be reused. Interrupted playback must not acknowledge success.
10. **Radio/location change only:** no spontaneous speech. Ask a direct radio question instead for the separate PS4 radio feature.

Read stage sequence by first matching native signal counts -> PS2 observer-qualified `perception_trace` -> PS3 response counters -> `director_gate` / `director_candidate` -> native `director_admission_veto` / `director_handoff` -> Essential turn stages -> completed playback. Native ticket IDs and sensitive turn/memory text are intentionally not emitted in new logs. Reproduce one event at a time and use time/order plus event class; exact end-to-end ID-level correlation remains limited by existing redaction and would require a reviewed opaque correlation contract.

Offline tests demonstrate **contract behavior**, not native device/physics source availability, a production net481 build, or GTA reactions.


## Follow-up: bounded PS6 failure-stage diagnostics (2026-10-17)

The original first-pass fix #214 now also reports a closed, non-identifying `eventType` alongside `director_gate` and `director_candidate` for an already-selected source-verified 13a event. Only six approved threat categories survive telemetry sanitization; unsupported event names and raw actor/incident IDs do not. When PS3 candidates exist but are filtered, bounded gate codes distinguish `non_13a_event`, `ps3_entitlement_stale`, `ps3_response_ineligible`, `direct_witness_unavailable`, and `ps3_evidence_expired` where source information is sufficient; otherwise `candidate_filtered` remains the truthful result. These are **diagnostics only** and cannot authorize a turn. The gate reason throttle resets on a new host run/world epoch to make reconnection failures visible. After native admission begins, `native_reserve_exception`, `native_submit_exception`, `stock_dispatch_exception`, or `playback_terminal_exception` identify a failure stage without exposing private exception text. No retry is added; native one-shot and privacy gates are unchanged.

`eventType` categorization is *not* a globally unique event correlation ID; controlled GTA logs are still needed to prove specific native signal-to-PS6 turn matching. Legacy event types that are not Phase13a threats remain excluded from unsolicited speech.


### Offline end-to-end PS2/PS3 selection verification

The focused CI now also runs `tests/ps6-phase13a-source-pipeline.test.mjs` using the **actual** `EpisodeCorrelator`, `ObservationStore`, `SalienceCache` and `selectDirectorIntent` with source-shaped native fixtures. It checks gunfire, sampled player injury, witnessed death, damage callback without a witness, collision callback without a witness, duplicate signals and unsupported `body_found` / generic `threat` raw kinds. This narrows uncertainty about the companion route but **cannot verify physical GTA producer callbacks, LOS geometry, native original PS3 receipts, C-06 or finished playback**.
