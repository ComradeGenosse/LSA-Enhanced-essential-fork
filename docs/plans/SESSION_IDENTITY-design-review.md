# SESSION_IDENTITY — source-grounded design review and implementation plan

Research date: October 1, 2026. Repository inspected: `ComradeGenosse/LSA-Enhanced-essential-fork`, default branch `main`, commit `c035550e39ffd4d218844ca63286088b2460dc2e`. This is a research deliverable, not an implemented feature.

**Recommendation:** retain the proposed separation between character identity and native addressing. Implement v1 for explicitly registered, owner-authenticated characters only. Keep ambient NPCs on the current session history and E2 voice assignment. Essential already provides runtime continuity, but the inspected public APIs do not establish a permanent character key.

The investigation changes four details of the initial proposal:

1. `pedId` is the string form of a **RAGE pool handle**, which includes a reuse counter in the documented RAGE representation. A reused pool slot normally receives a different complete handle. This is useful entity-lifetime evidence, not durable identity.
2. Essential has **`PedContinuityMemoryService`**. Reuse its recent activity/vehicle context; do not build an equivalent service. Its dictionary is handle-keyed and does not solve durable identity.
3. **`IIntegration` is an enrichment/control seam, not a complete entity/session lifecycle API.** It supplies neither `sessionNonce` nor a public spawn/despawn/save-load event. Binding needs a companion-side join to the existing Essential session plus explicit source-owner lifetime evidence.
4. Voice migration needs an explicit assignment boundary. `OpenAIConnection` currently caches its first profile for its entire session; changing the resolver alone will not update a later-resolved character.

## 1. Evidence and limits

Labels used below:

- **Fact:** directly established by repository source, extracted CLR metadata/IL operands, or identified primary documentation.
- **Conclusion:** a design consequence of those facts and the project's safety constraints.
- **Experiment:** behavior requiring the installed GTA/RAGE/third-party runtime.
- **Future:** optional scope beyond v1.

The pinned DLL, stock server and existing metadata hashes were verified:

| Input | SHA-256 |
| --- | --- |
| `upstream/LosSantosAlive.dll` | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| `upstream/server.bundle.mjs` | `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` |
| `docs/native-metadata.json` | `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23` |

The audit used `System.Reflection.Metadata`/`PEReader` without loading or executing the game assembly, and Acorn AST slices of the pinned server. [The evidence file](../research/SESSION_IDENTITY-evidence.json) records signatures, selected IL offsets/tokens, stock function names and exact source offsets. Original binaries and contract pins were not changed.

The main DLL is obfuscated. Public signatures and simple handle wrappers are strong evidence; arbitrary hidden control flow, encrypted strings and provider persistence algorithms are not fully established. `RagePluginHook.dll`, `LosSantosAlive.PRBridge.dll`, `LosSantosAlive.Interop.dll`, and the actual PR/LSPDFR/Nexus database are not pinned binaries in this checkout. The extension analysis includes bridge metadata, but it does not provide a demonstrably stable police-person key or a persistence contract. Absence of a readable `CharacterId` is not proof that every obfuscated internal implementation lacks identity-related data.

### Source index

All repository links below are pinned to the inspected commit.

| Ref | Source and purpose |
| --- | --- |
| R1 | [Hotfix #3 extension/native analysis](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/docs/plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md): §§2, 4, 6–8, 10, 12, 14, 16, 20 and appendices |
| R2 | [Pinned stock server](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/upstream/server.bundle.mjs): functions identified in the evidence file; bundle lines are long |
| R3 | [Build hooks](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/tools/buildCandidate.mjs#L68): current identity checks, session binding, context refresh and PCM/action guards |
| R4 | [OpenAIConnection](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/openai/openaiConnection.mjs#L43): frozen session identity, generation snapshots, cached voice, close/abort |
| R5 | [OpenAITransport](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/openai/openaiTransport.mjs): connection attachment and rejected Gemini resume handles |
| R6 | [Runtime glue](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs#L42): detach clears exactly one runtime history |
| R7 | [DialogueHistory](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/memory/dialogueHistory.mjs): bounded session history, exact staged assistant commit |
| R8 | [Voice profile](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/voice/voiceProfile.mjs) and [resolver](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/voice/voiceResolver.mjs): E2 session hashing and provider validation |
| R9 | [Request builder](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/context/essentialDecision.mjs#L59): serialized actor/listener context, bounded history, strict output schema |
| R10 | [Native delivery](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/integration/nativeDelivery.mjs) and [turn runner](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs): native completion, cancellation and E6 |
| R11 | [Native contract](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/docs/native-contract.md) and [metadata](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/docs/native-metadata.json) |
| R12 | [Stock harness](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/tests/stock-harness.mjs), [stock lifecycle tests](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/tests/stock-lifecycle.test.mjs), [stock controller tests](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/tests/stock-controller-lifecycle.test.mjs), [voice tests](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/lsa-essential-e1-candidate/tests/voice-profile.test.mjs) |
| R13 | [Roadmap](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/docs/ROADMAP.md) and [E5/E6 status](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/c035550e39ffd4d218844ca63286088b2460dc2e/docs/E5-E6-implementation-status.md): physical GTA acceptance remains open |
| N1 | [Fresh static audit evidence](../research/SESSION_IDENTITY-evidence.json): additional main-DLL surfaces and selected IL |
| G1 | [RAGE PoolHandle documentation](https://docs.ragepluginhook.net/html/T_Rage_PoolHandle.htm): slot, counter and validation model; documentation targets older RPH |
| G2 | [RAGE IsPersistent](https://docs.ragepluginhook.net/html/P_Rage_Entity_IsPersistent.htm): protection from automatic cleanup |

## 2. What `pedId` actually represents

**Fact — production.** `ActorContextProvider.Populate(ActorContext, Rage.Ped)` calls `Rage.Entity.get_Handle`, invokes `ToString()` on `Rage.PoolHandle`, and assigns `ActorContext.PedId`. The relevant method token is `0x060012b8`; IL offsets 231, 245 and 250 show that chain. `DirectedInteractionManager.GetPedId(Ped)` independently validates the ped, obtains its handle through a simple wrapper, and returns its string representation. Tokens `0x060001e1` and `0x06000204` expose this chain. `NpcStateStore` also derives a string key from the handle. [N1]

Consequently, Essential does not mint a character UUID when it emits `pedId`. Do not substitute a pool slot index, model hash, memory address, object reference, or converted decimal string. Keep the exact Essential string for native traffic. Stock action helper `m4`/`jt` expects hexadecimal-looking handle strings; the direct `PoolHandle.ToString` documentation leaves formatting unspecified. Exact casing/padding on the installed Enhanced RPH should be recorded in a probe, not assumed. [R2; N1; [ToString documentation](https://docs.ragepluginhook.net/html/M_Rage_PoolHandle_ToString.htm)]

**Fact — documented reuse protection.** RAGE's documented handle is a 32-bit value containing a 24-bit pool index and an 8-bit counter. Occupancy and counter comparison validate it; the counter distinguishes immediate reuse of the same slot. Therefore “the same slot” and “the same complete `pedId`” are different observations. [G1]

**Conclusion.** The full handle is a useful runtime incarnation discriminator while valid. Its finite counter cannot establish unlimited uniqueness, and it carries no character-level save/recreation contract. Preserve it intact. Do not claim that a particular number of spawn cycles guarantees counter wrap on the installed build; allocator/counter behavior needs measurement. The checked-in native analysis explicitly warns about recycled handles. [R1 §20; G1]

**Fact — session lifetime.** In the stock Essential server, `zP(pedId)` increments `A.sessionNoncesByPedId`; `WP` uses it when opening a session, and `Ei` increments it on close. `Zi` can reuse a ready connection and nonce. `hy.allocateGenerationId` increments a separate per-ped generation counter. These maps live in the server process. The native turn ID/generation machinery is part of Essential's stock server; `sessionNonce` is not a persistent GTA character attribute. [R2: `WP`, `Zi`, `Ei`, `zP`, `hy`]

**Fact — native wire boundary.** Public C# playback events expose `PedId`, `TurnId`, `GenerationId` and completion fields, with no public `sessionNonce`. `by`/`xP` validates the native triple; the companion bridge attaches and checks the nonce from the bound Essential turn/session metadata. The current four-part safety identity is therefore maintained across the bridge even though the native DTO itself carries a triple. [R3 lines 68–74; R11; N1]

**Conclusion.** The four-part identity remains authoritative for active companion work. A process/run epoch is needed for persisted provenance or identity-adapter messages because session and generation numbers can start over after restart. This epoch must not alter Essential's native protocol or create a competing turn allocator.

## 3. Native identity candidates, by actor category

| Category | Established identifiers/evidence | Safe v1 treatment | Missing proof |
| --- | --- | --- | --- |
| Story/named characters | `PedModel`, archetype/description, native handle. No readable Essential story-character identifier in the inspected actor/state API. Server `personaName` defaults from archetype; it is not a character registry key. | Ephemeral unless an owning story/mission integration explicitly supplies and validates a canonical person key. | How an installed story integration distinguishes the actual character from a spawned duplicate of that model. |
| Scene-created NPCs | Hostage `SetupId`, `InteriorId`, `SceneStartGameTime`, `NegotiatorPed`; spawned units contain vehicle/driver/ped references. Generated callouts have participant `pedKey` and integer indices. | Owner-issued character UUID, or an owner-issued scene-instance UUID plus participant key for a character confined to that scene. | A persistent scene-instance identifier, participant-to-live-ped registration and any saved rehydration mapping. |
| Directed interactions | Interaction ID, speaker/target `Rage.Ped`, `ActiveInteractionId`, ready/ended events, partner lookup; protocol also has `conversationId`. | Use IDs to correlate an exchange and its participants. Resolve each person's identity independently. | No evidence an interaction/conversation ID survives repeated exchanges or denotes one person. |
| LSPDFR / PR actors | Role, duty/outfit context; PR record/state JSON queried by handle; normalized personal fields include names, birthday, gender, model age, address and document/record data. PR callout bridge accepts `calloutId`. | Context only. Persist only after a provider adapter proves an immutable database/person key and lifetime/scope. | Actual PR/Nexus unique key schema, uniqueness, regeneration, save/restart stability and cache association. |
| Activity/location NPCs | Location/activity names, positions, point occupancy handle; runtime activity queue/state. | Ephemeral, except an owner-authored NPC with its own character key. | No exposed person identity attached to a point, activity, location or occupancy slot. |
| Ordinary ambient peds | Full handle, model, gender, age range, archetype, role, location/activity and nearby references. | Existing `pedId + sessionNonce` assignment; no disk character record and no automatic merge. | No strong cross-despawn identifier demonstrated. |

Sources: [R1 §§4, 6–7, 12, 14, 16 and appendices; N1; R2: `ia`, `eo`, `hO`, `mJ`, `EJ`, `TJ`, `$J`, `SJ`].

Two distinctions matter:

- **A named model is an asset identifier.** Even if a story integration can confidently resolve a character, model matching alone does not establish that a second ped using the same asset is that character. Model variants can also portray the same person. Automatic model-to-story-character mapping is excluded from v1.
- **Scene templates and participant keys are not globally unique.** `mJ`/`FJ` repairs participant uniqueness inside one generated callout. Repeating `pedKey = suspect` or a hostage `SetupId` in a later incident must not reuse the earlier character. A callout ID can namespace an incident if its producer guarantees uniqueness; it still needs a participant key and a live ownership association. [R2; R1 §14, Appendix C]

`IsPersistent`, mission ownership, entity/network identifiers, relationship groups, decorators and attached metadata are not established durable character keys in this repository. In particular, RAGE's `IsPersistent` protects an entity from automatic world cleanup; it is not a promise to serialize a character across game restarts. V1 must not toggle it to manufacture identity. [G2]

**Experiment.** PR/Nexus might expose a useful person/database GUID inside raw JSON. The normalizer preserves unknown fields using object spread, so that possibility remains open. However, `firstName + lastName + birthday`, document values without a uniqueness contract, and a cached JSON record are insufficient. Inspect synthetic/test records through the public bridge, identify the generating provider and documented scope, then recreate/reload the actor. Do not assign persistence merely because a JSON field is named `id` or `guid`. [R2: `hO`; R1 §16]

## 4. Continuity and resume: useful existing mechanisms, different purpose

**Fact — native continuity memory.** `LosSantosAlive.NPC.Memory.PedContinuityMemoryService` exposes `Update(PerceptionSnapshot)` and `TryGetMemory(Ped, out PedContinuityMemory)`. Its memory fields are `PedHandle`, `RecentVehicle`, `InteractionActivity`, and `LastUpdatedGameTime`. Activity includes position/heading/time; vehicle memory includes handle/seat/time. The extracted lookup uses `ped.Handle.ToString()` against `Dictionary<string, PedContinuityMemory>`. A private cleanup path subtracts `LastUpdatedGameTime` from game time, compares against `120000`, and removes entries. This is runtime context retention, not a permanent character database. [R1 Appendix A, lines 3628–3663; N1]

**Conclusion.** Consume this context through Essential's existing providers where needed. Do not duplicate recent-vehicle or activity tracking in SESSION_IDENTITY, and do not use this memory's presence as proof that a future recreated ped is the same person. The exact cleanup cadence and behavior across world transitions remain experiments.

**Fact — server actor continuity.** `Pv`/`Ed` creates handle-keyed `A.actorSessionStates` entries containing actor data, voice name, resume handle and activity timestamps; `Pv` also initializes last context/interaction fields. `Ei` clears the active session and session metadata but does not delete the actor continuity entry. No `actorSessionStates.delete/clear` was found in the pinned source. `qK` refreshes the actor snapshot when a ready session is reused. [R2]

**Fact — provider resume.** `dd` passes a resume handle to Gemini Live's session resumption configuration. `NK`/`FK` receives and retains the provider's new resume handle. `HP` can discard it when replacing a session. The companion build forces the OpenAI resume value to `null`, and `OpenAITransport.connect` rejects a nonempty Gemini resume handle. [R2; R3 lines 85–86; R5]

**Conclusion.** These mechanisms preserve context/provider lineage for a runtime handle. A provider resume token identifies a provider session, not a GTA character. They cannot serve as durable aliases. The handle-keyed stock actor cache is also a reason to ensure a new identity claim is not inferred from a stale cached actor snapshot.

**Challenge to the brief.** The architecture is supported, but “Essential continuity/context identity abstractions” in the old analysis should not be read as an already proven stable character-ID service. The directly inspected continuity service is handle-keyed. There is no established better native mechanism that eliminates the separate durable layer.

## 5. Smallest safe v1 and ownership

V1 delivers:

1. One explicit identity source: an authored/test character owner that registers its canonical source key with the actual live ped and revokes it on release/recreation.
2. A bounded, trusted evidence block added through `IIntegration.EnrichActor`.
3. A companion binding from that evidence to Essential's existing `pedId + sessionNonce`.
4. A small durable registry of canonical aliases and voice choices.
5. Fail-closed persistent resolution, exact unbinding, diagnostic outcomes and tests.

Every unsupported actor remains ephemeral. No fuzzy matching, police-name matching, automatic story-model matching, cross-session ambient recognition, memory generation, personality system, goal system, custom actions or additional NPC behavior loop belongs in v1. Metadata-only rollout should precede character-owned speech.

The design includes an **entity incarnation token inside the binding evidence**. This is a freshness discriminator, not a fourth identity authority:

```text
Durable registry                         Essential
worldProfile + source alias             Rage.Ped / NpcState
             ↕                                  ↕
         characterId                    handle-derived pedId
             ↘                                  ↙
       Companion binding: pedId + sessionNonce
       evidence: adapterEpoch + incarnationId + claimRevision
                         ↓
       Essential turn: pedId + turnId + generationId + sessionNonce
                         ↓
       existing native action / PCM / interrupt / completion paths
```

| Owner | Responsibilities |
| --- | --- |
| Essential | Entity validity/control, runtime modes, turn/generation/session allocation, native addressing, action validation/dispatch, playback and interruption. |
| Character/scene/provider owner | Assert which person its current ped represents; define source-key scope; register each spawn incarnation and explicitly retire it. |
| Small C# integration adapter | Validate owner registrations on the game fiber; expose evidence and revocation information; use public context/state APIs. It does not run NPC behavior. |
| JS companion identity service | Join trusted evidence to an existing native session, enforce conflict/freshness rules, snapshot identity for a turn, own registry/voice persistence. |
| Future memory consumer | Use a validated character snapshot and accepted delivery events; never allocate native work or resolve people itself. |

Do not write new fields into `NpcState`, monkey-patch its collections, change runtime modes to obtain identity, or introduce a second state machine. Use `NpcStateStore.TryGetState`/`GetAllStatesSnapshot` for observation where needed; `GetState` can create state, and the audited getters can update the stored `Ped` reference. A `NpcState` object reference is not a durable or independent incarnation proof. [R1 §4; N1]

### Proposed modules and types

Names below are proposals, not existing repository APIs.

| Module/class | Responsibility and minimal contract |
| --- | --- |
| `SessionIdentityIntegration : IIntegration` (new small addon project) | Register early/idempotently; enrich actors from explicit evidence; bounded update/shutdown cleanup. |
| `ExplicitCharacterSource` / `ICharacterIdentitySource` | `Register(ped, sourceKey, worldProfileId)` and `Retire(registrationToken)`; `TryResolveCurrent(ped)` only for owner-verified registrations. Initially one implementation. |
| `NativeIdentityEvidenceStore` (C#) | Small map of active explicit registrations, live ped reference/full handle, fresh `incarnationId`, adapter epoch and revision. No ambient world database. |
| `src/identity/identityContract.mjs` | Strict schema/version/length validation; typed separation of source claims, runtime bindings, durable IDs and turn snapshots. |
| `src/identity/identityResolver.mjs` | Deterministic explicit resolution; returns `persistent`, `ephemeral` or `conflict` plus a reason. No confidence threshold algorithm. |
| `src/identity/runtimeBindings.mjs` | Exact session-key entries and reverse active-character uniqueness; compare-and-delete with binding revision. |
| `src/identity/characterRegistry.mjs` | Canonical alias-to-ID mapping, create-once records and stored voice assignments. |
| `src/identity/characterStore.mjs` | One versioned local file, serialized writes, validation and atomic replacement/recovery. |
| Existing `VoiceResolver` | Select existing session assignment or a stored persistent character profile from an immutable identity snapshot. |

Build the game addon for the installed RPH-compatible CLR/.NET target, referencing the pinned Essential assembly. The .NET 10 utility used for this research is an offline metadata tool, not the proposed game's addon target. Extend optional identity-feature contract validation to the exact `IIntegration`, `IntegrationJsonBlock`, context, state and event signatures it consumes. Missing optional identity support disables persistence; missing existing mandatory native playback/action support still fails closed as today. Do not relax or refresh existing E1 pins to make an addon load.

Minimal structures:

```typescript
type RuntimeSessionKey = { pedId: string; sessionNonce: number };
type SourceAlias = {
  worldProfileId: string; sourceNamespace: string; sourceKey: string;
};
type NativeIdentityClaim = SourceAlias & {
  schemaVersion: 1; sourceContractVersion: 1;
  adapterEpoch: string; incarnationId: string; claimRevision: number;
  observedGameTime: number; observationSequence: number;
};
type CharacterResolution = {
  kind: 'persistent' | 'ephemeral' | 'conflict';
  characterId: string | null; reason: string;
};
type RuntimeBinding = RuntimeSessionKey & {
  serverRunId: string; bindingId: string; bindingRevision: number;
  characterId: string; alias: SourceAlias; claim: NativeIdentityClaim;
};
type TurnCharacterSnapshot = {
  nativeIdentity: {
    pedId: string; turnId: string; generationId: number; sessionNonce: number;
  };
  resolution: CharacterResolution;
  bindingId: string | null; bindingRevision: number | null;
  characterRecordRevision: number | null;
};
```

Use tuples/nested maps or length-delimited key encoding. Preserve full handle text for native traffic. Avoid concatenating arbitrary provider keys with punctuation and treating the result as an unambiguous alias. IDs should be opaque generated UUIDs; labels and display names are mutable attributes.

Ephemeral resolution has no durable `characterId`. If UI needs an ephemeral identifier, use a distinct `ephemeral:` namespace scoped to `serverRunId + pedId + sessionNonce`, keep it in RAM and prevent the durable store from accepting it. This preserves current ambient behavior exactly.

## 6. Resolution hierarchy and conflicts

Resolve evidence in this order:

1. **Existing exact session binding**, only if freshly validated source evidence still describes the same source alias/incarnation. A map hit alone is not validation.
2. **Registered authored identity** with a trusted source namespace, configured world scope and current owner registration.
3. **Verified provider identity adapter**, only after its unique-key/lifetime contract passes the controlled experiments. This is future activation of the same interface, not v1 automatic matching.
4. **Owner-issued scene-instance + participant identity**, only for a producer that registers live participants. A scene without a persisted roster cannot promise cross-restart continuity.
5. **Ephemeral session fallback.** No evidence or inadequate evidence means no persistence.

This ordering selects a source contract; it does not permit one strong but conflicting identity assertion to silently overwrite another. If two trusted sources disagree, a canonical alias maps to two character IDs, one live character is asserted for two peds, or an incarnation changes inside a reused session: report `conflict`, reject the persistent association, and resolve the conflict at a new clean session boundary. Do not auto-merge records, steal a live binding, or repair aliases using similarity.

World scope is explicit. Default to a configured local `worldProfileId` per campaign/save timeline. Reuse it across intended restarts; use a different one for an independent campaign. Essential exposes no proven save-slot identifier here, so the adapter must not claim automatic save scoping. Source namespace and source contract version establish whether a key denotes a person, a roster slot or an incident participant.

## 7. Binding/unbinding lifecycle and available hooks

### What the hooks actually guarantee

| Hook | Useful guarantee | Identity limitation |
| --- | --- | --- |
| `IIntegration.Initialize/Shutdown` | Adapter process lifecycle. | Not a game save/load or individual ped lifecycle notification. |
| `IIntegration.Update` | Opportunity for bounded registration validation. | Polling is not proof of every despawn/reuse transition. |
| `EnrichActor(ped, context)` | Actual ped/context at a context-build opportunity; owner evidence can be checked. | No session nonce; frequency/order/freshness need integration testing. |
| `OnPedControlChanged(ped, bool)` | LSA control transfer. | Released control does not necessarily mean despawn or conversation close; retained control does not mean a provider session exists. |
| Directed ready/ended events | Exchange/participant correlation. | Ending an exchange does not end the character's entity or all sessions. |
| Public playback started/ended | Exact speech lifecycle and delivery fields. | Finishing speech does not unbind the session/character. |
| `NpcPlaybackCoordinator.ResetForTransportDisconnect` | Public native playback-reset operation for a disconnected transport. | An operation, not an entity-deletion event; identity code must not invoke it to manage character bindings. |
| Essential `WP`/`Zi` + companion `attach` | Existing session establishment and immutable `pedId/nonce`. | A session key alone has no durable evidence. |
| `Xn` → `OpenAIConnection.beginTurn` | Native generation already allocated/bound; immutable per-turn identity is available. | Must join to separately validated actor evidence. |
| `OpenAIConnection.close` → runtime `detach` | Exact companion session retirement and current history cleanup. | Does not itself destroy a ped or a durable character. |

Facts: [R1; R2; R3; R4; R5; R6; N1]. The inspected readable public events contain playback, directed interaction and approach completion events, not a general entity-spawn/despawn/save-loaded event.

### Bind sequence

1. The explicit owner registers a real ped and canonical source alias on the game fiber. Mint a fresh incarnation token for each spawn/recreation. A full-handle equality check is necessary, but the owner's current registration contract supplies the stronger association.
2. `EnrichActor` validates this registration and emits a bounded claim. No disk access, network record lookup or provider inference occurs inside this callback.
3. Essential supplies its normal actor hydration/context and creates/reuses its session. Preserve its nonce; the identity addon never allocates one.
4. On the companion's first generation preparation, after native `beginTurn` validation and before any provider/speech work, verify that the actor's `pedId` agrees, source namespace is trusted, scope is configured, and evidence is fresh/current. Require `host.isCurrent(nativeIdentity)` before publishing a binding. Freeze the character snapshot and speech profile for that generation.
5. Resolve/create the canonical registry record under serialized alias handling; check the reverse live-binding constraint; install a session binding with a fresh binding ID/revision. Bound identity preparation and recheck native currency after any await; it must not reset/enlarge the existing provider-work deadline. If storage or evidence is unavailable, stay ephemeral for that session.
6. Subsequent turns validate the same alias/incarnation at their preparation boundary. Reuse the character association and stored voice. Preserve existing turn allocation, provider retry rules and native checks.

**Freshness is an implementation gate, not an assumed property of `IntegrationBlocks`.** A cached block with matching `pedId` is insufficient. First test the existing typed/PTT/special-event hydration paths for freshness and correlation. Where an actor snapshot is not refreshed, use Essential's existing actor hydration request/response path before accepting persistent evidence, with bounded timeout and request correlation. Do not silently reuse stale `A.actorSessionStates` evidence. Exact source-owner registration must be rechecked by the game adapter when the actor is hydrated. [R1 §7; R2: `ib`, `qK`, `Ed`; R3 line 118]

Between hydration and native publication an entity can still disappear. Fresh context reduces that window; it does not atomically authorize game effects. Native validity/playback authorization remains Essential's job. For identity record mutations, capture the incarnation/revision and reject retired evidence.

### Unbind sequence

- **Session closes/replaces:** at existing `detach`, delete only the matching session/binding ID. Clear existing session dialogue history exactly as today. Durable record/voice remains.
- **Explicit owner retires/deletes/recreates the entity:** revoke its incarnation and notify the companion using a small correlated identity-control message. Match adapter epoch + incarnation + claim revision; never clear a binding using ped ID alone. A revised identity block is useful on next hydration, but cannot deliver immediate revocation when no hydration occurs.
- **Death/invalid ped:** bounded game-fiber checks on the small explicit registration set can revoke evidence. Do not infer durable character deletion from a dead runtime entity.
- **Integration/transport shutdown:** clear runtime bindings and invalidate the adapter epoch. If the GTA bridge loses authoritative contact, treat associated claims as unavailable even if a provider connection remains open; do not wait for that connection's next context refresh to establish persistence. A fresh server run also starts with an empty binding map. Old messages cannot restore it. Let Essential perform its existing native playback reset.
- **Control transfer or interaction/playback end:** observe/revalidate as appropriate; do not automatically unbind based on these events alone.

**Transport qualification:** public `IIntegration` has no callback to deliver `sessionNonce` to the addon and no immediate identity-revocation event to JS. A complete v1 therefore needs either the explicit owner's already available message channel or one small bounded addon-to-companion channel for identity assertions/revocations. Define this separately from native action/audio traffic, with version/epoch/revision fields. If no public transport route can carry it, a dedicated local IPC adapter is a narrow acceptable implementation choice; do not patch obfuscated lifecycle internals. This channel carries facts only and never invokes gameplay. It is not an existing Hotfix #3 API promise.

On a known incarnation mismatch, stop identity-dependent provider work for the affected exact turn using the existing abort/fail path and retire its provider session through the existing Essential session manager. Let Essential perform native cleanup. Open a new ordinary session if the entity is still eligible. Never reuse a connection's bounded history for a different known incarnation or character, and never invent a new `sessionNonce` in the identity service.

Late detach/revoke events must compare-and-delete their original binding. An event for old nonce 4 must not remove nonce 6, even if both resolved to the same persistent character. Likewise, a new character binding cannot validate an old turn solely because its `characterId` is equal.

## 8. Persistent versus runtime storage

For the bounded first version, use one versioned JSON registry owned by the companion. Load and validate it once before sessions; keep the registry in memory; serialize writes on one queue. Use a temporary file and a tested Windows-safe atomic replacement/backup procedure. Do not use append-only dialogue logs as the identity database. SQLite becomes justified later for memory volume/concurrent transactions, not for a few explicit characters.

```json
{
  "schemaVersion": 1,
  "worldProfileId": "<configured campaign UUID>",
  "registryRevision": 1,
  "characters": [
    {
      "characterId": "<generated UUID>",
      "recordRevision": 1,
      "createdAtUtc": "<timestamp>",
      "status": "active",
      "voiceAssignment": {
        "assignmentVersion": 2,
        "profileId": "<character voice profile ID>",
        "provider": "openai",
        "voice": "<selected supported voice>",
        "poolVersion": "<configuration fingerprint>"
      }
    }
  ],
  "aliases": [
    {
      "sourceNamespace": "comrade.authored",
      "sourceKey": "companion.alex",
      "sourceContractVersion": 1,
      "characterId": "<same UUID>"
    }
  ]
}
```

Enforce one alias tuple per character association, referential integrity, bounded key lengths/record counts, supported schema versions and unique IDs. The file's world profile participates in every alias key. Treat duplicate/conflicting aliases or unknown schema as unavailable persistence; preserve the file for repair. Serialize concurrent resolve-or-create so two first encounters cannot allocate two characters for one alias.

**Persist:** source aliases, opaque character IDs, source contract version, registry/record revisions, voice assignment, minimal timestamps and administrative status. A source key whose producer recycles roster slots must include a producer generation/person UUID; registry hashing cannot make that key durable.

**RAM only:** `pedId`, `sessionNonce`, active turn IDs/generations, `Rage.Ped` references, binding IDs/revisions, source incarnation/adapter epoch, live claim revision, provider connection, bounded dialogue history and pending completion. Never reload a saved runtime binding at startup.

**No automatic migration from existing handles.** There is no persisted character database to convert. Create a record only on a new accepted strong claim. Do not backfill the stock actor cache or telemetry into character memory. Store failures preserve current session behavior; they must not delay E6 PCM or native completion indefinitely. New durable voice assignments become usable only after their registry write succeeds.

V1 is not a GTA save serializer. Saving the game's world does not atomically save the companion registry. Cross-save rollback policy remains explicit: share identity/voice across that configured campaign, or select another `worldProfileId`. Historical-memory timeline rollback will need a later design.

## 9. Voice migration

**Fact.** E2 hashes length-delimited `pedId` plus positive `sessionNonce` under `lsa-session-voice\0v1\0`. It ignores `turnId`/generation, selects from the configured pool, and returns an immutable profile. `OpenAIConnection.beginTurn` resolves it only while `#voiceProfile` is null; `refreshContext` does not clear that profile. Provider work receives the cached profile in the launch snapshot. [R8; R4 lines 55–74, 162–170, 228]

**Conclusion.** Keep the existing session algorithm byte-for-byte for ephemeral characters. Add a distinct persistent assignment policy/version; never mutate `identity.pedId` to force character-based hashing.

Persistent assignment:

1. At the first safe character resolution, choose a supported voice using a separately domain-separated character seed (`worldProfileId + characterId + assignmentVersion`) or an explicit trusted owner configuration.
2. Persist the actual chosen voice and assignment version. Hashing a character each time into the current ordered voice pool is not enough: reordering/removing voices could change it.
3. Build a frozen provider profile from that stored choice and validated speech configuration. Keep model/speed/acting policy under existing provider/config validation; stable voice ownership does not justify freezing an obsolete provider model forever.
4. Use one immutable profile for every segment/retry of a native generation. An async registry result cannot change speech already started.

**Smallest migration boundary:** lock the assignment policy at the first generation of a session. If its claim is accepted and durable storage is ready, use the character profile. Otherwise retain E2 session assignment for that session. A later strong claim can create its record, but character voice adoption waits for the next clean session. Known evidence conflicts/incarnation changes retire the session through existing lifecycle paths. This avoids switching voices halfway through a response and keeps the current connection cache useful.

No cross-session voice copying from an arbitrary ambient ped. In a deliberate authored-character rollout, an owner may seed the first durable voice before opening the next session; that is an explicit association. V1 does not migrate stock Gemini voice ownership; its resume/voice machinery remains separate. [R2: `GK`; R3; R5]

Unsupported stored voice/model combinations need a visible configuration outcome. Never silently overwrite the canonical stored voice because a temporary provider model/pool cannot use it. The current session may use a clearly reported compatible session fallback according to configuration, or fail speech configuration normally; future explicit reassignment can update the record. Do not introduce automatic provider fallback.

## 10. Context enrichment and trust

**Fact.** The direct DLL audit confirms `ActorContextProvider.Populate` calls `IntegrationManager.EnrichActor`, and the serializer reads each `IntegrationJsonBlock.Id/Json`. The stock server converts these into actor `integrations`; `lO` preserves unknown integration namespaces, and `eo` also carries `integrations`. The OpenAI request serializes the complete actor/listener JSON into its current context. [N1; R2: `lO`, `ia`, `eo`; R9]

**Conclusion.** `IIntegration.EnrichActor` + `IntegrationBlocks` is the correct public route. Use one reserved integration ID, for example `sessionIdentity`, and strict structured fields. Do not overload `PedId`, `Label`, archetype, role, persona fields or PR's `identity` block.

The game block should expose a **source claim**, because the game addon does not know the server-owned nonce or canonical registry result. The companion validates the claim, resolves it, and adds a bounded derived character summary to its immutable model-context snapshot. If the game addon needs the resolved ID, an acknowledged identity message can return it later without changing native state.

Example wire claim:

```json
{
  "schemaVersion": 1,
  "sourceContractVersion": 1,
  "sourceNamespace": "comrade.authored",
  "sourceKey": "companion.alex",
  "worldProfileId": "<campaign UUID>",
  "adapterEpoch": "<addon-load UUID>",
  "incarnationId": "<new UUID per spawn>",
  "claimRevision": 1,
  "observationSequence": 1,
  "observedGameTime": 123456
}
```

The resolved prompt summary can be limited to classification, an opaque character reference, source category and future relevant continuity facts. Strip transport epochs/revisions from model-facing context unless they have a product purpose. Prompt text and model output cannot claim, modify or merge identity. Keep the existing strict decision schema unchanged: there is no output `characterId` address or identity-changing action.

Trust is based on the registered source contract and current owner evidence, not the block's namespace string alone. Reject unknown source namespaces, duplicated conflicting blocks, malformed JSON, oversized strings and stale incarnations. Build-time/test fixtures that forge actor JSON are not evidence that a game source is trusted. An addon producer may be trusted while an old cached claim is still stale.

Stock `EO`/`Ev` can copy some integration fields onto existing actor fields. Use claim-specific field names and keep enrichment namespaced; do not place native-addressing/role fields inside the claim. Add round-trip tests to ensure a custom block cannot overwrite action capabilities or ped/session identity. [R2]

## 11. Persistent memory's eventual consumption contract

The existing `DialogueHistory` remains bounded and session-keyed. Accepted player input commits once; assistant reply stays staged until exact successful native completion with audio, playback-started and no interruption. Session detach clears it. Durable character identity must not change any of those rules. [R7; R10]

**Future seam, not v1 memory implementation:** a read-only `CharacterMemoryView(characterId, worldProfileId, budget)` may add a small separately identified memory context block at turn preparation. Do not load long-term memories into `DialogueHistory.messages`, replay them as fresh user utterances, or share one active transcript between two sessions of the same character.

Future memory writes consume immutable events containing `serverRunId`, the original four-part native identity, captured character ID and binding/incarnation revision. Verify their captured association instead of looking up “who owns this ped now.” Use an idempotency key including run ID and exact turn identity. Distinguish accepted player statements from successfully delivered assistant speech; provider completion is not delivery. Interrupted/rejected/stale assistant output must not become a remembered promise, command execution or completed conversation.

If binding validity was lost before a prospective memory event was accepted, conservatively omit that character memory event. A turn already accepted while its binding was valid can be queued for storage using its captured ID/revision; later rebinding cannot redirect it. Which social/world facts deserve durable memory belongs to a later phase.

## 12. Lifecycle outcomes and uncertainty

| Transition | Established evidence / uncertainty | Required identity behavior |
| --- | --- | --- |
| Next turn, same ready session | Essential normally reuses session nonce; generation changes. | Same validated character and voice; new immutable turn snapshot. |
| Provider session replacement | `Ei`/`WP` invalidates/reallocates nonce; stock actor cache can survive. | Old exact binding removed; fresh bind from current source claim; fresh bounded history; durable voice retained. |
| Despawn/delete | Handle no longer denotes that entity; no public general destruction event established. | Owner retirement + bounded validity checks; revoke incarnation; never preserve live binding from disk or a cached block. |
| Death | DLL validity helpers check existence/death; timing/cleanup requires GTA test. | Revoke runtime eligibility/binding conservatively; keep durable character record. Mortality/resurrection is owner policy. |
| Model change on same entity | No stable character inference follows from model alone. | Revalidate explicit ownership. A changed model is a diagnostic/invalidation signal, not a merge rule. |
| Delete/recreate same character with a new model/handle | Only owning source can prove continuity. | Same alias/character ID, fresh incarnation and native session; retained voice. |
| Repeated scene/template/callout | Template/key reuse is demonstrated; runtime person continuity is not. | New incident scope/person unless explicit saved roster proves continuation. |
| Save/load or player/world reset | No proven save/world-reset identity hook. Game-time discontinuity may help detection but is not a complete signal. | Clear/retire runtime evidence on known transition; conservative new adapter epoch/owner registrations. No save/load support claim until tested. |
| Game/server/plugin restart | Runtime maps/objects cannot be durable. Adapter/server restarts may occur independently. | Empty bindings, new runtime epochs; load aliases/voices only; require fresh source proof. |
| Pool slot reuse | Documented counter normally distinguishes immediate reuse. | Compare full handle; reject old incarnation. Do not use pool index alone. |
| Complete handle recurrence/counter wrap | Finite documented counter; exact installed behavior unmeasured. | Owner incarnation token and session retirement matter; old `Exists()`/same model observations cannot prove continuity. |

**Safety qualification:** a complete native tuple prevents stale work across turns/sessions only when native entity lifetime changes also invalidate the relevant Essential authorization/session. SESSION_IDENTITY cannot prove that an old authorized full handle will never later denote a different entity. An observed counter-wrap/recreation defect must be reproduced and fixed at Essential's native validation boundary, not hidden with `characterId`. No such live defect was demonstrated by this static audit, so no E1–E6 redesign is proposed.

## 13. Failure modes and fences

| Mistake/race | Consequence | Required fence |
| --- | --- | --- |
| Route audio/action by character ID or reverse “current ped for character” lookup | Old work reaches the returning character's new entity. | Original native tuple stays immutable; character registry has no dispatch API. |
| Share/reuse a connection or history by character ID | Session fencing and interruption isolation weaken. | One connection/history per existing native session; no transfer to a different nonce. |
| Infer identity from names/model/location/role | False character merge; unrelated memories/voice leak. | Explicit owner/provider key contract only. |
| Accept cached stock actor/PR record | New incarnation receives old person data. | Fresh hydration + owner registration; no handle-only cache as proof. |
| Accept PR async completion by `Handle` | Delayed record binds to a later lifetime. | `CompletedAsyncRecord` exposes only Handle/Json; wrap future provider requests with local captured epoch/incarnation/revision, or reject persistence when correlation is unavailable. [N1] |
| Late owner revoke/detach removes newer binding | Returning character loses correct association or voice. | Compare-and-delete exact nonce/binding/incarnation/revision. |
| Async character lookup finishes after turn supersession | Late prompt, voice or memory affects new turn. | Native current check + captured session/binding token after every async boundary. |
| Same character claimed by two live entities | Reverse binding becomes nondeterministic. | Conflict; no automatic stealing. Explicit future multi-instance policy would need separate design. |
| Switch voice during E6 segments or retry | One response changes speaker characteristics. | Freeze one speech profile before provider work; adoption at a clean session boundary. |
| Save/load/restart reuses nonce/turn numbers | Persisted stale events appear current. | Fresh run/adapter epochs for identity events; never restore runtime bindings. |
| Identity file corruption/failed write | Alias duplication or unstable voices. | Validate, serialized create-once, atomic recovery; ephemeral fallback; no overwrite of corrupt evidence. |
| Model/prompt says “I am character X” | Prompt content becomes identity authority. | Identity established before reasoning; strict output schema carries no identity mutation. |
| Addon throws/blocks in `EnrichActor` | Context/native gameplay stalls. | Cheap bounded lookup; no disk/network inside callback; integration failure yields absent evidence. |

Identity failure should normally affect persistent association only. A **known different incarnation or conflicting identity inside a continuing session** is the exception: retire exact active work/session so its history cannot mix people. Use existing Essential lifecycle entry points; do not replay actions or let identity retries restart a whole turn.

Telemetry remains passive. Add bounded events such as `identity_resolved`, `identity_binding_retired`, `identity_conflict`, `identity_evidence_stale` and `character_store_unavailable`, with safe enums, binding revisions and opaque correlation. Do not log police names, dates of birth, source JSON, dialogue, prompts, audio or source keys that contain personal record data. Existing observability allowlists must be extended explicitly rather than embedding arbitrary fields. [R13]

## 14. Tests and controlled GTA experiments

### Offline verification

Tests for the implementation should establish behavior, not merely mirror record setters:

- Same canonical alias resolves once across sessions/handles/restart; distinct aliases/world profiles remain distinct.
- Same model/name/location without strong evidence never resolves to an old character; repeated callout participant/template keys across incidents remain separate.
- Duplicate source keys, contradictory trusted claims and simultaneous double-live binding fail persistence without merging.
- Old nonce detach, old incarnation revocation, late hydration/record response and async store completion cannot overwrite/remove a newer binding.
- Store round-trip retains aliases/voice; malformed/unknown schema/duplicate aliases/write failure leaves evidence intact and session fallback usable.
- Persistent voice survives pool reordering and native session replacement; ephemeral output is identical to current E2; one E6 generation keeps its voice across every segment/retry.
- C# claim → Essential serializer → stock `lO`/`ia`/`eo` → OpenAI snapshot preserves the namespaced data while leaving native ped ID and action capabilities unchanged.
- With SESSION_IDENTITY enabled, wrong ped/turn/generation/nonce completion still cannot commit; superseded model/TTS/action work still cannot publish; exact interruption/native authorization remains the same.
- Known incarnation change retires the session before another person's history is read; returning persistent character starts with empty bounded history and its prior voice.
- Feature-off and stock Gemini behavior remain identical at relevant boundaries.

Extend the existing stock harness to drive real patched controllers and identity-bearing actor snapshots. Add native-addon contract tests against the pinned assembly metadata. Do not execute game behavior in unit tests. Fakes can test entity-token invalidation, but physical entity existence/reuse needs GTA.

### Controlled experiments

Use a small authored test addon and synthetic characters. Record safe identity/correlation values and Essential lifecycle outcomes; avoid provider-record personal data. Each experiment has a pass criterion:

| Experiment | Procedure | Pass criterion / information needed |
| --- | --- | --- |
| E1: handle representation/reuse | Spawn/delete bounded batches of test peds; capture complete string handle, documented index/counter if available, model and old-wrapper existence. Observe slot reuse and any complete-value recurrence. | Record installed RPH/game versions, exact format and counter behavior; new entity never inherits explicit identity without a new registration. No recurrence in a finite test is not proof of global uniqueness. |
| E2: explicit recreation | Register Alex, converse, close/delete, recreate on a new handle/model with same owner alias. | Same character/voice; fresh incarnation/session; empty bounded history; old PCM/actions/completion ignored. |
| E3: duplicate models/claims | Spawn two copies of a named model; only one has a source registration. Then deliberately assert one alias on both. | Unregistered copy ephemeral; duplicate live assertion conflicts and cannot steal a binding. |
| E4: hydration/control ordering | Trace registration, `EnrichActor`, typed/PTT/special-event hydration, control changes, session opening/closing and interaction events. Test paused/reused sessions. | Prove when current claims are delivered and correlated; no assumption that release/interaction end is disconnect. Identify paths needing explicit fresh hydration. |
| E5: death/despawn/release | Kill/delete/dismiss a registered ped while reasoning/TTS waits, during early PCM and between segments. | Owner revoke/validation retires evidence and exact work; no late memory/voice reassignment; Essential supplies actual playback outcome. Measure detection latency. |
| E6: addon/server/world transitions | Restart addon and server independently; reload save, fail/retry a mission, respawn player, restart game. | Old epoch/bindings rejected; fresh explicit proof required; same intended world profile restores aliases/voice only. Document unsupported transitions. |
| E7: scene identity | Run two instances of one scene/callout template with repeated participant keys; optionally reload an owner-saved roster. | Distinct new participants unless roster explicitly restores character IDs; setup/location never causes identity merge. |
| E8: PR/Nexus audit | Through public bridge, inspect synthetic record schemas; repeat queries, refresh caches, dismiss/recreate actors, reload/restart provider; delay a response. | Demonstrated provider-owned unique key, documented scope and lifecycle, and exact request/incarnation association. Otherwise provider stays context-only. |
| E9: full-handle recurrence stress | If recurrence can be induced safely, leave an old provider response/authorized turn delayed while recycling entities. | Essential rejects stale native effects or exposes a reproducible native lifetime defect requiring a narrowly scoped fix. Identity equality alone cannot authorize anything. |
| E10: latency/soak | Many ambient conversations plus a small explicit roster; compare enabled/disabled, storage failures and rapid actor switches. | Bounded registration/binding memory, no per-frame world scans, no storage wait on PCM/completion, no new stale publication. |

Physical E6 acceptance from the current roadmap remains a prerequisite for the character-voice rollout. A new identity feature should not obscure the already open test of early segmented playback. [R13]

### Verification performed for this review

- Current HEAD offline candidate build passed with all three pinned inputs verified and 25 stock-source edits.
- Fresh full suite: **140 tests passed, 0 failed, 0 skipped**.
- Generated candidate bundle hash: `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`.
- Static extraction confirmed the additional public surfaces and handle/continuity/enrichment chains described above.
- **No GTA experiments or live provider API calls were run.** These results validate the current offline baseline, not an implementation of this plan or the physical game behavior.

## 15. Migration and rollout sequence

1. **Finish the existing physical E6 gate.** Retain the verified offline baseline and exact current pins.
2. **Implement evidence-only native addon.** One explicit test owner; reserved structured block; fresh incarnation/epoch; retirement channel; no character-owned voice or persistent memory. Verify current hydration and lifecycle experiments.
3. **Add JS resolver/bindings in shadow mode.** Log only safe classification/reasons; compare claims with native sessions. Preserve session voices/history; exercise close/replacement/conflict races.
4. **Enable registry persistence for explicit characters.** Fresh aliases only, bounded JSON store, restart/duplicate/write-failure tests. Keep runtime bindings off disk.
5. **Enable character voices for new clean sessions.** Existing connections retain their E2 assignment; unsupported actors continue session assignment. Test persistent voice plus E6 segments, interruption and late results.
6. **Run acceptance/soak and enable by default only within the explicit-source scope.** Feature-off removes identity consumption and resumes current session behavior; preserve the registry for later re-enabling.
7. **Consider additional sources separately.** Story/mission ownership, saved scene rosters, PR/Nexus unique records each require their own provider contract and experiments. No generic matching threshold unlocks them.
8. **Later memory integration.** Add bounded read context and accepted event consumption only after trustworthy identity is demonstrated. Personality, relationships and goals remain later consumers.

Release criteria: explicit returning character keeps its ID/voice; unsupported actors never merge; known lifetime change cannot share old history; stale binding events cannot remove new associations; all native identity/action/audio/completion tests still pass; game experiments demonstrate the required freshness/revocation behavior; identity remains optional for ordinary conversations.

**Final architectural conclusion:** retain Essential as the actor/turn authority and reuse its continuity/context APIs. Add a small durable registry plus owner-verified runtime bindings. The hardest missing substrate is trustworthy evidence that a live ped represents a returning person, including freshness and retirement. V1 should solve that for one explicit source and refuse to generalize until another source supplies an equally strong contract.
