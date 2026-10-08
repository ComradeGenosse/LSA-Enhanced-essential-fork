# PS4 code-level implementation plan: dialogue knowledge projection

**Date:** October 8, 2026. **State:** implementation plan; no production implementation or deployment performed. **Audited main:** `7e54b17b53f2786f3e9294e546db6b560fb5f6a7`. **Input update:** [PR #21](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/21), originally published at `3e1375258d6f4d45fb3a68cf738c4f06a56ec41e`.

This plan expands the [PR #21 implementation update][authority-update] using the current corpus consolidated in PR #16. Architectural authority is [C-02/C-04/C-13/C-14][authority-contracts], [D-001–D-017][authority-decisions], and the active [convergence architecture][authority-convergence]. Source citations below are pinned to the audited commit; radio citations explicitly use its unmerged branch commit. Proposed symbols, wire extensions, bounds, and test names are implementation specifications, not claims that those items exist or are already locked contracts.

## 1. Required outcome and completion boundary

An existing Essential OpenAI/Luna turn must contain a bounded, immutable projection of **that exact actor's** PS2 knowledge, ordered by existing PS3 salience, alongside the actor's existing authored canon, selected P2 memories, genuine input and committed history. The final reasoning request must have one C-04 knowledge writer and no unchecked scene narrative beside it. Source and lifetime qualification must survive selection, serialization, retries, and delivery acknowledgement.

The smallest complete baseline is:

1. C-02 shared anchors and an authenticated, turn-captured actor-to-observer association, including ordinary actors.
2. C-13 host/world fences across existing channels and captured frames.
3. C-14's supported situation/profile view feeding PS3, with unsupported recognition/activity explicitly unknown.
4. P0-time freezing of profile/memory/history/observation/salience inputs; accepted STT may fill only the current-input slot later.
5. Existing P2 projection plus PS2/PS3 selection assembled into C-04 lanes and used by every OpenAI request path.
6. Exact C-03 `ps4_context` acknowledgements, private-by-default diagnostics, explicit delivery gates, and end-to-end request/GTA proof.

This does not require PS5 automatic memory, PS6 autonomous turns, PS7 social routing, PS8 hardening of those future systems, ACT3 capabilities, or a new database/ranker/model call. C-01 hearing and C-05 dialogue-action self-knowledge remain separately gated. Radio and supported ACT facts are later contributors to this same assembler. No implementation phase may create another native executor, turn allocator, playback owner, profile store, or free-form prompt writer.

## 2. Verified baseline: reuse versus actual gaps

| System | Verified reusable implementation | Remaining work relevant to PS4 |
| --- | --- | --- |
| PS0/PS1 | Closed factual pipe, 256 anchors, 16 observers, lifetime validation, witness policy, bounded native sampling. | Move existing anchors into host ownership; publish exact association and shared host/world fences. Retain current admission and callback limits. |
| PS2 | Immutable observer observations, claim qualification, revisions, expiry, episode correlation. | Add bounded read access. Projection must read observations, not raw signal retention or shared episodes. Some typed source semantics are currently lost, and some self receipts are absent; see §6. |
| PS3 | Deterministic classification, ordering, repetition/escalation ledger, C-03 acknowledgements. | Supply C-14 instead of the current generic `activity:'unknown'`; pair each frozen decision with its matching observation and situation. Do not rewrite the ranker. |
| P0/E1–E6 | Exact tuple, immutable actor/listener/world/reference snapshot, stock action validator, provider retries, streaming/early TTS, playback-gated history. | Freeze additional inputs at the same seam; replace raw narrative ingress without weakening action/lifecycle fences. |
| P1 | Owner-fact verification, current incarnation binding, durable CharacterId. | Use existing proof for owned observer/profile lookup; backend identity never constitutes another NPC's recognition. |
| P2 | ProfileStore v1, bounded allowlisted canon, selected-memory sorting, encounter profiles, editor/CAS. | Capture the immutable loaded profile before async work; provide canon/memory inputs to C-04 instead of independently appending/duplicating canon. |
| ACT0–ACT2 | Merged through PR #18; native receipts, engine, fact store and physical evidence levels. | C-02/C-13 convergence and qualified lane access remain. `EndOwnership` still writes `idle`; fix C-06 if owner conclusions are exposed. |
| Radio R0–R5/v2 | Unmerged `ad6cad61a0108f40e9ed2e738be756c63ab05350`; reusable producer/catalog/witness/phrasing tests. | Convert R5's live-conversation/post-STT `contextText` injection into frozen C-04 lane contributions. |
| PS5–PS8 | Existing forward contracts/design. | Do not implement these under PS4 or treat `memory:'stage'` as a durable write. |

Main and PR #21 were checked again for this plan: PR #21 remains open and its base is the audited main SHA. Older CURRENT/ROADMAP overview paragraphs and parts of the contract status table still describe ACT as unmerged; main ancestry, PR #18 and the updated ACT status sections are newer. The archived PS/Director document is provenance, not a second architectural authority. [PR #21 reconciliation][authority-update]

### 2.1 The current disconnected paths

```text
PS native -> IntelligenceClient -> ShadowRuntime -> ObservationStore -> SalienceCache
                                                       ends here for dialogue

Essential Xn -> OpenAIConnection.beginTurn -> prepareIdentity/CharacterService
 -> runSequentialTurn -> decide / decideStreaming -> buildRequest
 -> raw systemInstruction + contextText/internalEvent + actor/listener/world JSON
```

`bootstrap.mjs` starts IntelligenceClient only for `intelligence.mode:'shadow'`; neither request function reads it. `noteSalience` passes generic situation. `CharacterService.prepareTurn` reads a live profile and puts canon in both actor data and authority text. `buildRequest` stringifies raw actor/listener/world and interpolates scene strings. Those are the concrete integration gaps, not missing perception/memory infrastructure. [S01][s-bootstrap] [S02][s-glue] [S09][s-shadow] [S15][s-character] [S22][s-request]

## 3. Contract-to-code work map

Paths beginning `src/`, `tools/`, or `tests/` in this document are inside `lsa-essential-e1-candidate/`. Native and docs paths are repository-relative. New files below are planned.

| Authority | Exact existing seam | Planned change | Explicit limit |
| --- | --- | --- | --- |
| C-02 | `RuntimeEntry.Start`; `EntityAnchors.Retain/Resolve/Retire/Cleanup`; private `IntelligenceIntegration.anchors` | Instantiate one host anchor service; inject it into PS/P2/ACT; expose reason/consumer quota accounting around existing lifetime rules. | Preserve wrapper/full handle/address/owner-lifetime validation. No handle-only re-resolution. |
| C-02 | `PromotedCharactersIntegration.EncounterFor/PerceptionRoster/Retire`; empty `IntelligenceIntegration.EnrichActor` | Private observer-index publication and actor capture block from the exact supplied Ped; optional owned encounter/incarnation join. | Ordinary observers need no registration/promotion. No CharacterId on the factual wire or in model output. |
| C-02 | `ActivityDispatch.EssentialActivityWorld.Resolve/Sample/AnchorLive` | Replace entity `captures`/`addresses` with shared captureRefs. | Keep `PlaceTable`/`here` coordinates; preserve ACT's 32 entity-ref quota and time-of-use checks. No new ACT3 target capability. |
| C-13 | `RuntimeEntry.Start`; P2/P1/PS independent clock-reset branches and hello constructors | One hostRunId and P2-owned world detector, shared clock, reset broadcast; extend existing hellos/validators. | Existing channel epochs/streams/sequences remain independent transport fences. |
| C-14 | `ShadowRuntime.noteSalience`; `situationFromCharacterView`; native activity/P2 sampling | Inject one normalized situation provider; use frozen, proof-gated P2 metadata and sampled mode. | Unknown until supported. Prose never becomes a policy tag; owner truth is not inferred from `Encounter.Mode`. |
| C-04 | `OpenAIConnection.beginTurn`, `#launch`, `prepareIdentity`; `hostFor.prepareTurn` | Freeze a private knowledge input snapshot and always prepare a safe frame, including when P1/P2 are disabled. | No new deadline, await at beginTurn, native turn, or late resampling. |
| C-04 | P2 `narrativeProfileWithDiagnostics`, `CharacterService.prepareTurn` | Reuse canon/memory selection and diagnostics as a frozen provider; remove independent canon append from the PS4 request path. | Preserve P2 precedence, 16 KiB combined canon bound, selected-memory ordering, voice identity and acting behavior. |
| C-04 | New `src/perception/knowledgeSelector.mjs`, `knowledgeProjection.mjs` | Bounded deterministic selector and sole lane assembler/renderer. | These are the already scoped PS4 modules. No generic parallel context framework. |
| C-04 | `buildCandidate.patchSource` at `WP/Xn/qK/BK/EO`; stock `qM/dM/FM/mT` | Separate trusted behavior/action instructions from generated scene; reserve the private knowledge namespace. | Exact AST matches and source pins; preserve Gemini's stock route and Essential action filtering. |
| C-04 | `decide`, `decideStreaming`, `essentialDecision.buildRequest` | One safe renderer for every OpenAI mode; eliminate raw narrative fallbacks. | Raw snapshots remain private validation inputs, never alternative model payloads. |
| C-03 | `SalienceCache.acknowledge`; common reasoning completion seams | Acknowledge only exact items in a successful reasoning request, once per frame/consumer. | Context delivery never consumes PS6 response entitlement. |

## 4. C-02: one retained lifetime and a captured actor join

### 4.1 Promote the existing anchor service without changing its identity rules

`EntityAnchors` already retires on wrapper, full handle, address, owner-lifetime or validation mismatch; native cleanup expires unrefreshed refs after 30 s. Companion anchors lease for 3 s and channel health times out after 3 s. These are different bounds; neither is a turn-duration lease. [S04][s-anchors] [S08][s-contracts] [S09][s-shadow]

Implementation tasks:

1. Add a small host context (proposed `native/promoted-characters/HostContext.cs`) owned by RuntimeEntry and passed to existing integrations. It contains the existing `EntityAnchors` instance, one monotonic clock, hostRunId/world epoch and bounded consumer bookkeeping. It does not run a sampling loop or own native execution.
2. Remove `new EntityAnchors()` ownership from IntelligenceIntegration; pass the service in its constructor. Move cleanup ownership to one P2/Core-update location. PS continues observer priority/discovery/sensor work on Essential's update path. RuntimeEntry's existing 100 ms lifetime/status fiber remains a lifetime/status fiber.
3. Wrap existing Retain as the C-02 operation `Retain(ped, reason, ownerLifetime?)`. Reasons are closed consumer labels, proposed `ps_discovery`, `ps_observer`, `p2_encounter`, `turn_actor`, `act_target`. Retention by ACT/P2 must never promote an observer; PS remains the owner of the 16-observer priority policy.
4. Keep 256 global refs and 16 observers. Maintain a maximum 32 distinct ACT entity refs and the existing P2 encounter bound of 256; shared consumer use of one captureRef counts against each consumer's quota but occupies one table entry. Reject new admission at capacity; never retarget/evict an active ref to make room.
5. Replace ACT's entity dictionaries, `Resolve(player)` insertion, `Sample` target check and `AnchorLive` implementation with the shared service. `here` remains a place/coordinate ref, not an entity. Keep current slot support and ACT leases. Add reasons to retirement notifications; adapt subscribers instead of inventing another retirement ledger.
6. Teardown/revoke/reset clears shared refs once and fans out retirement; subscribers release their indexes/callback refs. Tests must prove no second retained entity table survives and no duplicate tracker, plugin, update pump or physical effect appears.

P2 encounters remain owner/control records, but add their shared captureRef and use shared lifetime resolution for `EncounterFor` reuse and capture-ticket admission. The current handle-keyed `EncounterFor` returns an old still-Alive encounter without comparing the **supplied** wrapper/address. Require exact supplied wrapper/full handle/address plus current shared lifetime before reusing it; retire/create a new encounter on mismatch. Promotion/release changes owner lifetime and therefore retires the old anchor association according to existing EntityAnchors rules; pending turns do not inherit the new association. Keep P2's 16 capture-ticket bound and existing ownership tokens instead of replacing control authorization with captureRef. [S07][s-p2-native]

### 4.2 Keep PS facts unchanged; publish the association separately

Current anchor rows contain `captureRef/kind/observer/owned/conversation`, with no encounter/incarnation. The ordinary conversation flag identifies the **live** selected observer, not a captured turn. C-02 requires a private index; do not add durable identity to Observation v1 or raw signal semantics. [S06][s-native-intel] [S08][s-contracts]

Proposed minimal closed extensions on the **existing output-only PS pipe**, advertised in hello:

```text
observer_index: rows[] <=32 per frame, <=256 retained
 row = {captureRef, kind, owned, encounterId?, incarnationId?}
 index is keyed by (hostRunId, worldEpoch, PS adapterEpoch, captureRef)

actor.integrations.turnKnowledge (private reserved block):
 {version:1, hostRunId, worldEpoch, captureRef, sampledGameTick,
  encounterId?, incarnationId?}
```

These fields implement C-02's existing index sketch; they are a proposed encoding. Emit `observer_index` after matching anchor admission and before observations that require its join; retire/remove it with the anchor. Changes of encounter/incarnation retire the old association. Use ordered bounded batches and existing channel sequence checks. Snapshot refresh/reconnect must publish a complete current index. An absent index is absence of enrichment, never permission to infer one.

Use IntelligenceIntegration's currently empty `EnrichActor(Ped, ActorContext)` for the private block. It must retain/resolve the **supplied Ped**, validate `context.PedId`, and use the same shared instance. An optional P2 provider may add encounter/incarnation only if the exact retained Ped and owner lifetime match; do not call a promoting/registering operation. Preserve the existing `characterProfile {version:1,encounterId}` block and P1 claim schema. [S06][s-native-intel] [S07][s-p2-native]

Companion join requirements at P0 freeze:

- The block's version/closed keys and UUIDs validate; its host/world matches current authenticated PS host context.
- Its captureRef has a live `kind:'ped'` anchor and matching observer-index entry. It is the exact block captured with the current actor and full Essential tuple, not a later `conversation:true` search.
- If `owned:true`, encounter/incarnation agree with the captured P2/P1 evidence; any mismatch disables owned-profile relevance. Ordinary `owned:false` actors still get their own perceptions.
- Profile lookup requires fresh P1 binding/proof of that incarnation. A known backend CharacterId is usable privately for the actor's own data; it is not recognition of a participant.
- Missing/ambiguous/mismatched capture data produces an empty PERCEIVED lane with a closed omission reason. Never guess from pedId, display name, model, nearest ped, current speaker or latest conversation flag.

Reserve `turnKnowledge` in `EO` normalization and strip it unconditionally from every model projection, including P1/P2 disabled/failing paths. Treat `integrations.raw.turnKnowledge`, duplicate namespaces and flattened lookalikes as untrusted; they cannot create a join. The actor block is a reference to independently current factual state, not self-authenticating authority. [S23][s-build] [S24][s-stock]

### 4.3 Action targets retain their existing separate fence

P###/V### aliases remain the existing reasoning-time affordances; private P0 referenceMap and stock `validateStockDecision` retain captured native IDs and current comparison. C-02 captureRefs do not automatically become new DO targets. A model-visible anonymous participant may have a P### label only when a private, same-lifetime association to the captured P0 label is verified; otherwise describe it anonymously and provide no actionable alias. Do not map by bare handle. [S20][s-snapshot] [S21][s-validator]

## 5. C-13: shared host/world fencing without replacing channel epochs

Current PS resets its own channel on `tick < previousTick`; P1 and P2 also detect regression independently. PS adapterEpoch currently stands in for Observation `nativeRun`; ACT has nativeRun plus adapterEpoch, P2 ownerEpoch and P1 adapterEpoch. Equality among these IDs is not an existing join. [S03][s-runtime] [S06][s-native-intel] [S25][s-identity-native] [S27][s-activity-channel]

Implementation tasks:

1. RuntimeEntry mints hostRunId exactly once per host initialization before ACT/P1/PS channels are constructed. A host reload mints a new hostRunId. P2 owns worldEpoch, initialized once and advanced once per discontinuity.
2. Centralize game-clock comparison on the P2/Core owner update path. Existing reset branches become idempotent consumers of `world_epoch`; they retain their cleanup/reinitialization routines. Preserve a defined uint-clock wrap policy rather than misclassifying ordinary wrap as a save rollback; exercise it offline.
3. Extend **all existing native pipe hellos**: PS `IntelligenceChannel`, P1 `OwnerFactChannel`, P2 `ControlChannel`, ACT `ActivitySession.ServerHello`; ACT's companion hello echoes the same host context. Add `hostRunId/worldEpoch` and a closed extension-version advertisement where needed. Update OwnerEvidence, NativeOwnerClient, PS/ACT clients and both sides' contract tests together. Keep existing schema/version pins, ACLs, request IDs, native epochs, worldProfileId and sequence spaces. Do not silently accept arbitrary extra fields.
4. Use C-13's `world_epoch {epoch,reason}` with reasons `clock_regression|host_reload|timeline_change` on long-lived existing channels. The per-request P2 control pipe publishes the new context in its next hello and rejects stale operations. UX4 consumes the host event inside the existing host/DomainHost path; CGE is unimplemented and needs no new pipe. No new endpoint is necessary.
5. A peer missing the new advertised extension can continue only through its existing supported legacy capability; PS4 observer enrichment is unavailable. Do not assume two old channels are from the same run. Mixed-build controls never gain new authority by weakening old validation.
6. On reset, retire shared anchors, clear observer-index/situation/observation/salience/transcript state, invalidate captured PS4 frames and call ACT's existing reset/cancel machinery. Preserve P2/P1 durable stores. Never automatically re-adopt peds or replay side effects.
7. Frame/current checks include full Essential tuple **and** captured host/world/PS stream context. Before send, stale optional knowledge is omitted via the safe frame. After a request has been sent, a reset/retirement that invalidates its actor cancels that exact generation through existing `abortTurn`; no stale reply, acknowledgement or action is published.

Do not compare native Stopwatch values to companion `performance.now()`. Companion expiry uses its own receipt/monotonic clock; native sampledGameTick is evidence provenance. Host/world identity joins the systems; it does not turn their clocks into one numeric time axis.

**Exit:** reconnect, owner revoke, host reload, clock regression, future explicit timeline change, and participant reuse cannot donate old knowledge to a new turn. Off/shadow PS4 still preserves ordinary Essential conversation where native identity remains current; enrichment loss alone does not create a replacement session.

## 6. PS2 semantic coverage: project only what observations actually contain

This audit found narrower producer/claim gaps than the high-level plan shows. `EpisodeCorrelator` maps event kinds but stores only `{eventSignalId,reason}` in ordinary claim details. Native signals contain action/succeeded, location, activity, vehicle/driver and presence values; those values do not survive into the claim. The claim validator accepts generic details or injury deltas, not those semantic payloads. A PS4 renderer must not look back into `signals` or EpisodeStore to fill the gaps. [S12][s-correlator] [S08][s-contracts]

| Current claim/evidence | Safe baseline projection | Required narrow addition for richer semantics |
| --- | --- | --- |
| `injured` + visual/self evidence | Observed signs of injury / experienced injury; qualified as sampled or uncertain. | Numeric injury details only when present and validated. No attacker, weapon or cause inferred. |
| `dead` + visual evidence | Saw the subject dead / apparently dead according to certainty. | Never infer who killed them from a shared episode or later claim. |
| `firing` + visual evidence, known source | Saw that anonymous/recognized subject firing. | Shooter identity requires separate recognition; weapon/target attribution is absent. |
| `sound` or auditory firing fixture | Heard the qualified sound; unidentified origin unless the claim itself supports it. | Main's current native adapter does not exercise general auditory firing; do not claim this is already a live feature. |
| `action` + generic reason | Omit a named action or success statement. | Closed PS2 action detail `{action,succeeded}` copied only from a qualified receipt; callback success means handler outcome, not physical completion. |
| `location` + generic reason | Omit a destination/zone assertion. | Closed PS2 location detail from the qualified sampled signal; observation of someone else changing location does not automatically identify a destination. |
| `presence` from activity/vehicle transition | At most the supported anonymous presence claim; omit a mode/seat assertion. | Closed qualified detail variants for activity/vehicle, with observer knowledge of the value established. |
| `speech_heard` from playback lifecycle | No spoken words and no claim that the player was heard. | C-01 source-time receipt/transcript join; playback start/end is not hearing or text. |
| Report | A bounded attributed report, explicitly unverified, only if a valid report receipt and report content provider exist. | Main's generic event reason is not report text; leave report content absent. |

Implement the baseline injury/death/firing projection directly from Observation v1. For action/location/vehicle details, extend **PS2's closed claim-detail variants** in `contracts.mjs` and `EpisodeCorrelator`; preserve Observation v1 envelope, empty `recognizedCharacterIds`, four-claim maximum, revisions and existing evidence vocabulary. The eventSignalId/reason fields remain provenance. Add only enum/zone/boolean/ref fields required by the supported contributor. Do not copy arbitrary `signal.facts` or labels. No broad Observation v2 redesign is needed.

Two further source facts affect required tests and GTA claims:

- `ShadowRuntime` synthesizes self receipts for `damage/death` and self firing, but not `injury_state`. Native `CaptureWitnesses` excludes the subject itself; the pure WitnessPolicy self-involvement branch is not called by that loop. **Add `injury_state` to the existing self-receipt path**, with `knowsTarget:true` for self injury and the appropriate self source/target fields. This fixes a qualified-input omission using existing sampled evidence; it is not an alternative damage detector. Preserve actual callback/self basis. [S09][s-shadow] [S28][s-witness]
- Native `CaptureWitnesses` returns before evaluating events whose VisualRange is zero, and visual firing does not fall through into the pure audibility branch. Self action/location/activity/vehicle signals are also not synthesized by the current companion self path. **Do not assert those are already observer knowledge.** Named action self-knowledge waits for C-05; current physical situation is supplied by C-14; richer environmental/hearing producers need their own qualified-input gate. [S06][s-native-intel] [S28][s-witness]

Damage delivery remains a producer-specific limitation recorded by PR #21 and the existing damage branch. Sampled injury/death is usable when witnessed; zero direct callbacks cannot be upgraded into attacker/weapon attribution. No new damage research is part of this plan. A PS4 test may use a valid auditory fixture to prove epistemic projection, while the corresponding live GTA hearing case remains unsupported until its producer is enabled and verified.

## 7. C-14: feed real character/situation inputs into existing PS3

### 7.1 One provider, with private identity separated from recognition

Implement one read-only `situationFor(observerCaptureRef)` composition in the existing runtime service wiring. Native P2 supplies sampled physical activity; companion joins the exact observer index to current P1 binding and loaded P2 profile. `situationFromCharacterView` remains the normalizer. `ShadowRuntime` receives this provider through IntelligenceClient options and calls it in `noteSalience`, replacing the current generic object. [S09][s-shadow] [S13][s-salience] [S14][s-identity]

Proposed native activity extension on the existing PS pipe:

```text
observer_situation: rows[] <=32, same host/world/stream fence as observer_index
 row = {captureRef, sampledGameTick, activity, situationRevision}
 activity uses exactly C-14's enum; missing/failed sample -> unknown
```

Keep relationship, trait policy and memory metadata in the companion; native code does not read profile files. Snapshot the activity at the same owner-path sample cadence, with expiry no longer than the live anchor/channel lease. Apply one mapping, reused by PS4 and PS3:

| Supported evidence, in priority order | C-14 activity | Qualification |
| --- | --- | --- |
| Native actor in a vehicle and current driver is that exact Ped | `driving` | Resolve retained vehicle/Ped; unavailable driver sample falls back to `in_vehicle`. |
| Native actor in a vehicle and a valid current seat/driver sample proves a different driver | `passenger` | Do not derive passenger from an absent driver or failed sample. |
| Native actor is in vehicle; role not established | `in_vehicle` | Covers uncertainty without pretending idle. |
| Actual sampled follow mode, not paused/suspended | `following` | Follow flag/qualified ACT mode receipt; `Encounter.Mode` alone is insufficient. |
| Actual sampled wait/hold mode | `waiting` | Use existing Essential hold/state evidence; unsupported mode is unknown. |
| Exact actor is the committed conversation Ped and no stronger physical state applies | `conversation` | UX highlight, a microphone release, or a cached selection is not committed partner evidence. |
| Complete supported sample proves no stronger mode | `idle` | Missing flags/sample/foreign scripted behavior cannot prove idle. |
| Anything unsupported, stale, suspended, contradictory or unavailable | `unknown` | No PS4 inference from narrative activity strings or ACT display phrases. |

Physical owner/mode truth is the C-06 extension when exposed: update P2 control and ACT BeginOwnership/EndOwnership, derive residual mode from sampled NpcState, and keep owner/lease independent of physical mode. At minimum, remove the use of EndOwnership's unconditional `idle` as evidence in this provider. If C-06 is not included in baseline, do not publish owner/lease claims; use independently supported sampled activity or unknown. [S26][s-activity-world]

Companion input rules:

- An owned observer's **own** profile comes from the exact current P1 incarnation and immutable P2 revision. A still-unbound owned observer gets physical activity and generic salience until proof is available.
- Pass only exact trait tokens already implemented: `protective`, `cautious`, `loyal`, `bold`, using the current trim/lowercase matcher. Do not classify prose or introduce tags/weights.
- Pass the existing authored player relationship state/revision as manual character policy when the current player capture is valid. This does not create a protagonist-specific experiential edge or a claim of past interaction.
- For memory relevance, use only the profile's selected memory metadata, sorted by existing importance/ID order before the normalizer's 16-entry bound; text is unnecessary for PS3. Related CharacterIds are private and matter only when the participant has a valid observer-recognition binding. Do not make unselected memory text newly retrievable.
- Initially `bindings` is empty unless a separately validated SubjectBeliefRef/recognition provider exists. P1 knowledge of a name is not recognition. Preserve `recognizedCharacterIds:[]` in Observation v1. Recognition-dependent `prior_memory`/other-character relationship branches can remain unavailable on baseline; test their contract behavior with explicit validated fixtures, and do not manufacture live recognition to make them pass.
- Carry profile/situation revision in private freeze diagnostics. Store unavailable, proof expired or wrong incarnation means no character-dependent relevance; selected canon/recall has its separate §8 proof gate.

### 7.2 Preserve the PS3 cache, decision keys and complete ranking inputs

`orderSalienceDecisions` requires `{decision,observation,situation}`. Current decision entries store only observer/decision/time; current ledger keys are replaced when the same observation's decision changes. The implementation must expose a bounded paired view, not enumerate a cache and substitute current observations or a new live situation. [S13][s-salience]

Extend existing SalienceCache entries/ledger with immutable references to the observation and normalized situation used for that decision. This is additional input metadata on the existing cache, not another event/decision table. Add a read method, proposed `snapshotForObserver(observerRef)`, which resolves up to the store's 128 current observations against matching current decision or ledger metadata. Require observation ID/revision, profile/situation policy revision and native run to agree. Stale/missing pairs are omitted and counted. Respect existing 256/32 decision-cache bounds and 1024/10-minute suppression-ledger bounds; retained pair metadata is additionally capped by the existing observation byte bound and released on expiry/retire/reset.

Add `ObservationStore.snapshotForObserver(observerRef,{nativeRun,now})` as the bounded immutable observation read used by this service; do not expose its mutable Map. Expiring/retiring a pair releases payload references without prematurely deleting the existing suppression entitlement before its normal 10-minute lifetime. Snapshot enumeration has no scoring/acknowledgement effects.

When C-14 profile/activity policy changes, refresh the observer's still-current observations through the **same** `SalienceCache.evaluate`, at a bounded maximum of 128, and replace paired metadata once. Reuse an exact matching cached decision when policy/revision is unchanged; do not call evaluate again merely because a request is rendered or retried. Store/profile edits affect the next freeze. A shadow PS4 preview reads this view and never evaluates/mutates grants itself.

If pressure leaves no matching pair, record `no_matching_salience`; do not construct an urgent decision in the selector. Capacity tests must include a retained important event among routine revisions. Use the existing ordering helper to retain useful paired metadata within the existing bounds; no new scoring weights or entitlement rules. Response `none` remains eligible dialogue context when context is `candidate/must_include`; memory `stage` remains a label, not a writer.

## 8. Freeze with P0 and retain one frame per generation

### 8.1 Private frozen inputs and model-visible projection are different objects

Extend P0 rather than add another turn lifecycle. Proposed private `KnowledgeInputsSnapshot` is captured synchronously inside `OpenAIConnection.beginTurn`, after source actor/listener/world/references and tuple are fixed, before STT, provider work, editor waits or realtime context updates:

```text
{ turn, p0Revision, frozenAt, hostRunId, worldEpoch, psAdapterEpoch, psStreamId,
  capturedActorAssociation, capturedOwnerClaim/binding,
  frozenProfileCandidate/revision, frozenSessionCanon,
  frozenWorld/compatInputs, frozenPriorHistory,
  frozenObservationDecisionSituationPairs[], frozenContributorInputs[],
  source, typedInput?, privateReferenceMap }
```

This object may contain private IDs and proofs. Only C-04's allowlisted lane projection is serialized. `TurnKnowledgeFrame.turn` is an internal lifecycle fence, not model text; the renderer strips tuple, IDs, clocks, decision keys, profile revisions and provenance. Hashes/counters are separate operational metadata. Never stringify the entire private snapshot or frame envelope.

New service operations can be kept small and housed in the planned projection module/runtime services:

```text
captureKnowledgeInputs({identity, source, p0Snapshot}) -> immutable private inputs
prepareKnowledgeFrame({inputs, verifiedCharacterSnapshot}) -> immutable base/candidate frame
finalizeKnowledgeInput({frame, acceptedInput, source, utteranceId?}) -> immutable final frame
assertKnowledgeCurrent(inputs) -> current | closed reason
acknowledgeKnowledge({identity, frame, requestHash, outcome}) -> bounded result counts
```

They are proposed names. IntelligenceClient wraps bounded read/ack operations on ShadowRuntime; the turn pipeline never gets direct mutable access to stores. `hostFor.prepareTurn` must exist for knowledge preparation even when identityService/CharacterService are null. `prepareIdentity` can be extended into a combined preparation method; keep the existing identity/voice logic and original provider-work deadline. [S02][s-glue] [S18][s-connection] [S19][s-sequential]

There is an existing optional transcript-forwarding mismatch: bootstrap calls `runtime.intelligence.acceptPlayerTranscript`, while the current method exists on `runtime.intelligence.runtime` (ShadowRuntime), not IntelligenceClient. If adjusting that wrapper here, delegate to the existing method and return its closed unsupported result; do not enable playerSpeech or synthesize a receipt. The accepted current input for C-04 comes directly from the turn pipeline and must not depend on this optional hearing callback. [S01][s-bootstrap] [S09][s-shadow] [S10][s-client]

### 8.2 Freeze canon before asynchronous proof without trusting an unverified profile

`ProfileStore.get/list` already return validated immutable objects. Add a bounded **read-only** capture helper in CharacterService:

1. For an existing current P1 binding of the captured incarnation, capture that loaded profile object/revision and the current encounter profile at beginTurn.
2. On a first owned turn with no binding yet, use only the captured valid owner claim's world/alias to capture a **private candidate** from an already loaded ProfileStore. Release it to SELF/RECALLED only after existing IdentityResolver preparation verifies the same association and returns the matching CharacterId. Candidate lookup never resolves/creates identity or confers authority.
3. A store/profile not loaded at freeze remains absent for this turn, even if loading completes during STT/proof. A profile edited/deleted after freeze does not silently substitute a different revision; owner revoke/identity conflict invalidates authority instead.
4. C-14 salience frozen before first-turn proof uses the supported view available at freeze. Do not rerank this turn with newly resolved metadata after an await. The next turn gets the newly bound character relevance; the first turn can still receive generic observer perceptions plus its now-verified frozen canon candidate.
5. Capture session canon after existing session name/voice assignment at beginTurn. Keep stable name/voice assignment and existing reserved-name limits; this does not grant an ephemeral actor a durable profile.
6. Refactor `CharacterService.prepareTurn` to provide the captured canon/acting input; it must not call live `store.get` to change the request's revision after await or append its own model prompt block. Existing TTS acting direction must use the same frozen profile revision; preserve voice/model/session assignment and its 4000-character bound.

No new P2 schema, migration, profile writer or mandatory disk read is required. Optional storage failures leave safe encounter/basic context. Selected manual memories retain their existing meaning as authored canon; missing TimelineGuard does not suppress all existing manual memory, but it prevents introducing automatic experiential recall. [S15][s-character] [S16][s-profiles] [S17][s-canon] [S14][s-identity]

### 8.3 Input/history/retry semantics

- Capture `history.readForSession` at beginTurn; keep `commitPlayerInput` at its current accepted-input point. Use the captured prior history in the request, so current input appears once. Assistant assertions in history are conversation, not world/action evidence.
- Typed input is already available; mic input fills the current transcript slot once after accepted STT and `input_transcript`. No new STT or hearing. Null/missing utteranceId remains absent; never synthesize a C-01 hearing receipt from STT completion.
- `#launch` currently merges live `#realtimeContext` into contextText. Replace this unchecked merge for the new request path: only typed contributor deltas captured at P0 may enter lanes. Later updates wait for a later generation. RefreshContext still updates session defaults for the next turn.
- Special/internal sources retain their internal role and empty current player transcript. Use a typed trigger kind from a closed producer registry where supported. Unknown free-form Content is omitted; the internal user message remains the existing fixed instruction explaining that no player utterance was received.
- Render one finalized knowledge projection and reuse it for model retries, structured streaming and early TTS. Provider-specific output schema/model/stream flags may differ; narrative input and selected item set do not.
- Before every attempt validate tuple, actor association, host/world and current leases/claim expiry. Never refresh expired knowledge to fill a retry. If no attempt was sent, finalize the same safe base frame with invalid optional items omitted. If an attempt already used an optional item and it expires/its lifetime ends before retry, reject further enriched retries rather than mixing two knowledge revisions; ordinary recovery happens in the next requested turn.
- Cancellation/supersession releases all per-generation references/controllers. Late STT/model/TTS results cannot finalize a successor frame or acknowledgement. Keep the existing rule: assistant history commits only after matching completed PlaybackEnded with real audio and successful TTS.

**Exit:** editing a memory, changing conversation target, adding an event/revision, delaying STT, or retrying a provider cannot change what this generation knew at P0 freeze.

## 9. C-04 lanes, selector, projection and byte accounting

### 9.1 Lane ownership and complete allowlist

PS4 owns the frame and renderer. Existing systems are input providers; no provider appends a prompt. Preserve the C-04 lane names and shape. Proposed model-facing fields are explicitly listed below; all other object keys are absent by construction.

| Lane | Provider and permitted content | Required qualification / exclusion |
| --- | --- | --- |
| SELF | Existing P2 allowlist: name, nicknames, gender, ageBand, personality description/traits; persistent biography and authored player relationship; ephemeral bounded assigned facts. Qualified ACT/C-05 selfFacts later. | Own canon only after P1 proof for a persistent profile; no CharacterId, notes, appearance, owner alias, voiceReference, auth, profile transport, store metadata. Current capability/safety evidence outranks characterization. |
| PERCEIVED | Selected observer claims, rendered as event category, modality, certainty, anonymous/recognized participant description, supported typed detail and relative freshness. | Exact observer, frozen revision, current run/lifetime, PS3 context not omit. No raw facts/shared episode enrichment; no numeric captureRef/UUID/source key/precise backend position. |
| CONVERSE | Frozen committed role history, accepted current player text once; typed internal trigger descriptor; future C-01 overheard items empty today. | History retains user/assistant roles, never system roles from stored messages; internal events never fabricate user utterances. Current transcript is user data, not instructions. No playback lifecycle transcript invention. |
| RECALLED | Existing selected P2 memory text/category/importance, in current deterministic importance-descending/ID order. | Only this actor's selected canon; ID used privately for ordering, removed from model text. No automatic/unselected search, backend participant profile, or manufactured timeline. Future experiential records require C-07/C-08/C-15. |
| SITUATION | Five P0 world fields: gameTime, weather, streetName, crossingStreetName, zoneCode; supported C-14 current activity. Later witnessed ambient radio items can contribute with evidence. | Explicit unknowns; world labels are bounded descriptive data, not broader global state. Precise positions, every entity, mission flags or implied hidden causality excluded. |
| COMPAT | A closed transitional view of verified Essential self affordances and current listener presence/address; grounded P###/V### action labels. | Never raw actor/listener/world or integrations. Listener private profile and backend identity excluded. Known actions are affordances, not completed acts or witnessed evidence. |

COMPAT field specification for the baseline implementation:

- Actor: status, gender/ageRange enum, supported self `isArmed/isIndoors/hasHeldItem`, a validated held-item token, closed `actionCapabilities` booleans, bounded available weapon **tokens**, current validated P/V action-label lists. Missing/normalization-default fields remain unknown when source presence is unproven.
- Ephemeral role/fact strings may use the existing session profile's bounded `facts` provider. Persistent actors suppress generated persona/role overrides exactly as P2 does today. Do not copy archetype/persona descriptions into a second lane.
- Listener: status `present|unavailable|unknown`, address `A` only for captured player or verified same-lifetime P### for another actor. Omitted listener preserves existing inherited snapshot; explicit null projects unavailable. No listener name, canon, relationship, weapon inventory or unseen activity from raw backend data.
- P/V affordance labels: strict alias syntax from private P0 referenceMap, with safe, source-qualified public type labels if available. A captured target affordance does not prove visual recognition, identity, injury or participation in an event. Do not forward native reference values.
- Available weapon tokens: reuse stock validator's supported token comparison, from structured self inventory if available or a narrowly validated delimiter/token extractor for the existing Essential self-inventory field. No arbitrary inventory prose is serialized. Preserve current weapon-action ability in regression cases; unknown inventory removes the affordance rather than granting one.
- `roleContext`, `weaponDescription` as arbitrary prose, `vehicleContext`, `recentVehicleContext`, `radioContext`, `nearbyPeopleContext`, `locationContext`, `availableActivitiesContext`, police record/persona/integration strings and raw integration dictionaries are not direct narrative inputs. Supported physical capability booleans and DO availability stay private/trusted; unsupported narrative facts await typed, qualified contributors.

This is an explicit implementation allowlist extending P2; it does not claim that Essential's normalized raw fields are automatically observer knowledge. `ia/AO/CO/EO` expose far more fields and flatten integration objects today. Canary tests must cover every one of those routes. [S24][s-stock]

### 9.2 Selector algorithm, using existing ranking

Implement `knowledgeSelector.mjs` as a deterministic function over **frozen paired inputs**:

1. Filter to exact actor observer, same host/world/native run, matching observation/decision revision, supported current claims and valid source/target lifetimes at capture. Do not fill absent source/target from episode participants.
2. Exclude PS3 `context:'omit'`; retain `candidate/must_include` regardless of response `none`. Reject malformed/mismatched decision keys or missing ranking situation.
3. Apply existing `orderSalienceDecisions` without changing its safety/involvement/relationship/novelty/distance/time/trait/ID tie-break order. Maintain the original per-claim modalities when a revision contains both auditory and visual claims.
4. Project supported claims through fixed templates/typed data. Omit an unsupported detail or whole uninformative item, with a closed diagnostic. Do not forward a generic eventSignalId/reason as narrative.
5. Pack `must_include` items before candidate items using the proposed limits below. Compact qualified safety items first; reject/drop low-priority candidates before truncating an important event. Finite budget overflow of `must_include` is counted explicitly; the word does not permit bypassing C-04's bound. It must never silently lose an item to canon duplication or raw-context overhead.
6. Memory projection calls the existing P2 selection/sorting logic. Preserve all selected pins that fit its existing 16 KiB canon budget; do not restore historical first-three/storage-order selection. No new memory relevance model or embedding service. A future automatic candidate cannot outrank explicit pins under this phase.
7. Attach selected private observation revision/decisionKey and memory IDs to internal delivery metadata only. Return stable model lane data plus counts/omission reasons. No store writes, acknowledgements, actions or provider calls occur in this function.

For manual memory, split the already allowlisted `narrative.memories` into RECALLED and the remaining canon into SELF. Render canon once. Preserve current field priority, string bounding and dropped-memory diagnostics; remove memory IDs from the model view after sorting. The combined SELF canon + RECALLED manual-memory allocation retains the existing 16 KiB cap. Character grounding refers to those lanes, not a second JSON copy. [S17][s-canon] [S29][s-authority]

Refactor the existing private `selectedDialogueMemories` comparator/filter into one shared ordered-record helper in sessionProfiles. Its private record view retains `relatedCharacterIds` for C-14 metadata, while the narrative view removes them and memoryId. Reuse that helper for P2 canon, PS3 metadata and RECALLED; do not copy three slightly different sort/filter implementations.

### 9.3 Initial implementation constants and exact accounting

Only P2's **16 KiB canon limit** is an existing numerical authority here. C-04 specifies total/per-lane budgets but not their numerical total. The following are proposed conservative first-implementation upper bounds; they preserve the existing 12,000-character input limit and do not fill unused space. Tune constants from measured preview evidence, not by reopening the architecture.

| Allocation | Proposed bound / behavior |
| --- | --- |
| Frozen candidate observation pool | At most 128 for one observer, capped at 256 KiB retained serialized observation input; no cross-observer collection. |
| Selected PERCEIVED | At most 8 observations, at most 4 claims each, at most 8 KiB lane serialization. Reserve 2 KiB of this allocation for compact highest-priority safety claims before admitting routine candidates. |
| SELF canon + RECALLED manual memories | Shared maximum 16 KiB; reuse `CHARACTER_CANON_MAX_BYTES`. Each lane also has a 16 KiB maximum, but the two maxima cannot be added into a 32 KiB canon allowance. Up to existing 128 selected records may fit; no extra three-memory cap. |
| CONVERSE | Maximum 80 KiB: current input up to 72 KiB serialized and prior history up to 8 KiB. Keep the existing maximum 12 messages/12,000 input UTF-16 units; drop oldest whole history messages to meet byte budget. Never silently cut current input to admit observations. |
| SITUATION | Maximum 1 KiB; each world label up to 120 Unicode code points, zone up to 16 allowed uppercase/digit/underscore characters; invalid values become unknown. |
| COMPAT | Maximum 4 KiB; bounded booleans/enums/tokens/alias lists only. |
| Knowledge envelope/role framing reserve | 3 KiB; counted rather than assumed free. |
| Complete projected frame message allocation | Maximum 112 KiB, including escaped JSON text and role-message framing. Shared canon pool and all per-lane bounds apply together. |
| Trusted behavior/action instructions | Maximum 16 KiB; an oversized custom template/action declaration fails explicitly, never truncates an action list. Validate actual supported stock/operator templates at the build/preview gate. |
| Complete outbound reasoning JSON body | Maximum 160 KiB measured on the final serialized body, including instruction text, schema, history, current input, model/effort/options and all JSON overhead. No optional item may be added after this check. |

The larger current-input reserve accounts for JSON escaping of 12,000 existing code units (up to six encoded characters per unit), avoiding a new silent multilingual input limit. Enforce both source character bounds and final bytes; malformed surrogates/control data require deterministic valid encoding. Long history is projected at a smaller bound but the durable/session history store and commit rules are unchanged.

Accounting requirements:

- Measure `Buffer.byteLength(JSON.stringify(projectedAllocation),'utf8')`, including escape expansion, keys, brackets, commas, role wrappers and renderer delimiters. When data is embedded in a string and then serialized again, measure that final escaping too.
- An item emitted as a role message is counted once in its lane and once in the total request allocation, not copied again into system narrative. Current transcript/history belong to CONVERSE logically but render only as role messages. SELF/RECALLED canon render only once.
- Drop whole observation/memory/history items deterministically; truncate only existing explicitly bounded descriptive strings at Unicode-safe boundaries, preserving certainty/source qualification. Do not cut an evidence prefix or corrupt JSON to squeeze in text.
- Pack safety allocation before optional environment/compat embellishment. If no valid bounded projection can be built, use safe basic frame without unchecked narrative. If even mandatory current input/trusted instructions cannot fit, fail before fetch with a clear existing turn-error path.
- Telemetry records counts/bytes/dropped pins and closed reasons; it does not include the excluded texts. Repeated rendering of the same frozen inputs yields identical projected bytes and narrative hash.

## 10. Replace every model-facing ingress at the source-pinned seams

### 10.1 Preserve trusted Essential instructions and action filtering

The pinned stock call chain is `BK -> ET -> qM -> dM + FM/mT/GM`. `dM` builds behavior/language/available-action declarations from the trusted template/action registry; `FM/mT/GM` inject scene narrative. Forwarding `BK`'s finished string beside C-04 defeats the boundary even if actor JSON is sanitized. [S23][s-build] [S24][s-stock]

Modify exact AST patches in `tools/buildCandidate.mjs`:

1. Preserve the current `WP`, generation-owner `Xn`, and reused-session `qK` capture hooks; pass a **separate** trusted behavior/action instruction component and private context snapshot for OpenAI.
   Where `ia/AO/CO` normalize missing values into false/unknown, capture source-field presence at the existing `oa`/normalization seam before defaults. Carry that closed presence set privately into P0; do not infer an original known value merely from a defaulted key on the normalized actor. If original presence is unavailable, the COMPAT renderer uses unknown for the affected claim while retaining privately validated action availability.
2. At OpenAI's prompt seam, reuse source-pinned `dM`/`ra`/`na` action filtering and the operator behavior/language template. Do not call stock `FM/GM/mT` with raw actor/listener/world for this route. Fill stock `{YOU}/{CURRENT_LISTENER}/{VISIBLE_SCENE}/{WORLD}` placeholders from the safe C-04 renderer only, or append the single frame if the template lacks them. Never duplicate the same lane through both placeholder substitution and an appended frame.
3. Preserve existing NPC-to-NPC direct-speech behavior suffix as trusted behavior when applicable, without donating another actor's private knowledge. Stock Gemini continues its existing BK/ET context path.
4. Reserve `sessionIdentity`, `characterProfile`, and new `turnKnowledge` names in EO's flattening guard. Also exclude these from `integrations.raw` and every model allowlist. Do not make sanitization conditional on an enabled service.
5. Keep action availability calculated from the captured private actor and existing Essential registry. The rendered affordance list must match the actions the validator allows for that same actor; C-04 prose cannot add a DO verb or target.
6. Add exact AST cardinality/source-hash checks and adjust patch count intentionally if necessary. The current builder expects 48 patches; changing the count is a reviewed integration delta, not evidence of a protocol change. Keep pinned stock bundle/Core/DamageTracker inputs unchanged. Update generated manifest/features and run actual patched-controller tests.

If the behavior/template separation does not pass the patched-stock tests, active PS4 does not ship. A regex that removes a few sensitive strings from finished systemInstruction is not this seam.

### 10.2 All OpenAI calls use the same request builder

Extend `decide` and `decideStreaming` to pass finalized frame/behavior inputs to `buildRequest`. Replace `buildRequest`'s raw scene construction with the single projection renderer. No alternative fast path for mic, internal event, identity-disabled, nonstreaming, streaming or early-TTS turns is allowed. Existing strict output schemas, provider selection, timeouts, request tracing and stock decision validation remain. [S22][s-request] [S30][s-decide] [S19][s-sequential]

| Current unchecked ingress | Replacement |
| --- | --- |
| `context.systemInstruction` containing generated stock scene | Trusted separated behavior/action instructions plus exactly one rendered C-04 frame. |
| `JSON.stringify(actor/listener/world)` | Explicit lane projections; raw objects remain private. |
| `actor.characterProfile` plus CharacterService authority append | One SELF/RECALLED canon serialization and existing grounding rules. |
| `contextText` / `#realtimeContext` / action-availability narrative updates | Captured typed contributor inputs or absent; no free-form merge. |
| `internalEvent` / special-event Content | Closed typed trigger descriptor, unknown content omitted; no fabricated player text. |
| Unknown/flattened integration fields | Excluded by allowlist; reserved private block never serialized. |
| `history` supplied by callers | Frozen validated role history from CONVERSE; strict user/assistant allowlist, bounded whole messages. |
| Current input | Accepted genuine player text once, as user data; internal source uses fixed existing internal instruction. |
| Projection/store/identity exception fallback | Same safe basic C-04 renderer with unknowns and valid captured affordances; never restore raw BK/context/actor. |

Preserve separate private `validationContext` containing raw captured actor/referenceMap, from which `host.validateDecision` and existing time-of-use fences work. Do not replace it with the narrative projection or move native IDs into model text to repair a broken validator.

The explicit `LSA_PROMPT_AUDIT=true` path can display the private final request for controlled acceptance. Update it to show projected final messages/frame diagnostics accurately; normal telemetry remains text-free. Existing opt-in DialogueTrace can also persist private requests and transcripts; do not describe it as scalar-only telemetry or enable it automatically. Hash-based standard telemetry and deliberate private audit are separate evidence modes. [S31][s-events] [S32][s-trace]

## 11. Exact C-03 delivery and lifecycle handling

PR #21 defines delivery as a **successful reasoning result from a request that contains the item**, independently of later spoken playback. Implement this precisely, including early TTS.

1. At final request construction, record internal frame/attempt identity, projection hash, final body hash and exact selected decision keys. Rendering/freeze/selection does not acknowledge delivery.
2. Add one common `recordReasoningSuccess` helper to runSequentialTurn. Call it after the completed nonstreaming decision or final valid streaming result and current-tuple/frame checks. In the early-TTS branch call it immediately after `modelTask` returns its valid final result, **before awaiting `speechTask`**; a later TTS failure cannot erase a completed reasoning delivery.
3. For each selected item actually retained in that sent request, invoke existing `salience.acknowledge(exactFrozenKey,'ps4_context','delivered')` once. Do not acknowledge selected-but-budget-dropped items, preview frames, malformed/refused/incomplete model results, failed attempts, or late/stale completion.
4. Model retries reuse the selected frame and acknowledgement token. Intermediate attempt failures do not create a final consumer rejection if a retry later succeeds. At terminal failure before reasoning success, record `rejected`; expiry/retirement/reset records `expired` only against that frame's exact keys. No key substitution and no re-evaluation to manufacture an acknowledgeable key.
5. The current ledger stores only the latest key per observation. If a newer revision/policy replaces it while a valid frozen request is in flight, acknowledgement of the old key can return false. Record `ack_key_retired` separately from request delivery; **never acknowledge the new key**. Do not add an unbounded historical-key ledger to make every old acknowledgement succeed. Gate tests require success for still-current keys and safe false for replaced/expired keys.
6. A valid reasoning result may be delivered even if later stock action validation rejects a command, TTS fails, or playback is interrupted. It still must pass the current tuple/knowledge fences at the reasoning-success point. Partial streaming segments or PCM without final valid result do not prove successful reasoning delivery.
7. Existing semantics remain: ps4 delivered adds `consumedBy`; only ps6 delivered sets response consumption/family consumption. Rejected/expired PS4 cannot regrant a PS6 entitlement. Context use can continue in a later player-requested turn as policy allows; this is not autonomous initiative.

Do not couple knowledge acknowledgements to `history.acceptPlaybackResult`. DialogueHistory remains the sole owner of spoken-history commit/discard. [S13][s-salience] [S19][s-sequential] [S33][s-history]

## 12. Rollout modes, diagnostics and failure policy

Proposed companion configuration is one closed `dialogueKnowledge` object with `mode:'off'|'shadow'|'active'`, default `off`; unknown values cannot enable delivery. Keep existing `intelligence.mode:'off'|'shadow'` exactly as implemented. Active PS4 requires a running supported factual producer plus its own explicit active gate; `intelligence:'shadow'` alone continues to authorize only PS0–PS3 collection/evaluation.

Use an explicit build manifest entry, proposed `dialogueKnowledgeContract {available,frameVersion:1,hostContextVersion:1,observerIndexVersion:1,observerSituationVersion:1}`, plus the matching closed hello extension versions. Bootstrap must verify those and existing perception pins before declaring supported. The current [perceptionContractSupported gate][s-native-support] checks old DLL/metadata pins only; that alone cannot prove the new actor join/frame contract. Existing native `shadowOnly` factual-collection metadata stays truthful; PS4 delivery support is a companion capability, not a renamed native mode.

Separate mandatory request hardening from optional event enrichment:

- The new **safe base C-04 serializer** always supplies supported ordinary OpenAI context, existing P2 canon/manual selected memory and genuine conversation. It replaces the old raw ingress as a tested compatibility change. `off` means no added PS2/PS3/optional contributor context, not a privacy-unsafe legacy fallback.
- `shadow` builds a hypothetical candidate projection from captured pairs and reports counts/hashes; the sent request remains the same safe base request as `off`. Preview does not mutate salience grants, acknowledge knowledge, trigger turns/actions, interrupt audio, write memory or change partner lifetime.
- `active` uses the candidate projection only if C-02/C-13/C-14 and frame/contract/build gates pass. It enriches already requested turns; it has no timer/admission/initiative path. C-14 unsupported subfields may be unknown, but cannot be guessed to satisfy the gate.
- Optional ACT/radio contributions have independent capability support and evidence gates. Missing one contributor cannot enable another or disable ordinary conversation. Stock Gemini stays outside PS4; no silent opt-in parity.

Add scalar-only events to existing `eventContract.mjs` and telemetry emitters, proposed `knowledge_frame_frozen`, `knowledge_frame_projected`, `knowledge_request_composed`, `knowledge_delivery`, `knowledge_safe_fallback`. Allow only versions, counts, bytes, hashes, booleans and closed reasons. Useful counters include joined/unknown/stale actor, selected/dropped observations, omitted unsupported claims, selected/dropped pins, per-lane bytes, safety overflow, frame/request hash, current/replaced acknowledgement counts and preview/active status.

Closed omission/failure reasons must distinguish at least: disabled, unsupported_contract, no_actor_capture, no_observer_index, wrong_actor, host_mismatch, world_epoch_changed, channel_unhealthy, anchor_expired, participant_retired, owner_unverified, profile_unavailable, recognition_absent, observation_expired, revision_mismatch, no_matching_salience, unsupported_claim_detail, unsupported_trigger, budget_excluded, safety_overflow, ack_key_retired, superseded, projection_failed. They are diagnostic categories, not new model prompt content.

Normal operational JSONL contains no canon/memory/transcript/prompt text, private ID maps, owner proof, addresses, or free-form exception strings. Existing explicitly configured private DialogueTrace/PromptAudit remains opt-in. Logging errors never affect request authorization or turn completion. Extend the existing capability/health read model only as needed to display PS4 configured/supported/validated state; do not create another enforcement layer or infer validation from a configured flag.

| Failure | Required behavior |
| --- | --- |
| PS missing, old build or unsupported extension | Safe base conversation; no observer enrichment; closed capability reason. |
| Profile missing/not loaded/proof unavailable | Safe session/basic SELF; no persistent canon/recall from unchecked alias; perception can still work for a valid ordinary observer. |
| Ambiguous or wrong actor join | Empty PERCEIVED; no live-speaker search, promotion, fabricated identity or fallback to someone else's facts. |
| Participant retired before send | Omit affected optional item using captured remainder; never replace the participant. |
| Actor retired/reset after send | Cancel exact generation using existing lifecycle; suppress stale result/actions/acknowledgement. |
| Budget overflow | Deterministic documented omissions with safety priority; no raw-context fallback or invalid JSON. |
| Projection exception | Rebuild safe base from independently validated primitive fields; if that cannot validate, fail the exact turn before provider fetch. |
| Failed model attempt, still retryable | Same frozen frame, no premature delivery acknowledgement. |
| Successful reasoning followed by TTS/playback failure | Retain knowledge delivery outcome; preserve existing assistant-history discard. |
| Replaced decision key | Exact old-key ack returns false/counts retired; do not consume successor entitlement. |

## 13. Implementation phases and file-level deliverables

These are implementation batches against the existing architecture. Every batch includes its relevant tests; the final all-path request proof is mandatory. No production code is included in this document.

### Phase A — C-02/C-13 convergence and authenticated association

**Change:** `RuntimeEntry.cs`, proposed `HostContext.cs`, `EntityAnchors.cs`, `IntelligenceIntegration.cs`, `PromotedCharactersIntegration.cs`, `ActivityDispatch.cs`, P1/P2/PS/ACT hello/reset code and companion validators/clients.

Deliver:

1. Host-owned anchors/clock/run/epoch; single P2 discontinuity detector and idempotent reset consumers.
2. ACT entity-target ref reuse with unchanged current slot support; place refs unchanged.
3. Closed observer-index and private turn actor block, unowned and owned joins, bounded publication/retirement.
4. Matching host context in existing hellos and builds; private namespace normalization/stripping.
5. Read-only bounded companion index/service and current checks; no request enrichment yet.

**Required tests:** T01–T14 below; real Windows PS/P1/P2/ACT pipe interoperability where changed. Native substitutions exercise actual source; no game assembly execution offline.

**Exit/rollout:** G1 passes. Old configs still off; collection still shadow; zero new native actions/turns. A typed turn's captured observer is demonstrably its own even if the conversation target changes before STT.

### Phase B — Qualified PS2 projection inputs and C-14 situation

**Change:** `contracts.mjs`, `episodeCorrelator.mjs`, `shadowRuntime.mjs`, `intelligenceClient.mjs`, `salienceEngine.mjs`, P2 physical activity provider and new closed native situation publication. C-06 files only when owner assertions are included.

Deliver:

1. Fix sampled self-injury omission in the existing self-receipt path.
2. Closed, narrowly qualified detail variants only for supported action/location/vehicle contributors; no raw signal fallback. Baseline harm/firing works without waiting for those optional semantics.
3. One C-14 provider using real activity and exact P1/P2 profile metadata; unknown recognition retained where no provider exists.
4. Existing PS3 caches retain matching ranking inputs and bounded snapshot access. Refresh only for actual observation/situation-policy changes.

**Required tests:** T15–T27 plus PS3 regression. Check selected memory metadata sorting before the ranker's 16-item bound; no text retrieval or trait inference. Verify no acknowledgement/grant mutation from preview reads.

**Exit/rollout:** G2 passes. Production salience for a proven actor shows its actual supported profile/activity revision; sample injury creates qualified self knowledge. Producer gaps are explicitly unsupported, not hidden by synthetic success counters.

### Phase C — P0-time capture of canon, knowledge and committed conversation

**Change:** `openaiConnection.mjs` beginTurn/#launch/preparation, `turnSnapshot.mjs` helpers if needed, `essentialGlue.mjs` services/host.prepareTurn, CharacterService/sessionProfiles capture helpers and acting input.

Deliver:

1. One immutable private knowledge snapshot per full tuple; no await or disk/provider work at capture.
2. Loaded immutable profile candidate gating, first-turn proof behavior, stable session canon and frozen TTS acting revision.
3. Frozen PS2/PS3/C-14 pairs and prior committed history; accepted input-only finalization.
4. No unchecked realtime context merge or resampling on retry; exact cancellation/cleanup and original deadline preserved.

**Required tests:** T28–T37; existing P0/P1/P2/history/voice/reliability lifecycle tests.

**Exit/rollout:** G3 passes. Delayed STT/proof/editor changes cannot alter captured knowledge; unavailable optional stores do not block basic dialogue. No production event enrichment is sent yet.

### Phase D — Single C-04 selector, lanes, grounding and safe base

**Change:** new `knowledgeSelector.mjs` and `knowledgeProjection.mjs`; small refactor of P2's existing selection/grounding exports; request preparation services.

Deliver:

1. Pure ordered selector, observer/claim qualification, manual memory pin priority and deterministic omission diagnostics.
2. Six contract lanes with the explicit allowlist, metadata stripping and shared canon budget.
3. Exact Unicode/JSON/role byte accounting, safe base fallback and hypothetical preview.
4. Existing canonical precedence and one canon serialization; no extra store/model call/search service.

**Required tests:** T38–T49; P2 authority/projection regression with four-plus selected memories and multilingual profiles.

**Exit/rollout:** G4 passes. Every lane is inspectable in an in-memory fixture and neither raw scene canaries nor private identifiers escape. Budget pressure preserves highest-ranked qualified safety context and reports overflow.

### Phase E — Connect the production request and patched stock controller

**Change:** `buildCandidate.mjs`, `decide.mjs`, `essentialDecision.mjs`, runSequentialTurn request options, build/native-support manifests and actual stock harness cases.

Deliver:

1. Behavior/scene separation at the source-pinned prompt seam; safe placeholder substitution/appended frame once.
2. Final request renderer in nonstreaming/streaming/early-TTS, player typed/mic/internal/special, retries and disabled/failing identity/profile cases.
3. Private validationContext retained with unchanged action/target fences; exact action filtering and NPC speech-mode compatibility.
4. Safe base serializer as the supported OpenAI route; added perceptions remain off by default.

**Required tests:** T50–T62; full real patched-controller suite and build/isolation verification. Assert final fetch body content, not just mocked selector calls or frame counters.

**Exit/rollout:** G5 passes. A fixture PS2 observation plus PS3 decision travels through the production controller into intercepted Luna request text, and no alternate raw scene route survives.

### Phase F — Delivery, configuration and operational evidence

**Change:** runSequentialTurn completion/terminal helper, IntelligenceClient read/ack wrappers, `bootstrap.mjs`, `e1Config.mjs`, example config, `eventContract.mjs`, optional capability/health display and status docs.

Deliver:

1. C-03 exact successful reasoning acknowledgement, including before early-TTS await; retry/expiry/replaced-key outcomes.
2. Closed default-off PS4 mode, unchanged perception mode, off/shadow/active distinction and capability/build gates.
3. Text-free operational counters/hashes and opt-in accurate private audit; safe optional failures.
4. Phase status checklist showing implemented/built/deployed/GTA-tested separately.

**Required tests:** T63–T73 and full suite/native/build matrix in §15.

**Exit/rollout:** G6 permits GTA shadow preview; G7 permits controlled active baseline acceptance. No automatic deployment or enablement follows from a build/test result.

### Phase G — Optional ACT/radio contributors through the same assembler

**Change only when included:** ACT fact access/provenance/clearing, supported SELF/SITUATION projection; radio branch producer/catalog/witness merge and conversion of `radioContextProjector` into typed contribution.

Deliver:

- ACT read access uses **ActivityFacts** and validated receipts, not `ActivityRuntime.history()`/`historyFor` (those are activity summary history). Add bounded factual snapshot access, proposed `factsForCharacter(binding)`, checking host/world/encounter/incarnation. Existing ActivityFacts records lack that run/incarnation provenance and its clockReset does not clear all facts; add private provenance or clear/filter the existing bounded fact store on reset/retirement. Never expose an old body's fact merely because CharacterId matches. [S34][s-activity-facts] [S35][s-activity-engine]
- Map instructed/accepted to instruction/intent, handler-only to handler outcome, mode_flag to established mode, and world_strong to physical completion. Preserve ActivityFacts' existing downgrade of unsupported arrived/completed. Strip fact/goal/activity/character IDs. Unsupported owner/outcome assertions stay absent. C-05 correlation is required before Luna-issued DO outcomes enter SELF; reuse the existing callback ring and receipt strength rules, not spoken history.
- Reuse radio branch's corrected text-ID catalog, audibility receipts and safe known/unknown song phrasing. Capture the exact observer's qualified radio pool at P0. After accepted input, direct-radio relevance can select **from that frozen pool**; a song arriving during STT waits for the next turn. Selection does not search the live conversation flag or append `[SELECTED AUDIBLE ENVIRONMENT]` to contextText. [S36][s-radio]
- Radio facts go in qualified PERCEIVED and, where appropriate, SITUATION environmental items under PS4's writer. Unknown IDs/wrong station/commercial/stop/change never invent song/preference/listening knowledge. Ordinary player turns remain the initial supported radio request scope; any expansion to other sources needs request tests.

**Required tests:** T74–T81 and contributor-specific GTA cases. **Exit:** G8 only for contributors actually included and validated. This phase does not delay baseline visual perception/manual canon; it must not be marked delivered if the radio branch remains unmerged or C-05 is absent.

## 14. Required tests, with exact oracles and reuse targets

Extend existing test suites/harnesses first. New focused files may be `knowledge-selector.test.mjs`, `knowledge-projection.test.mjs`, and `knowledge-request-integration.test.mjs`; these exercise the new seam/failure modes rather than mirror helper implementation. All provider calls are test doubles under `tools/runTests.mjs`.

### 14.1 Native references, contracts and epoch propagation

| ID | Scenario and assertion | Existing harness / integration point |
| --- | --- | --- |
| T01 | PS and ACT retain the exact same Ped/lifetime: one captureRef/table entry, distinct consumer accounting, no observer promotion from ACT. | Native intelligence unit + activities tests. |
| T02 | Wrapper changed with same full handle/address; address changed; full handle changed; owner lifetime changed: retire old ref, mint new, never resolve old. | EntityAnchors production source tests. |
| T03 | 256 global refs, 16 observers, 32 ACT refs: reject overflow; conversation priority/demotion/return stays atomic and preserves retained lifetimes. | Intelligence integration/ACT tests. |
| T04 | Expiry, owner revoke, entity deletion and host shutdown fan out one retirement; subscribers/indexes release; duplicate shutdown is harmless. | Intelligence integration, P2 lifecycle/runtime tests. |
| T05 | Ordinary actor private capture joins its own observer without promotion/P1 profile; target change between capture/send cannot substitute live conversation. | Native EnrichActor + PS host + companion request fixture. |
| T06 | Owned capture index disagrees with encounter/incarnation/P1 claim: reject owned-profile join; mismatched actor/capture fails perception join. | P1/P2 contract + perception client tests. |
| T07 | Forged/unknown/duplicated/flattened private integration block cannot create a join; disabled P1/P2 still strips it. | Actual EO patched-stock/build harness. |
| T08 | Every existing hello carries the same hostRunId/worldEpoch, distinct local epochs remain distinct; unknown extension versions disable PS4. | P1/P2/PS/ACT actual channel and companion validator tests. |
| T09 | Connection sequence gap/duplicate/old stream/old adapter epoch/reset refresh: no partial or stale index/roster becomes visible. | Perception client/contract + native channel tests. |
| T10 | Clock regression detected once; uint wrap policy tested; PS/ACT/UX subscribers receive one ordered discontinuity; no extra update pump. | P2 lifecycle + PS host continuous/stalled tests. |
| T11 | Host reload/new host ID and future explicit timeline event invalidate old frames; durable stores survive; no re-adoption/replay. | Runtime/P2 lifecycle and companion epoch fixtures. |
| T12 | ACT player target uses shared resolve and current native player incarnation; place `here` remains coordinate-based; target reuse/protagonist switch rejected. | ACT2 native/companion tests. |
| T13 | Real PS output-only Windows pipe publishes hello/index/anchors/situation/observation source frames into production client; malformed/overflow/ACL behavior unchanged. | `testPerceptionInterop.mjs`, native intelligence channel helper. |
| T14 | Changed P1/P2/ACT hello parsing works with real framework serializer/duplex pipes; no arbitrary extra keys or legacy fence weakening. | OwnerFactsTests, ControlChannelTests, `testActivitiesInterop.mjs`. |

### 14.2 Observation semantics, recognition and salience

| ID | Scenario and assertion | Existing harness / integration point |
| --- | --- | --- |
| T15 | Qualified visible injury/death/firing reaches PS2; no receipt means no observation/context; raw episode containing extra attacker/outcome never leaks. | Perception witness/contract + selector tests. |
| T16 | Sampled `injury_state` self receipt reaches self-danger salience with correct self basis/target; callback failure does not invent damage attribution. | ShadowRuntime + native integration fixture. |
| T17 | Mixed auditory/visual revisions keep each claim's source/target/certainty; heard sound does not acquire visible shooter/death from later claims. | Perception correlation + projection tests. |
| T18 | Generic action/location/presence details cannot produce named action/zone/mode; closed supported variants retain only qualified values. | Contract/correlator tests. |
| T19 | Action succeeded true is handler outcome only; report/speech lifecycle without text receipt cannot become player/overheard transcript. | Existing action/witness/speech tests + projection. |
| T20 | Wrong observer, wrong native run, expired item, retired source/target, mismatched observation ID/revision/key all omitted. | ObservationStore bounded snapshot + selector tests. |
| T21 | Actual normalized activity covers driver/passenger/unknown; expired/missing/scripted/suspended state never becomes idle/following. | Native C-14 + salience adapter tests. |
| T22 | ACT detach while native follow/sit persists: no unconditional idle/none owner assertion. | ActivityDispatch/P2 mode + C-06 tests if exposed. |
| T23 | Proof-backed own profile revisions/relationship/tags change existing PS3 policy inputs; prose/near-match tags do not. | Salience engine + P1/P2 service fixtures. |
| T24 | Backend-known participant without explicit recognition remains anonymous; no borrowed profile/private memory/relationship. | Identity + salience + projection tests. |
| T25 | Explicit validated recognition fixture permits intended existing prior_memory/relationship logic; revoked/wrong-incarnation recognition does not. | Salience engine contract test; live capability stays off until provider exists. |
| T26 | Cache snapshot contains matched observation/situation/decision; policy refresh uses same ranker; preview read/retry does not regrant or mutate decisions. | Salience engine/client tests. |
| T27 | Repetition, severity escalation, capacity and important-event-among-routine pressure keep existing entitlement rules; missing paired inputs are counted. | Salience engine + bounded selector pressure tests. |

### 14.3 Frozen canon, input and lifecycle

| ID | Scenario and assertion | Existing harness / integration point |
| --- | --- | --- |
| T28 | Edit selected memory/personality/relationship during delayed proof/STT: this request keeps captured revision; next turn sees edit. | P2 lifecycle + OpenAI connection delayed fixture. |
| T29 | First owned turn verifies matching frozen candidate; mismatch/revoke/conflict cannot release it. Newly loaded profile after freeze waits for next turn. | P1/P2 service and identity evidence tests. |
| T30 | First ordinary/unbound actor gets valid perceptions with no persistent profile; profile/store errors use safe session/basic context. | P0/P2/knowledge request fixture. |
| T31 | Frozen salience does not incorporate later proof/profile/event revision; next generation captures new view. | Connection + selector tests. |
| T32 | Later realtime context, listener/world refresh, conversation target change cannot alter a captured frame; explicit null differs from omitted. | Existing P0 turn-context/stock-controller tests. |
| T33 | Accepted player input committed once; prior history frozen before current input; no duplicate current utterance in role messages. | DialogueHistory and TTS/history suites. |
| T34 | Special/internal source has no player-history commit or fake transcript; unknown trigger Content stays absent from request. | Stock special hydration/controller tests. |
| T35 | Model/STT retries reuse narrative bytes/selected keys and original deadline; no new knowledge lookup after freeze. | Reliability + provider contract tests. |
| T36 | Supersession/cancel/reset/actor retirement ignores late STT/model/PCM/ack; successor stays isolated; retained snapshot released. | Native/stock lifecycle + transport tests. |
| T37 | Existing voice/name assignment stable; acting direction uses frozen canon revision and 4000-character bound. | Voice/profile/character-aware connection tests. |

### 14.4 Projection, pin priority and budgets

| ID | Scenario and assertion | Existing harness / integration point |
| --- | --- | --- |
| T38 | Exact six lanes, one producer/writer, model rendering excludes private frame envelope and identifiers. | New projection contract tests. |
| T39 | Four-plus selected memories remain in importance/ID order when they fit; unselected never enters; no hidden three-record cap. | Existing P2 profiles/authority + projection. |
| T40 | Duplicate canon absent from actor/system/recall copies; fixed identity/personality precedence retained, memory IDs removed after sorting. | P2 authority and final request tests. |
| T41 | RelatedCharacterIds inform private relevance only under recognition; record IDs/notes/appearance/alias/proof do not appear in text. | P2/profile + canary projection tests. |
| T42 | Unicode including emoji, CJK, combining characters, quotes/backslashes/control escaping: valid encoding and exact final serialized bytes. | Projection byte-bound fixtures. |
| T43 | Per-lane/shared canon/total body bounds all apply; adding role framing or double escaping cannot exceed the limit. | Final body assertion, not character-length approximation. |
| T44 | Large selected pins/history/routine events cannot displace reserved highest-ranked safety claims; deterministic safety overflow/drop counts. | Selector pressure tests. |
| T45 | Same frozen inputs produce byte-identical projection/hash under Map insertion order variation where contract order is irrelevant. | Determinism test with equal-rank IDs. |
| T46 | All unknown/missing fields project unknown, not false/idle/empty evidence; absent listener and explicit null retain semantics. | P0/COMPAT allowlist tests. |
| T47 | Invalid item detail is omitted without losing other valid claims; qualification prefix cannot be truncated into a stronger claim. | Claim renderer boundary tests. |
| T48 | Only valid user/assistant prior role messages; history trimmed by whole oldest messages; current input once and mandatory limit explicit. | History/request budget tests. |
| T49 | Projection exception, unsupported contract or oversized mandatory template/input fails safely; no raw fallback body is fetched. | Failure-injection + request interception. |

### 14.5 Production request integration and regressions

| ID | Scenario and assertion | Existing harness / integration point |
| --- | --- | --- |
| T50 | Actual patched Essential controller -> beginTurn -> PS2/PS3 frozen item -> final intercepted Responses body contains qualified event. | `stock-harness.mjs`, new request integration test. |
| T51 | Two actors know different events; final bodies isolate observations/canon/history even with overlapping timing. | Multi-actor stock-controller fixture. |
| T52 | Typed and mic input both enriched; STT accepts once; mic completion creates no third-party hearing. | OpenAI transport + speech/controller suites. |
| T53 | Nonstreaming, streaming buffered_action/dialogue_only, early TTS all render same narrative input. | Streaming + stock-controller tests. |
| T54 | Every raw ingress gets a unique canary: finished systemInstruction, actor, listener, world, integrations/raw, contextText, realtime context, internal Content, generated persona. None reaches final request. | Actual BK/EO/serializer interception with P1/P2 enabled/disabled/failing. |
| T55 | Trusted stock behavior/action declarations survive separation; scene placeholders render safe lanes once; templates without placeholders also work. | Exact stock functions AST harness. |
| T56 | Current action list matches validator availability; changing P/V binding after model rejects rebound target; one action dispatch only. | Existing decision/action/P0 target tests. |
| T57 | Weapon/vehicle/held-item action affordances remain usable when verified; unsupported inventory/target cannot be authorized by narrative. | Stock action dispatcher + decision validator tests. |
| T58 | NPC direct-speech mode behavior retained; listener-private canon never donated. | Actual BK/controller tests. |
| T59 | Optional services disabled/null/unavailable still use safe request renderer; no raw modelActor fallback. | Runtime/bootstrap + request tests. |
| T60 | Current input, committed history, canon and projected fact each occur in exactly one intended role/allocation. | Final body exact-value assertions. |
| T61 | Early TTS cancellation, segment/action mode, native auth/exact interrupt, PlaybackEnded assistant commit unchanged. | Full E1/E5/E6 native/stock/TTS regressions. |
| T62 | Stock Gemini avoids PS4/OpenAI stack and retains existing lifecycle/context/resume behavior. | Build/isolation + Gemini stock-controller tests. |

Place negative canaries in forbidden metadata/narrative fields and legacy assembled scene strings. Add positive controls proving that legitimate bounded world labels, deliberately selected authored memories and genuine current user text still survive. An allowlist is not a blanket keyword deletion filter; it must preserve authorized descriptive data while excluding unchecked ingress.

### 14.6 Acknowledgement, gates and optional contributors

| ID | Scenario and assertion | Existing harness / integration point |
| --- | --- | --- |
| T63 | Freeze/render/fetch-start do not ack; valid final reasoning result acks each delivered selected key once. | RunSequentialTurn + SalienceCache. |
| T64 | Early TTS fails after final model success: ps4 delivered retained, assistant history discarded. Partial stream without final result: no delivered. | Delayed early-TTS/model fixtures. |
| T65 | Retry fails then succeeds: one delivered, no intermediate final rejection; all fail/refusal/invalid JSON: rejected only. | Provider executor + request integration. |
| T66 | Budget-dropped/unsupported/preview items never delivered; current exact keys succeed, replaced/expired keys return safe false. | Ack/frozen-key tests. |
| T67 | Superseded late result/reset cannot ack successor; PS4 outcomes never consume/regrant PS6 response entitlement. | Salience engine + lifecycle test. |
| T68 | Config default/unknown mode off; intelligence shadow alone sends no events; active needs contract/host support. | Config/perception-bootstrap tests. |
| T69 | Off and shadow final request bodies equal safe base; preview no action/turn/history/memory/ack mutation; active differs only by authorized lanes. | Bootstrap/controller with effect spies. |
| T70 | Normal JSONL only approved scalar data; no prompt/canon/transcript/UUID maps/free errors; private audit requires explicit opt-in. | Observability/event contract/dialogue trace tests. |
| T71 | Telemetry sink/report/projection optional error preserves authorization, correct deadline and cleanup. | Observability/reliability failure injection. |
| T72 | Manifest/extension/native pins consistent; unknown version/hash rejects only affected capability; no stock input/core DLL rewriting. | Build/isolation/native-support tests. |
| T73 | Repeated turns/epochs/pressure leave bounded refs/cache/frame retention; no extra sampler, observer slot, callback subscription or model call. | Native continuous/stalled host + companion load fixture. |
| T74 | ACT instructed/accepted/handler/mode/world_strong map to different SELF strengths; unsupported completed/arrived downgraded. | Existing ACT facts/receipt tests + projection. |
| T75 | ACT facts from prior host/world/encounter/incarnation are absent after reset/retirement; display history is not substituted. | ACT engine/fact snapshot tests. |
| T76 | C-05 exact tuple/action callback window, interruption, mismatch, late callback: no fabricated execution or replay. | ACT callback ring + dialogue-action receipt tests, only if implemented. |
| T77 | Radio frozen exact observer, later live conversation changes/STT song change cannot alter current request. | Reused radio branch + request fixture. |
| T78 | Unknown ID, wrong station, commercial, stop, silence and unenclosed/enclosed audibility cases preserve branch evidence/unknown phrasing. | Radio branch producer/catalog/witness/projector tests. |
| T79 | Radio/ACT contribute lane items only; old prompt block/contextText append cannot appear; all active paths use one writer. | Final request canary/integration tests. |
| T80 | Direct radio query selects from frozen pool; unsupported source/query produces no fabricated relevance/extra model call. | Radio relevance/request test. |
| T81 | Contributor unavailable or old version leaves baseline event/canon enrichment intact; contributor gate remains off until physical evidence. | Capability/fallback/bootstrap tests. |

## 15. Required regression/build matrix and rollout gates

### 15.1 Reproducible offline checks for implementation commits

From `lsa-essential-e1-candidate/`:

```powershell
node tools/runTests.mjs
node tools/buildCandidate.mjs
node tools/buildCharactersAddon.mjs
node tools/testPerceptionInterop.mjs
node tools/testActivitiesInterop.mjs
```

The native addon build requires the already established compile-only RPH/framework/DamageTracker/RAGENativeUI references and their pinned hashes. Use `LSA_IDENTITY_RPH_REFERENCE`, `LSA_IDENTITY_FRAMEWORK_ROOT`, `LSA_INTELLIGENCE_DAMAGE_REFERENCE`, `LSA_RNUI_REFERENCE`, and optionally `LSA_BUILD_DOTNET` as documented in [the existing native README][s-native-readme]. Do not install another tracker/plugin or copy SDK/core/game dependencies into the package. Interop helpers must be built at the tool's default **Debug/net481** path, or supplied explicitly as an argument; running only a Release helper while using the default path is not a valid fresh test.

From the repository root, build/run these production-source harnesses:

| Project / harness | Why PS4 needs it |
| --- | --- |
| `native/session-identity/tests/OfflineTests.csproj` | Identity lifetime/authority policy. |
| `native/session-identity/facts-tests/OwnerFactsTests.csproj` | Real changed P1 hello/factual pipe and proof parser. |
| `native/promoted-characters/tests/OfflineTests.csproj` | Existing P2 admission/safety policy. |
| `native/promoted-characters/facts-tests/ControlChannelTests.csproj` | Real changed P2 control hello/parser/serializer. |
| `native/promoted-characters/host-tests/HostTests.csproj` | Host installation/fiber/registration behavior. |
| `native/promoted-characters/runtime-tests/RuntimeTests.csproj` | Shared host service initialization/dependency isolation. |
| `native/promoted-characters/lifecycle-tests/LifecycleTests.csproj` | Centralized world reset, owner retirement/recovery. |
| `native/promoted-characters/bridge-tests/BridgeTests.csproj` | Existing DomainHost/typed console bridge and exact current actor. |
| `native/promoted-characters/ps-host-tests/PSHostTests.csproj` | Run `continuous`, `stalled`, `stop`, `failed`; status fiber does not become an extra native sampler. |
| `native/intelligence/tests/IntelligenceTests.csproj` | Actual shared anchor/policy/channel/callback source. |
| `native/intelligence/integration-tests/IntegrationTests.csproj` | Exact EnrichActor association/situation/publication and native reset source. |
| `native/activities/tests/ActivityTests.csproj` | ACT target ref reuse, hello, leases/receipts/mode completion and no replay. |
| `native/enhanced/input-tests/InputTests.csproj` | UX4/P2 mode/reset integration and unchanged committed-partner ownership. |

For net481 harnesses, the established pattern is:

```powershell
dotnet build native/intelligence/tests/IntelligenceTests.csproj "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/intelligence/tests/bin/Debug/net481/IntelligenceTests.exe
```

Use each project's actual target framework/output path; policy harnesses targeting .NET 10 may run through `dotnet run --project`. Do not execute game assemblies as a substitute for the offline fakes. The native project has explicit Compile lists: add proposed HostContext/source links to `PromotedCharacters.csproj` and affected harness projects. P1 is a separately referenced library; pass run/epoch primitives/delegates into its existing integration rather than introducing a P1-to-P2 project dependency or circular reference.

`buildCandidate` verifies native/identity/character/perception metadata and exact AST/source pins. Existing ACT/controls verification/build tests remain required when their hello/RefSlot contracts change. Update local private extension manifests separately from Essential's unchanged audio/native protocol flags; `nativeProtocolChanged:false` must not be misread as permission to omit testing the changed private pipe schemas.

For every implementation commit, record exact source SHA, test command/exit status/counts, source/contract/build hashes, disabled default config and generated payload manifest. Historical counts and tests of an earlier branch are provenance, not a fresh pass. Offline pipeline tests capture provider doubles; they do not call Luna, run GTA, prove physical witnessing, or mark deployment done.

### 15.2 Gate definitions

| Gate | Required evidence | What becomes eligible |
| --- | --- | --- |
| G0 — baseline reconciled | Source/main/PR21 SHA recorded; relevant locked contracts unchanged; actual callback/hearing/profile gaps classified. | Implementation begins on audited source; no new architecture research. |
| G1 — shared identity/fencing | Phase A native/companion/real-pipe tests pass; one table/detector; exact ordinary/owned actor joins and reset/retire failures. | C-02/C-13 can be consumed by a frame; no prompt enrichment yet. |
| G2 — qualified situation | Phase B tests pass; real C-14 provider revisions feed PS3; self-injury repaired; unsupported producer/recognition cases remain unknown. | Current PS2/PS3 paired inputs are usable; no unsupported claims. |
| G3 — frozen inputs | Delayed proof/STT/edit/supersession/retry tests pass; no live profile/observer/history substitution; original deadline preserved. | Frame assembly can be used at the existing turn seam. |
| G4 — projection boundary | All lane/Unicode/budget/pin/canary tests pass; one canon serialization; safe fallback works. | Safe base serializer and unsent preview ready for controller integration. |
| G5 — actual request wired | Intercepted final bodies from every real patched-controller OpenAI path contain correct lane data and no raw canaries; action/Gemini/E1–E6 regressions pass. | Request hardening may ship default-off additional perception. |
| G6 — reproducible payload/preview | Fresh complete companion/native/interop/build/isolation matrix passes; matching source/manifest hashes; explicit off/shadow config and ack/telemetry tests. | Controlled GTA shadow preview; no PS4 delivery or autonomy. |
| G7 — active baseline accepted | GTA01–GTA14 and GTA17–GTA19 below pass on the same payload; mandatory negative/canary tests have zero leaks; request inclusion and useful conversation both observed. | Explicitly enable baseline PS4 for requested OpenAI turns only. |
| G8 — optional contributors accepted | Specific ACT/radio/C-05 tests and GTA15/GTA16 pass on a recorded matching payload and existing capability/probe gates. | Only the validated contributors become active. |

Roll back by setting `dialogueKnowledge.mode:'off'` and preserving safe base request hardening; shut down/restart the affected optional channel if its host association is invalid. A full payload rollback restores the previous recorded payload/config under the established deployment procedure. Do not use a raw-request bypass as recovery or delete durable profiles. No deploy/merge/GTA launch is performed by this plan.

## 16. GTA acceptance: prove request delivery and useful conversations separately

For each case, record payload manifest hash, repository/source SHA, Core/DamageTracker/RPH/game version, config, actor/source tuple privately, host/world/frame/request hashes, source observation/decision revisions, permitted operational counters and observed reply. Private prompt capture requires explicit audit logging; keep canon/transcripts out of ordinary committed operational reports. Record pass/fail/unsupported/not-run separately.

Run controlled paired trials with fixed world conditions and fresh turn/history state where needed. Inspect the **actual sent request**, then the spoken reply/playback. A plausible reply without request evidence can be a guess; a hash/counter without useful reply proves wiring only. Require three consecutive controlled repetitions per mandatory scenario, with zero cross-observer/private-state leaks or stale actions. Repetition count and companion capture-time p95 target below are proposed PS4 acceptance criteria, not historical accomplishments.

| ID | Setup / player request | Required request and behavior evidence |
| --- | --- | --- |
| GTA01 | Ordinary NPC A faces a controlled sampled injury/firing; ordinary NPC B is outside cone/behind obstruction. Ask each “What just happened?” while their observations remain current. | A request contains its qualified event; B contains no unwitnessed event/attacker/outcome. A acknowledges what it saw; B expresses lack of knowledge. Neither is promoted. Verify actual observer admission for both. |
| GTA02 | Repeat with promoted A, ordinary B and two overlapping requested turns; change selected target after capture. | Each final request uses captured actor association/canon/history; no live conversation donation or generated successor identity. |
| GTA03 | Injure the controlled actor with sampled injury evidence; ask “Are you hurt?” | Qualified self `injury_state` reaches self-danger salience and request. Reply reflects supported injury without invented attacker/weapon. Direct callback counters are recorded independently. |
| GTA04 | An NPC sees injury but cannot see later death; another sees dead body. Ask about the subject. | First frozen request does not gain death from shared episode/later revision; second can say it saw the subject dead, with no invented killer/causal account. Use observations captured before/after escalation intentionally. |
| GTA05 | Backend owns/knows a participant's identity, but observer lacks recognition. Ask “Who was that?” | No private name/profile/relationship/memory reaches observer request. Reply identifies only supported anonymous/public evidence or says unknown. Actual recognition remains off unless proven. |
| GTA06 | Promote/edit actor with biography/personality/relationship and four-plus selected memories; include a unique selected memory relevant to “What did we agree about our next visit?” | Authored memory appears once in final request, ordered/qualified as selected canon; reply uses it naturally. Unselected/private-note canary absent; generated persona cannot override authored identity. |
| GTA07 | Large multilingual selected canon/history plus routine event pressure and one significant injury/death. Ask about immediate event. | UTF-8/JSON budgets and deterministic dropped-pin counts agree with request; highest-ranked safety evidence survives optional clutter; no broken Unicode, duplicated canon or unreported safety overflow. |
| GTA08 | Delay mic STT; edit a selected memory and produce a new event/song while the turn is pending. | This request keeps frozen profile/observation revision; next requested turn sees supported updates. Accepted STT only fills genuine current input once. |
| GTA09 | Known supported vehicle/follow/wait situation, then ACT detach/residual native mode; ask about current activity. | C-14 supplies supported sampled mode or unknown; no “idle/arrived/completed” from stale Encounter.Mode or handler-only outcome. PS3 request diagnostics show real activity/policy input. |
| GTA10 | Typed, mic, supported special/internal, nonstreaming, structured streaming and early-TTS conversations. | Same knowledge boundary in every final request; internal source has no fake player speech; user input once; playback/history follow existing successful-completion rule. |
| GTA11 | Supersede/cancel mid-STT/model, release/despawn an owned actor, reconnect pipe, reload host or trigger a controlled game-clock discontinuity. | Old frame cannot be delivered/acknowledged to successor; exact generation cancellation, safe empty perception after reset, no stale native action or automatic re-adoption. Distinguish channel reconnect from new host. |
| GTA12 | Force a retryable reasoning failure then success, and a separate final reasoning success followed by TTS/playback failure. | Same frozen narrative across retries; delivered once for successful final reasoning. TTS failure preserves ps4 delivery but discards assistant history; all-model-fail has no delivered acknowledgement. |
| GTA13 | Request includes observation revision N; N+1 arrives before success/ack. | Request remains N; exact N key returns delivered only if still retained, otherwise ack_key_retired. N+1 is never consumed by the old turn; no PS6 entitlement consumption. |
| GTA14 | `off`, then `shadow`, then explicitly gated `active`, and unavailable/mismatched PS support. | Off/shadow safe-base bodies equivalent; no preview effects/acks; active adds supported observation lanes to the already requested turn. Missing support falls back safely with an honest status. |
| GTA15 | **Optional radio:** known song/commercial, wrong station/unknown ID, stop and song change; A audible, B not audible. Ask “What's playing?” | Exact frozen witness request names only verified content; unknowns remain unknown; later STT-time song not substituted; no preference invented. Mark unsupported if radio contributor is unmerged/off. |
| GTA16 | **Optional ACT/C-05:** player instruction, handler acceptance, sampled mode, world-strong outcome; interrupt dialogue playback after a Luna DO. | SELF uses correct strength and exact current actor/receipt; handler success never claims arrival. Interrupted speech does not erase a proven action receipt. Mark unsupported if C-05/physical capability probes absent. |
| GTA17 | Existing UX4 direct hold/tap selector, stock Talk fallback, player action/vehicle/weapon target and PCM cancellation flows. | Fresh UX4 refinement acceptance plus unchanged exact recipient/action/authorization/PlaybackEnded semantics. No duplicate Talk/action/assistant-history commit, no partner clear on PTT release. |
| GTA18 | Stock Gemini run plus OpenAI with optional identity/profile stores disabled/unavailable; test controlled raw-context canaries through actual integration fixture/audit. | Gemini retains stock route. Every OpenAI final request has safe allowlist and no raw canaries/private integration data, including fallback paths; ordinary safe conversation still works. |
| GTA19 | 30-minute scene-changing soak, 16-observer pressure, ordinary/owned churn, large profiles and provider delay. | Bounded queues/refs/frame retention; no new polling/tracker/model calls, salience faults/leaks/stale actions; actual total native p95 Update cost recorded against the existing ≤1 ms added-total target. Proposed companion synchronous capture+projection p95 ≤5 ms on target setup. Missed/deferred witness samples stay visible. |

The existing ≤1 ms added total native Update target is **unverified** and cannot be inferred from separate 1 ms discovery/sampling guards. Measure it; if unmet, keep active rollout gated and optimize the bounded integration using the same architecture. Do not expand LOS/range or bypass witness qualification to improve a reply. [S37][s-ps-status]

General heard-gunshot/nearby player-speech scenarios are **not mandatory live baseline passes** on main's current producer coverage. Auditory epistemic separation is mandatory offline (T17); live audibility is a separate producer gate, and player speech requires C-01. If testing actual hearing without those prerequisites, expected result is no invented hearing/identification, with status unsupported. Do not mark the larger PS2 speech or damage-producer acceptance complete from PS4 visual success.

## 17. Definition of done and implementation handoff

- [ ] G1–G6 passed on one source/contract/build payload; all required test results recorded with exact SHA, not reused historical totals.
- [ ] C-02 one-table actor join, C-13 host/world fences, C-14 supported real situation and C-04 sole renderer implemented together.
- [ ] PS2 qualified observations and PS3 decisions are present in actual requested Luna bodies for ordinary and promoted actors; selected P2 memories are reused with current canon precedence.
- [ ] All raw narrative ingress/canary and identity/lifetime failures verified; safe basic conversation survives optional-system failure.
- [ ] Frozen revision, retry/deadline, exact acknowledgement, action/reference, partner/playback/history and Gemini regressions pass.
- [ ] G7 mandatory GTA cases observed and useful qualified replies recorded; unsupported hearing/damage/recognition/future-memory capabilities remain explicitly gated.
- [ ] Optional ACT/radio/C-05 contributors, if included, separately satisfy G8; no second prompt block or claim of unvalidated physical completion.
- [ ] Existing status docs/config examples/manifests/corpus indexed; implemented, built, deployed and GTA-accepted states recorded independently.

The implementation handoff is Phases A–F first, then only the optional contributors actually in scope. Reuse the existing host, anchor/store/ranker/canon/turn/request/receipt infrastructure. Do not reopen settled architectural questions, migrate ProfileStore for manual-memory reuse, enable hearing from STT, or implement PS5/PS6/PS7 under this task.

## 18. Verification performed for this plan

This document was checked against the pinned source, PR #21, the active corpus/contract register and current main. The plan contains proposed implementation work and required tests; none of T01–T81 or GTA01–GTA19 is being reported as a PS4 implementation pass.

The preceding PR #21 audit ran the existing main companion suite with **407 passed, zero failed/skipped** and validated the indexed corpus/source citations. That is fresh baseline evidence from this conversation, not PS4/GTA acceptance. This follow-up changes documentation only; it does not rerun native builds, deploy a payload, call Luna, launch GTA or implement production code. Its own publication checks cover corpus navigation, pinned reference resolution, test/gate cross-references, documentation whitespace and a documentation-only Git diff.

## 19. Pinned source index

Publication validation: **56 pinned references/source files** resolved, **8 stock-function byte ranges** verified against the pinned input hash, **81 test cases / 19 GTA cases / 9 gate definitions** cross-checked, and corpus validation passed with **39 documents, 17 decisions, 15 contracts and 12 entry/domain navigation documents**. Documentation whitespace and the documentation-only diff passed. Remote main and PR #21 head were rechecked before publication and matched the audited inputs.

Every item below links to the exact reviewed source revision. Proposed new files/functions are specified in the plan and intentionally have no claim of existing source. For the minified stock file, the named function and byte offsets are reproducible against the pinned builder input.

| ID | Source and verified integration point |
| --- | --- |
| S01 | [bootstrap][s-bootstrap]: runtime construction, shadow-only IntelligenceClient, optional ACT binding, transcript service at lines 93–118. |
| S02 | [essentialGlue][s-glue]: createRuntime/services/modelActor and hostFor preparation/current gates, lines 17–103. |
| S03 | [RuntimeEntry][s-runtime]: single owner fiber, initialization ordering, optional PS/ACT and status loop, lines 19–62. |
| S04 | [EntityAnchors][s-anchors]: lifetime match, validation, quotas/priority, revoke/cleanup, lines 22–65. |
| S05 | [IntelligenceChannel][s-native-channel]: output-only hello/sequence/bounded transport; existing channel epoch. |
| S06 | [IntelligenceIntegration][s-native-intel]: private anchor ownership, native initialization/reset, discovery/witness/sample, callback and empty EnrichActor, lines 26–322. |
| S07 | [PromotedCharactersIntegration][s-p2-native]: encounter/P1 roster, initialization/retirement, EnrichActor and action callback, lines 17–99 and 286–295. |
| S08 | [perception contracts][s-contracts]: bounds/config, closed frames, observation/claim details and empty recognition list, lines 3–62. |
| S09 | [ShadowRuntime][s-shadow]: expire/reset/ingest/self receipts, generic noteSalience and disabled transcript gate, lines 19–138. |
| S10 | [IntelligenceClient][s-client]: existing transport/runtime shell, telemetry projection and reconnect, lines 68–145. |
| S11 | [ObservationStore][s-observations]: immutable records, store bounds and no read API, lines 2–16. |
| S12 | [EpisodeCorrelator][s-correlator]: event mapping, episode/observer separation and generic claim details, lines 3–77. |
| S13 | [salience engine][s-salience]: existing situationFromCharacterView, policy/ordering, cache/ledger/ack, lines 126–157 and 258–453. |
| S14 | [IdentityResolver][s-identity]: async fresh proof, incarnation association, runtime binding and optional deadline, lines 59–137; [RuntimeBindings][s-bindings] holds private immutable session/character bindings. |
| S15 | [CharacterService][s-character]: current live profile read/canon append and acting input, lines 60–94. |
| S16 | [ProfileStore][s-profiles]: v1 schema/limits/validation/immutable get/list, lines 7–87. |
| S17 | [sessionProfiles][s-canon]: session allocation, 16 KiB allowlist, pin sorting and Unicode truncation, lines 14–166. |
| S18 | [OpenAIConnection][s-connection]: beginTurn snapshot, realtime merge, launch and preparation, lines 56–147 and 273–339. |
| S19 | [runSequentialTurn][s-sequential]: preparation/STT/history/model variants/reasoning result/TTS/playback phases, lines 169 onward. |
| S20 | [turnSnapshot][s-snapshot]: immutable clone and private P/V reference map, lines 23–57. |
| S21 | [decisionValidator][s-validator]: current native target comparison, weapon/capability gate and dispatch transcript, lines 12–71. |
| S22 | [essentialDecision][s-request]: current raw request serializer, role messages, output schemas and explicit private audit, lines 53–111. |
| S23 | [buildCandidate][s-build]: source pins/48 patches, WP/Xn/qK/BK/EO exact AST integration, lines 15–18 and 86–162. |
| S24 | [pinned stock bundle][s-stock]: `BK` bytes 843358–844096; `EO` 355540–356343; `ET` 399626–400250; `qM` 399493–399626; `dM` 381951–382996; `FM` 399157–399458; `mT` 396226–397993; `GM` 398741–399157; `ra/na/cM/ia/AO/CO` also inspected. |
| S25 | [SessionIdentityIntegration][s-identity-native] and [OwnerFactChannel][s-owner-channel]: independent clock recovery/current owner evidence and strict hello/proof wire. [OwnerEvidence][s-owner-client] verifies the companion side. |
| S26 | [ActivityDispatch][s-activity-world]: private entity captures, sampled modes, BeginOwnership/EndOwnership and AnchorLive, lines 22–159. |
| S27 | [ActivityChannel][s-activity-channel] and [ActivityCommands][s-activity-host]: local ACT nativeRun/adapterEpoch/hello and host callback/reset machinery. |
| S28 | [WitnessPolicy][s-witness]: supported visual kinds, self/visual qualification, pure audibility branch, lines 24–48. |
| S29 | [characterAuthority][s-authority]: existing generated persona suppression, canon grounding and duplicated JSON append, lines 4–26. |
| S30 | [decide][s-decide]: both request modes and final response parsing, lines 14–87. |
| S31 | [eventContract][s-events]: scalar event/key allowlist; extended events must be explicitly admitted. |
| S32 | [DialogueTrace][s-trace]: existing explicit private request/transcript logging, separate from standard operational telemetry. |
| S33 | [DialogueHistory][s-history]: genuine player dedupe, staged assistant and successful playback commit, lines 28–76. |
| S34 | [ActivityFacts][s-activity-facts]: bounded factual records and downgrade of unproved completion, lines 10–23; [ActivityRuntime][s-activity-runtime] history method is summary history. |
| S35 | [ActivityEngine][s-activity-engine]: historyFor, actor facts, clockReset and recorded evidence; current fact records are not run/incarnation stamped. |
| S36 | [radioContextProjector][s-radio] at **unmerged radio commit**: live conversation observer, current store query, safe phrasing and direct-query selector; conversion required. |
| S37 | [PS0/PS1 status][s-ps-status]: existing limits, unverified native p95 target, real interop and open physical/hearing gates; [PS3 status][s-ps3-status] gives observed shadow results. |
| S38 | [native addon README][s-native-readme]: compile-only references, existing offline harness/build/deployment separation. |
| S39 | [stock harness][s-stock-harness]: actual patched stock declarations with provider/native I/O substitutes. |
| S40 | [P2 ControlChannel][s-control-channel] and [NativeOwnerClient][s-control-client]: current one-request hello and strict response parser. |
| S41 | [native addon project][s-native-project]: explicit Compile list and separate P1 library dependency. |
| S42 | [perception interop][s-ps-interop], [ACT interop][s-act-interop] and [test runner][s-run-tests]: real Windows helpers versus offline provider tests. |

[authority-update]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/3e1375258d6f4d45fb3a68cf738c4f06a56ec41e/docs/research/PS4-dialogue-knowledge-update-20261008.md
[authority-contracts]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/research/system-contract-register.md#L136
[authority-decisions]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/research/DECISIONS.md#L5
[authority-convergence]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/research/system-convergence-architecture.md#L7
[s-bootstrap]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/bootstrap.mjs#L93
[s-glue]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs#L17
[s-runtime]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/RuntimeEntry.cs#L19
[s-anchors]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/intelligence/EntityAnchors.cs#L22
[s-native-channel]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/intelligence/IntelligenceChannel.cs#L31
[s-native-intel]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/intelligence/IntelligenceIntegration.cs#L26
[s-p2-native]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/PromotedCharactersIntegration.cs#L44
[s-contracts]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/contracts.mjs#L3
[s-shadow]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/shadowRuntime.mjs#L19
[s-client]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/intelligenceClient.mjs#L68
[s-observations]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/observationStore.mjs#L2
[s-correlator]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/episodeCorrelator.mjs#L59
[s-salience]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/salienceEngine.mjs#L126
[s-identity]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/identity/identityResolver.mjs#L59
[s-bindings]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/identity/runtimeBindings.mjs#L11
[s-character]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/characterService.mjs#L60
[s-profiles]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/profileStore.mjs#L7
[s-canon]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/sessionProfiles.mjs#L68
[s-connection]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/openai/openaiConnection.mjs#L56
[s-sequential]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L169
[s-snapshot]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/context/turnSnapshot.mjs#L23
[s-validator]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/context/decisionValidator.mjs#L12
[s-request]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/context/essentialDecision.mjs#L53
[s-build]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/tools/buildCandidate.mjs#L86
[s-stock]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/upstream/server.bundle.mjs
[s-identity-native]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/session-identity/SessionIdentityIntegration.cs#L91
[s-owner-channel]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/session-identity/OwnerFactChannel.cs#L48
[s-owner-client]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/identity/ownerEvidence.mjs#L61
[s-activity-world]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/ActivityDispatch.cs#L42
[s-activity-channel]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/activities/ActivityChannel.cs#L38
[s-activity-host]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/ActivityCommands.cs#L31
[s-witness]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/intelligence/WitnessPolicy.cs#L24
[s-authority]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/characterAuthority.mjs#L10
[s-decide]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/openai/decide.mjs#L14
[s-events]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/observability/eventContract.mjs#L1
[s-trace]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/observability/dialogueTrace.mjs#L1
[s-history]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/memory/dialogueHistory.mjs#L28
[s-activity-facts]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/activities/activityFacts.mjs#L10
[s-activity-runtime]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/activities/activityRuntime.mjs#L25
[s-activity-engine]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/activities/activityEngine.mjs#L112
[s-radio]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/ad6cad61a0108f40e9ed2e738be756c63ab05350/lsa-essential-e1-candidate/src/perception/radioContextProjector.mjs#L62
[s-ps-status]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/PS0-PS1-perception-status.md#L79
[s-ps3-status]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/PS3-deterministic-salience-status.md#L62
[s-native-readme]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/README.md#L5
[s-stock-harness]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/tests/stock-harness.mjs#L11
[s-control-channel]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/ControlChannel.cs#L53
[s-control-client]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/nativeOwnerClient.mjs#L30
[s-native-project]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/PromotedCharacters.csproj#L1
[s-ps-interop]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/tools/testPerceptionInterop.mjs#L7
[s-act-interop]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/tools/testActivitiesInterop.mjs#L7
[s-run-tests]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/tools/runTests.mjs#L1
[s-native-support]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/nativeSupport.mjs#L5
