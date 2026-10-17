# Memory K M9 activation: native event producers and spontaneous memory callbacks

Target: PR #138 (`integration/memory-k-production-20261012`). Draft implementation PR; not merged to
main, not deployed, nothing exercised inside GTA.

## What this adds

M9 (memorable GTA events and NPC memory callbacks) is activated as an independent consumer. It does
not require M7 curation, M8 interpretation or H1 conversation history, and it is never legacy-on:
an absent request is off, so installing this build changes nothing until a family is named.

| Capability key | Meaning |
| --- | --- |
| `events.crash`, `events.rollover`, `events.airborne`, `events.water`, `events.wanted`, `events.wasted`, `events.busted` | off / shadow / on, per event family |
| `memory.callbacks` | off / shadow / on spontaneous callbacks |

`shadow` classifies and counts but never reaches PS2, SQLite or the Director. In an explicit capability
map the operator must also request the upstream stages (`ps1.producers`, `ps2.observations`, and for
callbacks `memory.events`, `ps3.salience`, `ps4.assembler`, `ps6.speech`); a missing upstream stage
reports `dependency_blocked` instead of silently running.

## Reused unchanged (not rebuilt)

`M9NativeEventProducer` and `M9Ps2CandidateBridge` (classifier), `M9MemoryCueCandidates`,
`M9DirectorCueAdmission`, `M9CommittedWitnessAuthority` (one defect fixed, see below),
`M9NativeFrameAdapter`, `M9NativeDamageAdapter`, `M9OriginalVehicleCollisionProducer`, PS2 observation
and witness receipts, the M3 witnessed-event recorder (D-023 observation-time attribution), the single
P2 SQLite journal/sidecar and its native-receipt replay index, M4 recall (`recallMemory`,
`preparePs4Recall`, `verifyPs4RecallCurrent`), M5 forget/correct/suppression, M6 retention, learned
memory pause, PS4 `finalizeKnowledgeFrame` and PS6 Director admission (`SceneDirectorSpeech`, native
C-06, 13a/13b). No new model, no new audio player: the callback rides the existing Luna turn and TTS
pipeline as a stock Director `special_event` turn.

## Data flow

```
native owner fiber                          companion (JS)
------------------                          --------------
IntelligenceIntegration.M9.cs               perception/contracts.mjs  validateM9SamplePayload
  M9StateRead (GTA natives)                 shadowRuntime  m9_sample handler
  M9StateSampler  --- m9_sample frame --->  m9RuntimeEvents  (classify -> PS2 qualification)
    M9NativeFrameAdapter (unchanged)          M3 recorder -> P2 SQLite journal + ps2-observation-v1 sidecar
    one-shot Wasted/Busted receipts         m9Callbacks  (wraps SceneDirectorSpeech.attempt)
    WitnessPolicy "m9_incident" @ tick        verified recall -> PS6 admission -> stock Luna turn
```

* Hello: optional `m9SampleVersion: 1` (requires host context + observer index). The strict
  `m9_sample` frame is ignored unless negotiated. Keys of `capabilities` are untouched.
* Witnesses: native `WitnessPolicy` receipts computed at the sample tick, same-tick only; absence is
  unknown, never a negative. Reported/dialogue receipts can never create a firsthand M9 memory.
* Replay: a native receipt id is spent once (native sampler, JS `spent` set that survives reconnect,
  P2 replay index). A collision/outcome presented again after reconnect at a later tick is blocked by
  the JS ledger, at the same tick by P2.
* Callbacks (`m9Callbacks.mjs`): wraps the Director coordinator's `attempt` only. Candidate paths:
  fresh (<=30 s) uses the unchanged cue admission with ports answering only from durable P2 readback
  pinned to `store.memoryRequestFence`; older events arm a verified-recall entry and use the plain
  coordinator. `prepareForTurn` (hooked in `runSequentialTurn` for Director `special_event` turns only)
  consumes the record once, runs `preparePs4Recall` (intent `spontaneous`, source `special_event`) and
  re-verifies visibility before send.
* Speech priority: `readPriority` yields the all-true struct only with quiet backend evidence, a live
  experimental Director (fresh priority <=1500 ms, request version 1), a latest M9 sample <=3 s old with
  wanted level 0 and no urgent PS3 candidate, current owner proof and a writable timeline. Player speech,
  cooldowns (per NPC 10 min, per family 10 min, global 2 min), actor budget (3 per NPC per run) and the
  dialogue-interruption fences remain the existing PS6/13b ones.
* Safeguards: M5 forget/correct (`privacyChanged`), learned-memory pause, world-boundary/epoch change,
  host change and shutdown revoke every armed entry and prepared handle; a forgotten event cannot
  surface through a pending callback (tested before, during and after preparation).

## Native C# (default off, opt-in build)

* `NativeProducerPolicy`: new `m9` request, off unless native config names it (`producers.m9`) or an
  `events.*` capability is `on`/`shadow` and `ps1.producers` is not off. It is not counted as an
  ordinary PS1 producer (`Any`), and `SensorAdapters` refuses it as a signal producer.
* `m9/M9StateSampler.cs`: pure sampler. Validates through the unchanged `M9NativeFrameAdapter`, mints
  exactly-once Wasted/Busted receipts only from a KNOWN false->true edge, spends witness geometry only on
  candidate samples, caps witnesses at 8, shapes the strict wire payload.
* `IntelligenceIntegration.M9.cs`: the GTA glue (natives, occupancy snapshot, collision staging,
  witness geometry), wrapped in `#if LSA_M9_NATIVE`. The main integration file only gained empty partial
  method hooks and a `partial` modifier.
* `SensorAdapters.OriginalVehicleCollision`: inert hook invoked at the original DamageTracker vehicle
  collision callback site, before the signal is observable, feeding `M9OriginalVehicleCollisionProducer.Capture`.
* **Not compiled into the default production build.** The existing W09 packaging policy
  (`w09-packaging-policy.test.mjs`) and the empty `M9-gta-event-original-director` verification inventory
  deliberately keep M9 native sources out of the game build until proven in GTA. They are unchanged.
  To build the sampler: `dotnet build native/promoted-characters/PromotedCharacters.csproj -p:LsaM9Native=true`
  (imports `native/intelligence/m9/M9Native.props`). Without that flag a build with `events.*` capabilities
  requested simply never advertises `m9SampleVersion` and sends no samples.

## Defects and decisions found along the way

1. `M9CommittedWitnessAuthority` assumed `ownerAlias === 'promoted.' + characterId`. Real P2 aliases are
   opaque per-profile ids, so the check could never pass on real data. It now compares against the alias
   the caller's authenticated native owner resolution supplies (`witness.ownerAlias`), keeping the derived
   form as a fallback. Regression test added in `lsa-shared-brain/tests/m9-production-source-admission.test.mjs`.
2. P2's native-receipt replay index includes `sampledGameTick`, so a replay at a different tick bypasses
   it. Added the JS `spent` receipt ledger that survives reconnect; documented the residual (below).
3. The crash receipt's `gameTick` is re-stamped to the owner observation tick (the callback is consumed on
   the next owner pass). It is dropped to unknown unless the player is still in the same vehicle and the
   callback is under 500 ms old; the receipt id never changes.

## Test receipts

| Check | Command | Result |
| --- | --- | --- |
| New M9 events runtime | `node --test lsa-essential-e1-candidate/tests/m9-events-runtime.test.mjs` | 13 pass |
| Callbacks (off/shadow/on, fresh + verified-recall, multi-NPC, forget, replay, restart, pause, cooldown, vetoes) | `.../m9-callbacks.test.mjs` | 23 pass |
| Production `runSequentialTurn` hook | `.../m9-director-turn-hook.test.mjs` | 4 pass |
| Production bootstrap wiring | `.../m9-bootstrap.test.mjs` | 7 pass |
| Real C# payloads vs JS contract (needs built harness; skips otherwise) | `.../m9-native-wire.test.mjs` | 2 pass (mono, Linux) |
| Capability policy | `.../memory-capability-policy.test.mjs` | 11 pass |
| Shared brain (incl. alias regression) | `cd lsa-shared-brain && node --test tests/*.test.mjs` | 357 pass |
| Existing M9 suites | `memory-m9-completion`, `memory-agent-b-events` | 52 pass |
| Full E1 suite | `node tools/runTests.mjs` | 1290 tests, 1275 pass, 13 fail, 2 skipped. The 13 failures are identical to the base branch (M1 editor, streamed NPC segments, S01-S10 original-runner tests, storage-only restart). |
| Verification inventory / memory-sim | `node --test tools/memory-k-verification/tests/*.test.mjs tools/memory-sim/tests/*.test.mjs` | 11 + 7 pass |
| Native M9 harness | `dotnet build native/intelligence/m9-tests/M9NativeTests.csproj && mono .../M9NativeTests.exe` | 84 assertions pass (net481 under mono; not GTA) |
| Native producer policy | `dotnet run --project native/intelligence/producer-policy-tests` | 166 assertions pass |
| Other native harnesses | memory-m3, memory-authority, memory-c01 via `dotnet run` | pass |
| Compile of `IntelligenceIntegration` against GameStub | `IntegrationTests.csproj` with `-p:LsaM9Native=false` and `=true` | both build |

Not run locally: the Windows named-pipe harnesses (`integration-tests`, `intelligence/tests` pipe test,
`promoted-characters` runtime/ps-host tests). They need Windows ACL pipes; under mono they fail at the pipe
connect step, before any M9 code runs. The new workflow runs them on `windows-latest`. Windows CI results are
not available at the time of writing.

## Unverified in GTA (do not treat as proven)

* Every GTA native read in `IntelligenceIntegration.M9.cs`: `IS_ENTITY_IN_AIR`, `IS_VEHICLE_ON_ALL_WHEELS`,
  `IS_ENTITY_IN_WATER`, `GET_ENTITY_SUBMERGED_LEVEL` (submerged threshold 0.75 is an assumption),
  `GET_ENTITY_ROLL`, `GET_ENTITY_SPEED`, `GET_PLAYER_WANTED_LEVEL`, `IS_PLAYER_BEING_ARRESTED(player, true)`
  and `Ped.IsDead` for Wasted.
* Whether the DamageTracker vehicle collision callback fires for ordinary player crashes, once, with the
  player's vehicle as target, and on which thread. The occupancy proof is the last owner-fiber snapshot
  (<=50 ms cadence, <=250 ms old at the callback), not a same-tick proof.
* That witness LOS reads (`HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT`, 40 m) reflect real NPC sight of a
  vehicle incident, and the LOS budget (8 per sample) is adequate with a full roster.
* Real Wasted/Busted ordering: whether the receipt edge occurs before the player ped is replaced, and
  whether witnesses are still anchored at that tick.
* Replay across a companion process restart relies on the native contract emitting each receipt once plus
  P2's same-tick key. A restart at a later tick cannot be fully excluded without a persisted receipt ledger.
* Once-only and cooldown ledgers are in memory per run (reset on companion restart; bounded by the 30
  minute retention window). Callback consumption is recorded at preparation, not at audible playback.
* The protagonist is often `unknown` unless the owner frame resolves it.
* Real Director behavior: native C-06, player-priority epoch, actual Luna/TTS delivery and no-interruption
  under live gameplay, and that a Director stock turn fed a `special_event` carries the memory lane.

## GTA validation checklist (practical)

Use a throwaway save and a backed-up `Plugins/LSA.PromotedCharacters.json`. Build with `-p:LsaM9Native=true`
only for this validation. Start in `shadow`, then `on`.

1. Config: `ps1.producers`, `ps2.observations`, `ps3.salience`, `memory.events`, `ps4.assembler`, `ps6.speech`
   `on`; one `events.*` family at a time `shadow`; `memory.callbacks` `off`. Confirm the log line
   `[PS] m9_sampler_requested` and that the companion diagnostics row for that family is `operational`
   after the first sample.
2. Crash: promote an NPC, drive near them, hit a wall at speed. Expect one `vehicle_crash` row for that NPC
   only (journal inspector). A promoted NPC far away or behind a wall must have no row.
3. Rollover, airborne landing, entering water: one row each; repeat the same maneuver and confirm a new
   row, but re-sending the same collision never doubles.
4. Wanted: raise and clear a wanted level; expect rising and falling `wanted_level_changed` rows only for
   witnesses. Wasted and Busted: die/get arrested near and far from a promoted NPC; far NPCs get nothing.
5. Two promoted NPCs at different distances/LOS: each memory belongs only to its own witness.
6. Switch the family to `on`, `memory.callbacks` to `shadow`: counters show `shadowWouldCallback`, nothing
   spoken. Then `on`: stop the car calmly (wanted 0, no speech from you) and wait; the NPC may mention the
   incident once. Verify no repeat for 10 minutes, a different NPC does not mention it, and your own speech
   or typing always wins.
7. Forget: tell the NPC to forget it (or use the inspector) while a callback is pending; nothing surfaces.
   Pause learned memory mid-wait; nothing surfaces. Restart the game/companion; no replay.
8. Reload a save / change world: no events or callbacks cross the boundary.
9. Capture the diagnostics rows and companion log for each step; note any family that stays `waiting`.

## Blockers and decisions for the reviewer

* The production game build deliberately does not include the M9 native sources; enabling them requires
  the explicit `LsaM9Native` build and the in-game evidence above before the W09 inventory item is updated.
* Windows CI for the native harnesses is the only place the pipe-based tests run.
* Callback ledgers are not persisted across companion restarts (see Unverified).
* No changes were made to the M7, M8 or conversation-fallback PRs.
