# Closure Agent J — M9 GTA candidates, PS2 and PS6 callback fences

**Immutable source**: PR #75 `8443a8adec9433626902b46b81bd3e58fc382fb2`.
**Agent J final source-code commit** (before this handoff update): `e145e4ae40465cd5c4df75f49bb21a5e82621400`. Subsequent documentation-only commit changes the branch head but not that tested source tree.
**Feature branch**: `feature/memory-close-j-m9-events-director-20261011`.
**PR base**: `integration/memory-completion-h-review-20261011`.
**Status**: **offline review only**. No GTA installation, actual native GTA event-source acceptance, full PS2 -> M3 durable acceptance, cloud calls, PS4 acceptance, or merge.

## Files within Agent J ownership

- `lsa-shared-brain/src/events/m9EventProducers.mjs`: the original M9 classifier now requires a synchronous independent `verifySource({snapshot,source}) === true`; unknown vehicle motion/speed/water/roll fields are `null` and cannot create edges. Certified callback damage alone yields a vehicle crash with no invented impact velocity. An explicitly callback-proven speed delta can be classed significant; a *separately source-proven* speed-before-impact of at least 90 kph may mark `high_speed_verified`, never inferred from a speed dip. Event IDs use deterministic evidence+scope hashes, with ordered/capped replay and 1,500ms continuity limits. A missing orientation sample cannot cause a later fabricated rollover edge.
- `lsa-shared-brain/src/events/m9MemoryCues.mjs`: per-promoted-NPC and event-family cooldowns are **600,000ms** (at least ten minutes), independent current `authorizeWitness` is mandatory. Cue retains player capture identity; candidate/witness proof and in-memory dedupe remain bounded. No text, PS3 grant, stock action or memory write.
- `lsa-shared-brain/src/events/m9Ps2CandidateBridge.mjs`: explicit typed `m9.ps2_qualification_request`, **not** the current closed PS2 `signal` frame; never manufactures an `Observation`, `WitnessReceipt` or SQLite event. Returned state is only `pending_ps2_witness_qualification` and never an M3 commit. The port must be independently source-verified, reject unsupported PS2 v1, preserve unknown coverage and bounded IDs.
- `lsa-essential-e1-candidate/src/perception/m9DirectorCueAdmission.mjs`: requires a genuine **existing** PS3 Director candidate and `originalGrantCurrent`, the same actor/player capture, verified M3 witness, current certified mic/typed/combat/stock/player idle, and a registered PS4 C-04 contribution. Calls **only** `existingSceneDirector.attempt` for C-06/C-11/native one-shot/stock playback authorization, with cleanup in `finally`. Never invents a PS3 entitlement or a second speech executor. `director_delivered` only means the supplied original Director driver reported `delivered`; final PS4 evidence playback receipt remains K-owned.
- `native/intelligence/m9/M9NativeFrameAdapter.cs`: pure pinned-compatible, owner-fiber bridge for source-proven player+vehicle `EntityAnchors`, DamageTracker collision receipts, optional vehicle motion, wanted-level and exact terminal callbacks. Requires five authoritative verifier/current-context ports, checks age<=3s, callback-to-snapshot tick/1.5s time attachment, and epoch/anchor lifetime. Absent or unproved APIs export `null`. It does not claim to call an undocumented GTA native.
- `native/intelligence/m9-tests/Program.cs` and `M9NativeTests.csproj`: isolated non-GTA .NET Framework test harness includes new adapter.
- `lsa-essential-e1-candidate/tests/memory-m9-completion.test.mjs`: amended existing tests and added PS2/PS6 adversarial regressions.

## Integrator K exact source API / fixture recipes

### 1. Native source
Create `new M9NativeFrameAdapter(anchors, verifyBaseRead, verifyNativeField, verifyCollisionReceipt, verifyTerminalReceipt, currentNativeRun, currentHostRun, currentWorldEpoch)` on the **game owner fiber**, from K-owned `IntelligenceIntegration.cs`. Feed `M9RawNativeRead` assembled only from specific verified original reads. `TryBuild(read, nowMs, out M9NativeFrame frame)` returns false for invalid host/epoch/player/vehicle or stale reads. Treat returned `frame.vehicle` nullable fields and `frame.wantedLevel=null` and `frame.outcome=null` as unsupported, not false. Do not supply `verifyNativeField(...)=true` unless the named real getter and its source/validity are proven in the pinned game host. `verifyTerminalReceipt` must validate a distinct source-backed Wasted/Busted callback, never death/wanted level alone. `verifyCollisionReceipt` validates **the exact** `M9NativeDamageAdapter.TryExtract` callback receipt and identity; no ambient Signal frame impersonation.

K must include this C# file plus pre-existing `M9NativeDamageAdapter.cs` in the real native project, and prove both the project builds and actual callback lifetime. Current pinned `DamageSensors.cs` provides vehicle damage `classification=collision` and `damage`, **not** velocity-before-impact, full vehicle motion, wanted/outcome native getters or PS2 witness proof.

### 2. Native -> JS event
Instantiate `new M9NativeEventProducer({now, verifySource})` where `verifySource({snapshot,source})` synchronously checks the current native authenticated channel/receipt *outside caller JSON*, adapter epoch, host run, world epoch, exact player capture and live source registration. The `M9NativeFrame` maps to `snapshot`, its `source` field maps to `source`. Retire/reset on host restart, world epoch, ped/vehicle retirement, save timeline changes and channel close. `ingest({snapshot,source})` yields only `m9_candidate`; no one has yet witnessed it. 512 dedupe IDs; no continuous physics inference after >1500ms gap.

### 3. Source candidate -> PS2 -> M3
Create `new M9Ps2CandidateBridge({verifyNativeCandidate,submitForPs2Qualification,now})`. `submit({candidate,nativeReceipt})` produces a typed immutable `m9.ps2_qualification_request` through an **explicitly new/registered** PS2 v1-compatible native producer/correlator admission seam. `submitForPs2Qualification(envelope)` must return `{status:'accepted_for_qualification',candidateEventId:envelope.candidateEventId}` only after source registration; `grantsWitness` or `memoryCommitted` may **never** be true. The current `contracts.mjs` PROD/CLOSED PS2 `validateSignal` does **not** admit M9 extras. Do **not** send the envelope as a `signal` frame or change validation to permit arbitrary fields.

K and D must design a minimal typed PS2 extension or restrict mapping to **actual** pinned `vehicle_damage`/PS2's existing `vehicle_impact` with original `signalId`; only `ShadowRuntime.acceptedObservationTap` plus D's M3 binder, owner/participant resolver, `WitnessedEventRecorder.capture` and P2 transaction/readback can yield an event. Preserve separate witness outcomes for NPC A and B. Unrelated spectators, absence of a response, missing geometry and unregistered source all remain **unknown**; never record `did_not_witness` unless D/A supplies a separate certified negative receipt. Correct association between `candidateEventId` and the durable M3 `journalRecordId` needs a K/D source-linked schema/adapter (not inserted into closed v1 event fields).

### 4. M3 -> PS6
After M3 P2 commit+readback, inject a synchronous `authorizeWitness({candidate,witness})` port that checks exact active PS2 accepted observation, same physical promoted observer, true source-channel modality, owner incarnation/encounter, host/world/timeline/protagonist/actor and unforgotten journal evidence. Provide `M9MemoryCueCandidates({authorizeWitness,now})`.

Construct `new M9DirectorCueAdmission({cueCandidates, existingSceneDirector, readCurrentPriority, registerPs4MemoryCue})`. `readCurrentPriority` must synchronously read true current source proof and return at least `{known:true,playerIdle:true,micIdle:true,typedIdle:true,combatIdle:true,stockIdle:true,interruptionFree:true,directorAvailable:true,ownerCurrent:true,timelineWritable:true}`. **Unknown combat** is a veto. `registerPs4MemoryCue({cue,candidate,witness,proposal,stamp,mode:'sole_ps4_frame'})` must source-check P2 and register in the sole PS4/C-04 frame, returning `{status:'registered',cueId:cue.cueId,unregister(){...}}`. It cannot build its own prompt; K supplies the actual existing-frame lifecycle. `attempt({candidate,witness,ps3Candidates,facts,stamp})` obtains a fresh **original** PS3 routine proposal, calls `existingSceneDirector.originalGrantCurrent`, applies all priority checks, then uses `existingSceneDirector.attempt` for native C-06/one-use claim. It returns `director_delivered` only after that stock driver reports delivered; a separate exact native audio/PS4 receipt still needed for GTA acceptance. Do not substitute M9 IDs for original PS3 observation/decision IDs; C-06 must never be relaxed.

### Fixture (source reader)
`verifyNativeField(read,'vehicle_motion')` and `verifyNativeField(read,'wanted_level')` may be separate, stubs returning false for unproven APIs. `verifyCollisionReceipt` must bind a pinned `M9CollisionEvidence`, and `verifyTerminalReceipt` must bind a distinct verified callback to the original player incarnation. A `null` status propagates as unknown. No protagonist string is produced by Agent J; Agent A's verified native authority must supply it, or the memory fact stays protagonist `unknown`.

## Offline tests / exact commands and proof boundaries

New and existing source checks requested:

```sh
node --check lsa-shared-brain/src/events/m9EventProducers.mjs
node --check lsa-shared-brain/src/events/m9MemoryCues.mjs
node --check lsa-shared-brain/src/events/m9Ps2CandidateBridge.mjs
node --check lsa-essential-e1-candidate/src/perception/m9DirectorCueAdmission.mjs
node --test lsa-essential-e1-candidate/tests/memory-m9-completion.test.mjs
node --test lsa-essential-e1-candidate/tests/memory-agent-b-events.test.mjs
dotnet run --project native/intelligence/m9-tests/M9NativeTests.csproj --configuration Release
```

**At authoring time**: commands are specified but **not personally run in a cloned repository**. Agent J's local environment lacked GitHub network cloning and a .NET installation. The PR's native and Node GitHub Actions must be read at the exact final head; pending checks are **not** passing checks. Native harness stubs are not proof of game-native API availability.

Coverage includes verified vs missing collision impact proof, high-speed vs unproven prior velocity, partial physics unknown; ordered stable IDs/replay/epoch/handle retirement; wanted/outcome callback and no inferred Wasted/Busted; positive/negative rollover, airtime/landing, water/submersion and repeated wanted changes with host restart; unrelated spectator, PS2 two-observer isolation baseline, no false coverage; refused original PS3 grant, PS4 missing, mic/typed/combat/stock priority, Director lease refusal, interrupted sound, >=600000ms cooldown and dedupe. Native fixtures test same source/mismatched epoch, missing/retired player and vehicle, optional getter unknown states and separately verified terminal callback.

## Outstanding gates (K/authorized operator)

1. Current native `IntelligenceIntegration.cs` does not yet register M9 producer or prove actual vehicle motion, wanted, Wasted/Busted callbacks; only pinned DamageTracker collision source has identified implementation. **Do not use generic death signal to infer Wasted** or a wanted edge to infer Busted; unavailable is unknown.
2. Current closed PS2 wire is **not** expanded for every M9 event. Need K-owned native signal versioning and correlation with source-certified witness/negative coverage, plus D/A ownership checks; never bypass PS2.
3. K must connect source-qualified M3 committed journal and readback to M9 cue witness shape, M4 PS4 strict frame, and existing Director original-turn entitlement. Memory cue text cannot appear until actual PS4 budget/source admission is implemented.
4. Need exact final-head Node and Windows .NET CI, pinned native build, actual GTA in-game evidence and separate S10 playback/play-priority receipts. No physical GTA test, install, paid Luna call or merge performed.
