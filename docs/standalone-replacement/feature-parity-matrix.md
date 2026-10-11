# Phase 0 — feature parity and migration decisions

**Status:** source-backed initial Milestone A scope selected; Milestones B/C feature-level parity and real-game baseline remain later review gates.  
**Reference:** `main` `79a0aa6eb5f6b655afde65993d5d68cba269bca7` on 2026-10-11. Open #32, #35 and #37 are **not** accepted `main` features.  
**Legend:** **A** = Milestone A (typed conversation prototype); **B** = Milestone B (playable standalone); **C** = Milestone C (retirement/parity); **D** = intentionally defer/omit unless a later scoped feature requires it.

**Migration labels:** `reuse` = preserve domain logic with a new adapter; `replace` = write independent runtime behavior; `drop` = no stated parity requirement; `probe` = more physical/source evidence needed.

| Feature / requirement | Goal | Migration | Current source/Essential seam | Offline proof | In-GTA evidence still required |
| --- | --- | --- | --- | --- | --- |
| Standalone RAGE plugin load/exit | A | replace | `native/promoted-characters/EntryPoint.cs` / `ClrDomains` / `DomainHost` | Isolated assembly compiles without `LosSantosAlive`; fake host teardown | RAGE loads, ticks, shuts down safely |
| NPC detection/validity/incarnation | A | reuse + replace | `EntityAnchors.cs` / `NpcStateStore` / `PerceptionSystem` | Handle reuse, birth/death, stale address and world epoch simulation | GTA ped lifetime and changing model/handle |
| Exact conversation target | A | reuse + replace | `TalkTargetSelector.cs` / `NpcTargeting` | Target select/cancel, stale selection tests | Real ped address and selection controls |
| Typed player input | A | reuse + replace | `NativeCommands.cs` / `InputController.SendTextPrompt` | Exactly one typed input and snapshot | User can type in GTA and reach selected ped |
| Turn/session/generation ownership | A | replace | Stock `server.bundle.mjs` + `essentialGlue.mjs` | Allocator, cancellation, overlapping actor turns, reconnect order | Turn timing at actual native host boundary |
| Luna reasoning and decision validation | A | reuse | `src/openai/*` / `src/context/decisionValidator.mjs` | Fake API and pinned fixtures; invalid actions blocked | Full request reaches provider on actual setup |
| Speech synthesis and PCM generation | A | reuse | `src/openai/speak.mjs` | 24 kHz mono PCM chunks, EOS, malformed chunks, retries | Full speech and latency under live game |
| Audio authorization, queue, interrupts | A | replace | `NpcPlaybackCoordinator` / `nativeDelivery.mjs` | Byte ordering, buffering, late chunks, matching completion | Exact native speaker/turn outputs |
| Spatial speech audibility | A | probe + replace | Essential audio stack; NAudio/RAGE dependencies | Adapter contracts, packet-level audio fixture tests | **Critical go/no-go:** audible at world ped, respects proximity |
| Lip sync and conversation gaze | C | probe + replace | Essential `NpcLipSync` / `ConversationLookBehavior` | Fake animation ownership/yield | Lip/eye/head behavior under talking, movement, combat |
| Assistant history commit | A | reuse | `DialogueHistory` and exact `nativeDelivery` terminal | Only accepted matching heard completion writes history | Actual playback result agrees with game |
| Error/retry/telemetry and health | A | reuse | `src/reliability/*` / `observability/*` | Provider timeout, stream loss, restart, redaction | Install and game logs correlate exact run |
| Standalone native↔Node transport | A | replace | Stock WS audio protocol v3; current private P2/PS pipes | Real two-process protocol, version and reconnect tests | RAGE thread/fiber ownership and buffering |
| Mic/PTT capture and STT turn | B | reuse + replace | `InputController` / `EssentialMicState`; #37 draft C-01 hooks | One utterance, one STT, cancel/release/capture ordering | Native audio capture/source-time correctness |
| Controller, UX4 target cycle, UI | B | reuse | `native/enhanced/Input/*`, `TalkPttSession.cs` | Gesture timing/owner/action routing; existing UX tests | Actual controller signals and RAGE menu behavior |
| Promoted actor binding and summon | B | reuse + replace | P1/P2 / `PromotedCharactersIntegration.cs` | Persistent ID vs ped incarnation, owner proof, release | Spawn/adopt/respawn follows intended NPC |
| Profile and manual memory persistence | B | reuse | `src/characters/profileStore.mjs` and editor | Local schema migration, atomic save, rollback tests | Recreated NPC loads right profile without stale ped |
| Action request validation and dispatch | B | reuse + replace | ACT `StepRunner` / `NpcActionQueue` / `NpcActionRegistry` | Lease/mode acceptance separate from completion, flags and reports | Correct native task start / completion |
| Follow/Wait and movement | B | replace execution | `NpcActions.FollowTarget` / `WaitHere` and `FollowBehavior` | Mode, repeat, target changes, supersession | GTA movement, obstacle avoidance, distance/restart |
| Vehicle seat enter/exit and follow | B | replace execution | `VehicleBehavior` / P2 flags | Seat intent and timeout state machine | Actual seat occupied and vehicle ownership stable |
| Combat/reflex priorities | B | replace execution | `CombatBehavior` / `NpcState` | Safety gating, interrupt/restore state machine | Actual collision, fights, ragdolls, no unsafe task clears |
| Context, NPC/world facts | B | reuse + replace | `ActorContextProvider` / `PerceptionSystem` | Serialization/provenance, missing-field semantics | GTA world state and stable identity |
| PS0–PS4 observer knowledge | B | reuse | `native/intelligence/*`, `src/perception/*` | Witness eligibility, salience grant+ack, PS4 single writer | Native gunfire/events, LOS/interiors correct |
| Spontaneous speech / Director | B | reuse + replace | `DirectorAdmission` / stock `SpecialGeminiTurnScheduler` | Quiet/admission/yield/interrupt and ticket one-shot | Actual NPC barks and player mic priority |
| Radio and contextual ballistics | B or C after acceptance | reuse + replace source | Draft #32 / #35 plus PS2/PS3/PS4 | Branch-specific evidence, semantics, fallback | GTA native radio ID and shot/hit source correctness |
| Proximity hearing / multi-observer | B or C after acceptance | reuse + replace input | Draft #37 C-01/Phase 9 | One accepted transcript, individualized acoustics and receipts | Mic timings, actual in-vehicle/interior acoustics |
| Scenario/location actions and navigation | C | replace selectively | `ResumeActivityBehavior`, `DestinationResolver` | Goal/timeout and simulated path resolution | Real navigation, scenario animation/postconditions |
| NPC↔NPC social and directed scenes | C or D | selective | Stock directed interactions, future ACT/PS7 | Arbitration, responder reservation logic | Multiple live NPC interactions, task compatibility |
| Stock Gemini and its model route | D | drop | Original stock backend | No dependencies introduced | No |
| PR/LSPDFR, hostage scenes | D | drop by default | Original integration bridges/actions | Explicit absence from independent build | Only if separately selected |
| Old activity queue and vestigial destination placeholders | D | drop | Audited native `NpcActivityQueueItem` / `DestinationResolver` | Feature not selected; no production reference dependency | None unless behavior explicitly required |

## Evidence priority: which code to keep

- **Pure model/policy candidates:** `native/activities/StepMachine.cs`, `StepRunner.cs`, `CapabilityTable.cs`, `SupersessionMonitor.cs`; `native/intelligence/EntityAnchors.cs`, `SensorAdapters.cs`, `DirectorAdmission.cs`, and compatible protocol codecs; `native/enhanced/Input/GestureRecognizer.cs` and menu/view model policies. **Reuse does not mean every implementation compiles unchanged**; audit module-specific Essential type references and threading before porting.
- **Native adapter rewrite hotspots:** `PromotedCharactersIntegration.cs`, `ActivityDispatch.cs`, `NativeCommands.cs`, `IntelligenceIntegration.cs`, `TalkTargetSelector.cs`, `RuntimeEntry.cs`, `DomainHost.cs`, `EntryPoint.cs`, `EssentialMicState.cs`.
- **Companion protocol rewrite hotspots:** `lsa-essential-e1-candidate/tools/buildCandidate.mjs` (70 expected patches), `src/integration/essentialGlue.mjs`, `src/integration/nativeDelivery.mjs` and remaining stock lifecycle references in `src/openai/openaiConnection.mjs`.

## Why 65 registered actions do not equal 65 mandatory implementations

[Canonical action catalog](../research/domains/essential/essential-action-catalog.json) establishes stock name/alias exposure and handler acceptance, but **not** physical completion. The [later native activity evidence](../research/domains/activities/activity-native-evidence.json) finds unused activity/destination paths, despite exposing some corresponding public methods. Phase 7 should implement the small documented **player-visible** subset and truthful postconditions first, not assume that an exposed handler is a reliable action or required for parity.

## Follow-up implementation and physical acceptance decisions (Phase 1 onward)

1. Milestone A is **typed dialogue only** as described in the adopted 10-phase plan; microphone/UX4/ACT/perception remain deliberately deferred to B, with the current Essential version left usable.
2. **Technical Phase 5 gate:** audible spatial NPC speech, identity, interruption and history correctness. Lip sync can remain a tracked **visual parity** gate for later phases; do not call audio-only testing complete conversation parity.
3. Decide whether Milestone B requires the same stock behavior under missions, vehicles and third-party mods or a consciously narrower supported matrix.
4. Verify current open branches (#32/#35/#37) and future `main` changes before using their production code or asserting parity.
5. Define external licensing/asset ownership for any audio, fonts, config/data or libraries; do not redistribute Essential's binaries by default.

**Do not relabel "offline passed" as GTA accepted.** Current acceptance tasks and source gaps: [phase-0-acceptance.md](phase-0-acceptance.md).

