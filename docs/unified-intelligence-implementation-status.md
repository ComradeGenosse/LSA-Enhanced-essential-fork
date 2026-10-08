# Unified intelligence implementation status

Updated October 8, 2026. Implementation branch: `feature/unified-intelligence-implementation-20261008`. Starting main: `d4231254354d2f2d7f2c269fb388b9621f9d5895` (PRs #21/#22 merged).

Authority remains the [master plan](research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md), [PS4 specification](research/PS4-code-level-implementation-plan-20261008.md), D-001–D-017 and C-01–C-15. This ledger records branch work; it does not advance main, installed, enabled or GTA-accepted status. The full implementation goal is unfinished.

## Checkpoint 1: phase 1 native shared-reference foundation

Implemented on this branch:

- RuntimeEntry allocates one RAM HostContext and passes it to P2 and PS. It supplies one host UUID, world epoch, monotonic clock and the existing EntityAnchors service. No additional fiber, sampler, plugin, executor or endpoint is created.
- EntityAnchors accounts for closed PS/P2/turn/ACT consumers; shared consumers occupy one entity entry. ACT is limited to 32 distinct refs, the existing global bound remains 256 and PS observer admission remains limited to 16. ACT/P2 cannot request observer promotion.
- Retirement carries a closed reason, frees consumer capacity, rejects throwing validators, and fans out despite a failed optional subscriber with a bounded fault counter.
- P2 Core Update owns shared cleanup and wrap-safe game-clock discontinuity detection. PS uses the supplied host clock and reset notification. Standalone PS harnesses retain an isolated fallback host. Optional PS shutdown cannot clear shared P2 refs.
- ACT's duplicate Ped/address dictionaries are removed. Existing player-target resolve, dispatch, sample and liveness checks use the shared table; place refs and existing activity leases are retained. Player target liveness rejects a protagonist switch.
- P2 encounter reuse requires the exact supplied wrapper/full handle/address and current shared captureRef. Promotion refreshes the owner lifetime; capture-ticket registration rechecks that exact lifetime. Terminal PS sampling precedes owner-anchor retirement.
- Explicit runtime and harness source lists include HostContext. A duplicate Position declaration already present in the baseline lifecycle game substitute was removed to unblock compilation.

**Phase 1 is partial; MP1/PS4 G1 remain open.** No knowledge is added to Luna requests and PS4 is not enabled by this checkpoint.

## Fresh verification

All runs are offline, with provider/game substitutes. Windows pipe tests require permission for local IPC; the initial sandbox-only companion run failed on localhost/file permissions. The permitted baseline and post-change runs each passed 407/407.

| Command or harness | Result |
| --- | --- |
| `node tools/runTests.mjs` from candidate | 407 passed, zero failed |
| `dotnet run --project native/promoted-characters/host-context-tests/HostContextTests.csproj` | 58 assertions passed |
| native intelligence tests, Debug/net481 | 76 assertions passed |
| native intelligence integration tests, Debug/net481 | 50 assertions passed |
| P2 lifecycle tests, Debug/net481 | 76 assertions passed |
| P2 runtime tests, Debug/net481 | 34 assertions passed |
| P2 bridge tests, Debug/net481 | 459 assertions passed |
| P2 PS host tests, `stop` / `failed` | 8 assertions passed in each scenario |
| `node tools/buildCharactersAddon.mjs` | production Release addon built and packaged; pinned compile-only references matched |
| `node docs/research/tools/validate-corpus.mjs` | 41 documents, 17 decisions, 15 contracts |
| `git diff --check` | passed |

The package receipt is [checkpoint build manifest](validation/unified-intelligence-host-foundation-build-20261008.json). Defaults remain disabled; the builder records no deployment and no GTA test. Source identity is the Git commit containing this ledger and the implementation files, rather than a historical test SHA.

## Resume point and remaining work

1. Finish phase 1, without closing its gate early: C-13 host/world extension advertisement and strict parsing on P1/P2/PS/ACT pipes; matching ACT client echo; reset broadcast and idempotent P1/ACT/UX consumers; stale operation/turn invalidation. P1 now consumes shared host resets; its legacy detector is retained only for standalone legacy operation.
2. Publish C-02 observer_index batches and the reserved EnrichActor turnKnowledge block from the exact retained Ped. Implement strict companion join and reserved-block stripping. Missing/mixed host/epoch must omit enrichment.
3. Add real cross-language pipe/extension tests and the production ACT-world adapter regression harness; finish continuous/stalled PS-host cases and required interop checks. Current quota tests exercise the shared service and current production build compiles ACT, but they do not establish physical target completion.
4. Continue phases 2–5: qualified PS2 semantics/C-14, P0-time frozen inputs, single C-04 renderer across actual Luna request paths, exact C-03 delivery acknowledgement and controlled rollout evidence.
5. Continue remaining master phases through their own dependencies and gates. C-01 mic, gaze mechanism/coexistence, native admission, navigation and GTA physical acceptance remain probe-gated. Do not infer a probe result, enable an unvalidated capability, or claim deployment from an offline build.

No phase is marked fully accepted by this checkpoint. The next implementation work is the remaining phase 1 contract/association seam, with baseline PS4 still the immediate delivery priority.

## Checkpoint 2: C-13 private pipe context and reset fencing

P1, P2, PS and ACT independently advertise the closed version-1 hostRunId/worldEpoch extension. Legacy envelopes remain strictly parsed and carry no inferred host authority. P2 client requests echo advertised context; configured native P2 rejects mixed or stale context. Configured ACT requires a matching client echo before admitting work.

PS emits ordered world_epoch facts and clears observer knowledge, signals and grants on a valid reset while retaining stream sequence checks. P1 rotates its independent factual epoch from the shared Core host reset. P2 clears retained encounters before reset operations that may fail. ACT closes old admission, sends the actual closed reset reason, refreshes hello, and handles repeated reset notifications idempotently. Companion ACT removes earlier-world RAM self facts and goals without replaying native effects. Pipe loss clears the client's advertised host context. Host reset fanout reaches all subscribers even if one fails, then reports the failure to its owner.

The native ACT regression run also exposed the existing typed JavaScriptSerializer array decoding mismatch at anchor.resolve. Native admission now uses DeserializeObject, preserving JSON arrays required by the closed frame validator; the harness decodes replies the same way. This enables the existing anchor path without changing its schema or authority.

Fresh offline validation: companion 413/413; ACT 158 assertions; P2 lifecycle 76; native P1 facts 9; P2 control pipe 16; intelligence 76; production intelligence integration 50. The production Release addon built with pinned references, deploymentPerformed=false and gtaRuntimeTest=false. git diff --check passed.

**Phase 1 remains partial and the full goal remains unfinished.** New native ACT tests cover independent advertisement, mixed host/stale echo refusal, reset reason, reconnect and idempotence. P1/P2/PS existing native regression suites pass, but dedicated extended cross-language interoperability and actual P1 reset harness coverage remain open. C-02 actor association/index, unconditional reserved-field stripping and turn invalidation still precede PS4 rendering. No Luna enrichment, deployment, enablement or GTA acceptance is claimed here.

## Checkpoint 3: unconditional private actor evidence stripping

The existing modelActor seam now sanitizes actors independently of optional identity/character-service enablement. sessionIdentity and turnKnowledge are removed from actor fields, integrations and integrations.raw. characterProfile native transport is also removed from those locations; later trusted P2 narrative projection retains its existing path. Sanitization preserves ordinary actor identity when there are no reserved fields and never mutates the captured input.

The Essential BK patch invokes this seam for actor and listener unconditionally. EO reserves sessionIdentity, characterProfile and turnKnowledge against flattening into native fields/capabilities. Unsupported or forged reserved blocks are stripped too; no block supplies its own join authority.

Fresh validation: 416/416 companion tests pass, including disabled-service privacy tests and the rebuilt Essential BK prompt path under both OpenAI and Gemini. Existing P2 canon, request lifecycle, microphone/special-turn and safe-failure regressions remain green. git diff --check passed. This checkpoint only closes the sanitization prerequisite; native C-02 capture/index publication, strict independently fenced join, PS4 frozen inputs and actual knowledge rendering remain unfinished. Nothing deployed or enabled.

## Checkpoint 4: native C-02 private capture and observer index

IntelligenceIntegration.EnrichActor validates the supplied PedId and exact retained wrapper/full handle/address, then uses the shared TurnActor consumer. It emits only the reserved version-1 turnKnowledge block with host/world/capture/sample tick. Optional encounter/incarnation comes from P2's read-only current ownership roster; ordinary actors receive no registration or promotion. Missing current ownership omits the capture for an already owned anchor.

The existing PS hello advertises observerIndexVersion=1 alongside its independent host extension. Ordered observer_index rows follow anchor admission, in batches of at most 32 and within the shared 256-entry bound. Publication is cached, complete on refresh/reconnect, and removed with retirement/world reset. Changed owned associations retire the old reference. The factual wire contains no CharacterId, handle or address.

Companion parsing closes the schema, validates paired owned encounter/incarnation fields, requires negotiated extension and matching live anchor kind/ownership, and stores immutable index rows. Retirement, expiry, disconnect and world reset invalidate the index. Unsupported extension versions or conflicting associations fail closed.

Fresh offline results before the final association-retirement guard: companion 419/419; production native integration 76 assertions, including actual pipe advertisement/bounded ordering and exact actor capture; P2 lifecycle 76; production Release addon built with no deployment/GTA test. Initial sandbox-only native pipe runs timed out; permitted IPC runs passed. The final association-retirement guard subsequently passed the same 76-assertion production integration harness.

**Still incomplete:** strict P0-time companion actor/index/P1 join, frozen turn inputs, situation/PS2 qualification, C-04 projection across Luna request paths and delivery acknowledgement. This checkpoint does not enrich Luna or close MP1/G1. Dedicated owned-association, mixed-host capture and cross-language extension interoperability tests remain required. Full phased goal remains active; no deployment or enablement.

## Checkpoint 5: private P0 observer join and frozen PS input slice

A small context/knowledgeInputs module validates the closed captured actor block, complete P0 tuple/actor association, authenticated PS host/world/stream, negotiated observer index and current ped observer anchor. It does not search current conversation, nearest/model/name identity, raw-only namespaces or native handles. Conflicting raw duplicates and invalid owned encounter/incarnation evidence omit enrichment with a closed reason. Owned candidates require matching captured P1/P2 fields and independently advertised P1 host context; this does not replace asynchronous fresh owner proof or authorize a profile.

IntelligenceClient exposes bounded capture/current-check operations over the existing ShadowRuntime, so the turn pipeline has no mutable store access. OpenAIConnection captures this private slice synchronously inside beginTurn, before provider preparation/STT/proof. Matching observation/PS3 revisions and exact decision keys are copied immutably; late arrivals cannot replace them. Host/world/stream loss or actor retirement invalidates the slice. The private object is kept beside the turn context and never serialized to Luna.

hostFor.prepareTurn now exists even with identity/P2 disabled, ensuring the existing preparation seam always strips actor transport before the model request. Optional capture errors omit knowledge without preventing Essential's turn. The existing bootstrap transcript wrapper mismatch is repaired by delegating to ShadowRuntime's unchanged unsupported receipt result; hearing remains disabled.

Validation includes pure join/fence/revision tests, actual rebuilt Essential/OpenAI P0 timing and an actual Luna decision context privacy test with optional services disabled. Research corpus validation passes (41 documents, 17 decisions, 15 contracts). Full companion suite: 426/426 passed. A subsequent added owned-candidate fence test also passed in the focused knowledge-input suite (8/8), without implementation changes.

**This is a partial input slice, not the complete TurnInputs/frame implementation.** Situation records are currently absent and cannot authorize rendering. Frozen profile/session canon, history/contributors, first-owned-turn candidate release after fresh proof, all provider entry points, reset cancellation after send, C-14 qualification, selector/renderer and acknowledgements remain required. Baseline PS4 remains the immediate priority; full phase acceptance and GTA gates stay open. No deployment or enablement.

## Checkpoint 6: qualified C-14 samples and preserved PS3 ranking inputs

The existing PS hello negotiates observerSituationVersion=1. Native owner-path sampling publishes bounded observer_situation rows after matching anchor/index admission, with sample tick and monotonic situation revision. One read-only mapping distinguishes exact current driver, a valid different driver, unknown vehicle role, active unpaused Essential follow flags and exact committed conversation partner. Dead/paused/unsupported/failed samples stay unknown. Waiting/idle remain unknown until their existing ownership/physical-mode evidence is implemented; no EndOwnership idle string or display phrase is used as proof.

Companion situation samples are strict, ordered, scoped to the PS host/world/stream and current anchor/index, and expire within the anchor lease. World reset/retirement clears them. Runtime situationFor joins an owned incarnation only to a current P1 binding with matching independently advertised host and a loaded immutable P2 profile. It supplies exact existing trait policies and selected memory metadata in existing importance/ID order. Authored player relationship requires a current player capture. Recognition bindings remain empty; backend identity never creates participant recognition.

ShadowRuntime feeds this provider and sampled activity into the existing situationFromCharacterView normalizer. SalienceCache retains the immutable observation/decision/normalized situation used for ranking on its existing entries/ledger; snapshotForObserver requires matching current observation revision/native run and expiry. P0 now consumes these paired inputs, including the original situation, instead of constructing one later. The ledger preserves retained pairs after FIFO decision-cache eviction; pair payloads are capped at the existing 2 MiB observation budget using the existing ranking order, without changing grants, keys or acknowledgement semantics. Budget calculation uses cached byte sizes rather than repeatedly serializing all payloads.

Sampled injury_state now enters the existing self-receipt path with knowsTarget=true and sampled_state basis. Self source/target flags are supplied only for the exact involved observer. No attacker, weapon, spoken words, recognition or physical action completion is inferred.

Validation: explicit Node test-runner full suite 431/431 (zero failed/cancelled); native production integration 83 assertions; production Release addon built against pinned references, no deployment or GTA test; git diff --check passed. Focused tests cover sample expiry, frozen original activity after a newer sample, ledger fallback, self injury attribution, native vehicle-role/follow/conversation mapping and mixed-host/revoked profile omission. Some plain-node suite runs exited without a final summary; they were not counted as accepted verification and the explicit test runner completed the suite.

**Phase 2/PS4 remain unfinished.** Required next work includes complete PS2 claim-detail qualification, pair pressure/omission diagnostics and interoperability gates, frozen canon/history/contributor inputs, first-owned-turn proof release, C-04 selector/renderer across request paths and exact delivery acknowledgement. C-06 waiting/idle physical truth and GTA acceptance remain open. The full master-plan goal is not complete; nothing deployed or enabled.

## Checkpoint 7: narrow PS2 detail qualification and P0-frozen canon

EpisodeCorrelator now validates closed signal/receipt inputs and the current ped observer before producing knowledge. Typed provenance-preserving detail variants are limited to qualified same-sample self receipts: native callback injury deltas and known followtarget/waithere handler outcomes; sampled known zone, closed physical activity and retained vehicle state. Visual subject knowledge cannot reveal a destination, backend activity value or handler outcome. Unknown actions/zones and mismatched sample ticks remain generic provenance. Vehicle detail references require the retained vehicle kind and expire with that lifetime; driver=false never implies passenger. Observation v1, evidence vocabulary, four-claim bound and empty recognizedCharacterIds are preserved.

Source inspection found that injury_state can describe healing/armour changes, and vehicle_state can describe engine/speed changes. Those states no longer create invented injury or impact knowledge. They remain accepted raw diagnostics without an observer claim. No new action/self/hearing producer is enabled by the detail variants; their live source qualification gates remain open.

CharacterService adds a bounded read-only P0 capture of the existing encounter canon and already loaded profile candidate. Existing SessionProfiles gets a read-only identity/actor lookup; capture does not assign a name, initialize storage or resolve/create identity. A first owned-turn candidate uses the captured valid owner alias privately. Production preparation releases only the captured profile/revision after the existing fresh identity preparation returns the matching CharacterId/binding and current same-incarnation proof. Revoked/mismatched proof falls back to the frozen encounter canon; a profile absent at P0 cannot appear after proof/loading. Acting direction uses the same frozen personality while preserving existing voice assignment and its 4000-character bound. Existing direct CharacterService callers retain their verified-snapshot API; the production OpenAI path always supplies P0 capture.

OpenAIConnection now carries both knowledgeInputs and characterInputs from beginTurn into the launched private turn snapshot. The previous checkpoint captured knowledge beside the context but did not yet propagate that field into the work snapshot. Neither private object is model context.

Validation: full explicit Node suite 440/440, zero failed/cancelled; final vehicle-kind guard additionally passed 34 focused PS2/contract/detail tests. Frozen-canon tests include a real rebuilt Essential/Luna request deliberately held at fresh owner proof while an editor change occurs, original canon/acting revision, revoked/mismatched incarnation and absence at freeze. The test uses separate CharacterStore instances as required by its one-load contract. git diff --check passed. No native production source changed in this checkpoint.

**Next priority remains baseline PS4:** complete frozen history/world/contributors and first-owned-turn knowledge release, C-04 deterministic selector/allowlisted lane renderer with byte accounting, replace every model-facing ingress, pre/post-send validity and exact C-03 acknowledgement. Existing P2 authority prompt placement is retained temporarily and still must converge into C-04 rather than be duplicated. Pair pressure/omission diagnostics, interop and GTA gates remain open. No phase/full-goal completion, deployment or enablement is claimed.

## Checkpoint 8: preliminary C-04 perceived selector

Added a pure, immutable selector over captured observation/situation/decision pairs, reusing the existing salience ordering. It validates the exact observer, adapter epoch, observation revision, decision key/version, expiry, closed decision fields and retained source/target/vehicle kinds. Duplicate observations and malformed decisions fail closed. Candidate context remains eligible when autonomous response is none. Model-facing facts use fixed modality/certainty and anonymous subjects; selected observation/revision/decision keys stay in a separate private result. Qualified handler outcomes explicitly retain physicalCompletion=unknown, and driver=false does not become passenger. Missing visual subjects and non-self self-injury targets cannot invent an attribution.

P0 pair capture now enforces the existing 128-pair/256-KiB pool limits before immutable copying, preserving the existing ordering. The preliminary selector applies the eight-observation/8-KiB perceived bounds and prioritizes must_include items. Final reserved safety-byte accounting, pressure diagnostics, lane rendering, model-path integration, configuration gates and delivery acknowledgement remain unfinished. No request currently consumes this selector.

Validation: full explicit offline Node suite 444/444 (zero failed/cancelled); after the final capture-pool bound, 12 focused knowledge-input/selector tests passed. No production native changes or deployment. The full master-plan goal remains incomplete; baseline PS4 is still the immediate implementation priority.

## Checkpoint 9: preliminary C-04 lane renderer and frozen history

Added a pure immutable lane renderer. It reuses P2 narrative selection/string bounds and importance/ordinal memory ordering, splits canon into SELF and manual pins into RECALLED, retains one shared 16-KiB allocation including lane wrappers, and keeps memory IDs private. No first-three memory limit is introduced. PERCEIVED uses the existing preliminary selector. CONVERSE emits role messages once, rejects oversize mandatory input, normalizes malformed surrogate text deterministically, allows only prior user/assistant roles and drops oldest whole history items for its 8-KiB budget. Internal turns receive a fixed no-player-utterance descriptor; arbitrary trigger text is absent. SITUATION allows only the five P0 world fields with Unicode/zone validation and a serialized 1-KiB bound. COMPAT uses closed stock zf capability booleans, bounded weapon tokens, retained strict P/V labels and listener presence/address. Missing source-presence evidence leaves normalized self booleans/demographics unknown. Raw actor/listener/world, integrations, profile IDs and freeform context are not model allocation inputs.

Renderer byte accounting covers serialized lane envelopes and the scene's additional JSON escaping. Final packing drops optional whole history, affordance/environment detail, low-ranked candidate observations, lower-priority manual memories and, only if still required, overflowing must_include observations with explicit counts. Current input is never shortened to admit optional material. Selected observation keys and retained memory IDs remain private delivery metadata. Remaining safety-reserve and omission/pressure gates are not claimed complete.

Both OpenAI reasoning entry points accept the finalized private projection through buildRequest. That route consumes only projected scene/role data, enforces the 16-KiB trusted-instruction and final 160-KiB outbound JSON limits before provider fetch, and retains existing output schemas. **Production turns do not yet create/supply this projection.** The legacy raw request route remains during staged integration; this checkpoint does not close ingress replacement or claim PS2/PS3 facts reach Luna.

The production OpenAI P0 capture now freezes prior committed history alongside character/knowledge inputs before asynchronous proof/STT/provider work, carries it into the work snapshot and uses it in runSequentialTurn. Existing direct pipeline callers retain their history API fallback. History commits and playback-gated assistant commits are unchanged. A rebuilt stock Essential test changes history after P0 capture and verifies that Luna receives the original prior history.

Validation: final explicit offline Node suite 453/453, zero failed/cancelled. Renderer tests cover canary exclusion, no duplicate canon/memory/current input, ten manual pins in existing order, source-presence unknown versus explicit false, closed capability fields, Unicode/zone budgets, whole-history eviction, mandatory input rejection, both request schemas, actual nonstreaming provider request bytes, oversized-instruction rejection before either provider fetch, and escape-heavy final body bounds. Research corpus validator passed (41 documents/17 decisions/15 contracts); git diff --check passed. No native production source, binary deployment, activation or GTA acceptance changed.

**Next baseline PS4 work:** capture source presence at the pinned normalization seam; converge CharacterService authority text into one SELF/RECALLED rendering; configure off/shadow/active with identical hardened baseline, finalized-once frames and supported contract gates; connect every stock/OpenAI/Gemini ingress; release first-owned-turn knowledge after matching fresh proof; add pre/post-send validity, exact C-03 acknowledgement and scalar diagnostics. Native interoperability and GTA gates, plus all later master-plan phases, remain open. The full goal is not complete.

## Checkpoint 10: source-presence provenance at Essential normalization

Added a runtime-local WeakMap presence store for six closed self fields (gender, ageRange, isArmed, isIndoors, hasHeldItem, heldItemName). It records exact supplied typed values and exposes only a frozen closed presence array. Omission, malformed values and normalization defaults cannot establish a known self fact. Actor JSON contains no additional provenance properties. Presence invalidates if a recorded value changes; copies retain only still-matching values. This is private P0 input metadata, not another evidence/memory service.

The pinned AST patch inventory increases from 48 to 54 with audited normalization/copy seams: ia direct input; AO actor packet aliases; CO player packet aliases; eo hydrated inputs with the existing nullish isArmed/armed rule; pd actor/session copies; M4's hydrated listener copy. Source aliases preserve the actual selected input and cannot use a different valid alias to legitimize a malformed winner. Re-normalizing a known normalized object preserves its original presence instead of upgrading default false values. The return wrappers explicitly group comma expressions, and the pd object-return wrapper retains a valid return-expression boundary; focused rebuilt stock tests caught these minified-source cases before the accepted build/suite. Essential's normalized actor values/capabilities remain unchanged.

Runtime modelActor stripping retains the private provenance in the WeakMap. OpenAI constructor/context refresh/P0 snapshot clones preserve it, and the P0-frozen presence array is carried beside knowledge/character/history inputs into the launched work snapshot. It does not enter model context. The renderer has not yet been connected to production turns, so this checkpoint does not enable PS4 delivery or change request serialization.

Validation: explicit full offline Node suite 457/457, zero failed/cancelled. Focused cases cover stock AO/CO/ia/eo/pd paths, explicit false versus omission, malformed alias precedence, nullish armed fallback, re-normalization, private copy/mutation behavior, actual P0 cloning, and a launched real Essential turn with private frozen presence. Source-pinned candidate build and deterministic/isolation checks pass at 54 AST edits; corpus validator passed (41/17/15); git diff --check passed. No native production source/binary deployment, enabling, or GTA acceptance changed.

**Next baseline PS4 work:** separate trusted Essential behavior/action declarations from BK/ET/qM/FM raw narrative expansion; converge P2 authority into SELF/RECALLED; finalize one frame after accepted STT using P0-frozen contributors; connect the hardened base serializer and gated off/shadow/active projections; complete first-owned-turn proof release, request validity and exact C-03 acknowledgement. All remaining PS4 release/interop/GTA gates and later master-plan phases remain open. The full goal remains incomplete.


## Checkpoint 11: production hardened C-04 base requests

Every production OpenAI turn now finalizes one private frame after accepted STT, using the P0-frozen contributors and prior history. Both buffered and streaming reasoning paths, including early TTS, consume its allowlisted allocation. Retries reuse the same finalized frame. The old raw actor/listener/world request serializer has been removed; direct API callers receive the same safe basic renderer fallback. Optional PERCEIVED delivery remains disabled. This closes the hardened base integration, not baseline PS4 enrichment or its release gates.

The pinned BK seam separates the actual Essential dM behavior/action/language declarations before ET/qM/FM/GM/mT narrative expansion. A single trusted frame slot replaces stock narrative placeholders; inserted JSON is never processed as instruction placeholders. The exact existing NPC interaction suffix is preserved. Gemini retains its existing path. CharacterService releases frozen, freshly verified canon into private characterProjection; SELF/RECALLED render it once, while behavior text contains only static grounding. Model allocations exclude profile, proof, memory and native transport IDs. Both request schemas retain Essential authority and enforce the existing instruction/frame/body byte limits before fetch. Opt-in prompt auditing reports only the assembled request body.

The base renderer additionally closes canon enums, normalizes malformed surrogate text, excludes arbitrary equipped-weapon descriptions from inventory projection, and preserves the stock dedicated inventory fallback. Accepted player input still commits under the existing bounded history policy even when an oversized mandatory input prevents provider fetch. Playback-gated assistant history is unchanged. Build metadata advertises safeBase only; optional perception delivery and the dialogue-knowledge capability remain unavailable.

Validation: final explicit offline Node suite 475/475, zero failed/cancelled. Real rebuilt Essential/provider-fetch tests cover typed, microphone and internal turns across buffered, streaming and early-TTS paths; actual dM declarations with narrative expanders forbidden; byte-identical frozen retry despite live mutations; mandatory input rejection before fetch with accepted history preserved; unchanged Gemini routing; canonical single rendering and private-ID exclusion. Pinned deterministic builder remains at 54 AST edits. Research corpus validator passed (41 documents/17 decisions/15 contracts). No native production source, deployment, activation or GTA acceptance changed.

**Next baseline PS4 work:** closed off/shadow/active configuration and supported capability gates; first-owned-turn proof release; pre/post-send lifetime validity; exact completed-reasoning C-03 acknowledgement; explicit safety reserve and pressure/omission diagnostics. Optional PS2/PS3 knowledge does not yet reach production Luna requests. Native interoperability, GTA gates and all later master-plan phases remain open. The full implementation goal remains active and incomplete.


## Checkpoint 12: first-owned-turn frozen knowledge release

Owned PS4 inputs now retain their original bounded observation/decision/situation candidate when P1 has not yet connected at P0. A conflicting already-known P1 host still prevents capture. Every owned candidate stays private behind ownerPendingProof, including those captured while P1 is connected; the selector cannot project pending or failed inputs. Ordinary unowned observers retain their existing independent path.

Existing OpenAI identity preparation releases that same candidate only after the current persistent snapshot's full native tuple, binding ID/revision, CharacterId and captured claim association match the current binding, the P1 evidence is current, and P1/PS host/world and the original observer/stream remain current. It performs no new identity resolution, profile lookup, observation retrieval or salience evaluation. Missing/revoked/mismatched proof keeps optional knowledge unavailable. Captured pairs remain immutable even when newer observations arrive before proof completes.

Validation: focused capture/selector tests and an actual rebuilt Essential controller preparation test pass. The final full regression result is recorded below. No native production source, deployment, activation or GTA acceptance changed. Optional production PERCEIVED delivery remains disabled; closed modes/build support, request-time validity, exact acknowledgement, budget/pressure diagnostics and later master-plan phases remain unfinished. The full goal remains active.

Final validation: explicit offline Node suite 477/477, zero failed/cancelled; git diff --check passed.


## Checkpoint 13: closed PS4 configuration, build gates and scalar preview

Added independent dialogueKnowledge.mode off/shadow/active, default off, with closed object/value validation. Existing intelligence off/shadow collection configuration is unchanged. Bootstrap checks the exact five-field dialogueKnowledgeContract extension and existing perception DLL/metadata pins separately, then per-turn preparation checks the live C-02/C-13/C-14 hello versions. Merely configuring shadow/active cannot start collection or authorize inference, actions or ownership operations.

Supported shadow mode projects the captured candidate read-only while returning the identical hardened base allocation sent by off. Only frozen scalar selected-count/byte/hash preview metadata is retained; private candidates remain outside model context. Existing operational telemetry now admits the closed knowledge_frame_projected event and corresponding scalar fields/hash/reasons, dropping private payloads and freeform strings. Missing build/live support or a stale association preserves ordinary base dialogue. Production manifest capability remains unavailable.

Active configuration is accepted but intentionally remains fenced on the safe base until request-time validity and exact completed-reasoning acknowledgement are integrated. It reports unsupported_contract for that unfinished release path. No timer/admission/autonomy or separate lifecycle is introduced. This checkpoint is mode/preview groundwork, not active PS4 completion or rollout acceptance.

Validation: full explicit offline Node suite 483/483, zero failed/cancelled; focused bootstrap/mode tests verify default-off and unknown-option rejection, independent collection settings, exact version/native-pin checks, off/shadow allocation equality, candidate immutability, private scalar preview, stale safe fallback and telemetry sanitization. git diff --check passed. No deployment, enablement, native production source or GTA acceptance changed. Request validity, exact delivery acknowledgement, explicit safety reserve/pressure diagnostics, remaining baseline interoperability/GTA gates and later master-plan phases remain open. The full goal remains active.


## Checkpoint 14: reasoning request state and exact delivery lifecycle

Added bounded per-generation knowledgeDelivery state beside the private frame. It checks current native identity at request preparation/send/completion, records hashes of the actual serialized request (including stream:true) and model allocation, and rejects changed retry bodies/projections. Captured selected items are checked against exact original observation/revision/key, original expiry and current source/target/vehicle lifetimes. Stale optional knowledge before first send can fall back to the frozen base; stale enriched completion/retry fails closed after send. This groundwork currently falls back as a whole; per-item pre-send pruning and immediate in-flight retirement cancellation remain unfinished.

Both real reasoning request implementations call the authorization hook immediately before fetch, independently of diagnostic callbacks. Streaming checks its final body byte limit including stream:true. A common pipeline reasoning-success hook runs after the completed parsed result and before stock action validation. In early TTS it runs immediately after modelTask resolves and before speechTask is awaited. Exact retained keys are acknowledged once through the existing salience ledger as ps4_context/delivered; no preview, selection, intermediate retry failure, partial segment or PCM acknowledges delivery. Terminal failed/stale reasoning records rejected/expired against exact sent keys only. False acknowledgements count retired keys without substituting a newer decision. Successful reasoning is independent of subsequent action/TTS/playback failure and existing assistant-history policy.

Scalar knowledge_delivery telemetry records outcome/counts and request/projection hashes; private IDs, keys, facts and prompt text remain outside normal telemetry. Production frames still contain no optional PERCEIVED items and active release remains fenced. The helper introduces no historical-key ledger, PS6 grant changes, history writer, native authority or autonomous admission path.

Validation: final explicit offline Node suite 492/492, zero failed/cancelled; git diff --check passed. Tests cover unsent/malformed/stale results, byte-stable retry authorization, first-send base fallback, post-send retirement/expiry, exact false-key handling, original item fences, and real rebuilt buffered/streaming/early-TTS provider paths with final reasoning success followed by TTS failure. All acknowledge once and discard assistant history. Full regression caught and corrected an unintended hook insertion in the shared audio request path; the final accepted suite ran serially to avoid competing stock bundle rebuilds. No deployment, enabling or GTA acceptance changed.

**Remaining baseline PS4 release work:** selective pre-send item removal and immediate post-send retirement/host invalidation cancellation; complete owner revalidation at each knowledge use; supported active candidate routing and capability gates; safety reserve/pressure diagnostics; full actual enriched-path fault/interop matrix and external GTA gates. All later master-plan phases remain open. The full implementation goal remains active and incomplete.


## Checkpoint 15: selective pre-send stale item pruning

The single renderer now supports narrowing an already rendered allocation before first send. It removes whole stale PERCEIVED observations together with their exact private delivery keys, preserves every surviving item and the original conversation/canon/world allocation, and updates byte/per-lane diagnostics. It never retrieves replacement candidates or re-ranks/evaluates salience. Request preparation checks each retained item's original revision/key/expiry and current reference lifetimes. Actor/host invalidation removes all optional items; individual stale subjects remove only affected observations. Pruning stops at first send, so retries/completion retain the exact sent allocation and existing post-send fences.

Validation: full explicit offline Node suite 494/494, zero failed/cancelled; git diff --check passed. Focused tests prove whole-item/key alignment, unchanged conversation, immutability, no refill, pruning only before first send and acknowledgement of surviving keys only. Production active candidate routing remains gated and no optional knowledge is enabled. Immediate in-flight retirement cancellation, complete owner time-of-use validation, active-path capability/fault/interop gates, safety reserve/pressure diagnostics, external GTA acceptance and later master-plan phases remain unfinished. No deployment or native production source changed. The full goal remains active.


## Checkpoint 16: owned knowledge proof at each use

Extracted the existing owned candidate release proof into one read-only current check and reused it during selective pruning, request send and completed reasoning. Each use requires the original full native tuple, current persistent snapshot/binding ID and revision, same CharacterId/captured owner association, independently matching P1/PS host/world and still-current owner evidence. Preparation success no longer substitutes for proof at later knowledge use. No fresh identity resolution, profile read, observation retrieval or recapture occurs. Unowned observers still need no P1 service. Pending proof cannot upgrade a missing/unowned association.

The original actor-current check additionally requires a current ped observer anchor and matching index kind/ownership, closing index/anchor-type drift. Validation: full explicit offline Node suite 495/495, zero failed/cancelled; git diff --check passed. Existing first-owned-turn tests now exercise the same current-check after release and revoked evidence; negative binding/tuple/host cases retain the shared proof path. No production activation, native code, deployment or GTA acceptance changed. In-flight invalidation cancellation, active candidate routing/capability matrix, safety reserve/pressure diagnostics, remaining baseline interoperability/GTA gates and all later master-plan phases remain open. The full goal remains active and incomplete.


## Checkpoint 17: factual-channel in-flight invalidation

IntelligenceClient now exposes a bounded (32) read-only invalidation subscription on its existing factual lifecycle. It notifies after authenticated frame processing, disconnect/reset and the existing 500-ms expiry/watch pass. Listener faults cannot escape transport processing. This is not another timer, event ledger, producer or turn/admission path.

Per-generation request state subscribes only for a frame with optional delivery items. Before first send invalidation does not cancel basic conversation; the existing selective preparation prunes stale items. After send and before successful reasoning, an invalid current tuple/actor/host/stream/owner/item fence aborts the same pipeline controller. Completed reasoning, terminal failure and final teardown dispose the subscription. Subscription capacity failure before send falls back to the frozen base; no unbounded callbacks are admitted. Existing identity retirement continues to own P1 session cancellation.

Validation: full explicit offline Node suite 499/499, zero failed/cancelled; git diff --check passed. Tests cover authenticated factual retirement/disconnect notification, listener fault isolation, bounded capacity/re-admission, post-send cancellation with exact expired-key outcome, no pre-send cancellation and completion/teardown cleanup. Production PERCEIVED delivery remains gated; actual enriched-controller cancellation and adversarial all-path tests remain required before release. No deployment, native production source, activation or GTA acceptance changed. Active candidate routing/build capability, safety reserve/pressure diagnostics, remaining interoperability/GTA gates and later master-plan phases remain unfinished. The full goal remains active.


## Checkpoint 18: gated active requested-turn routing

Explicit active mode now selects the captured candidate only after matching build support, live C-02/C-13/C-14 versions and current actor association. Off/shadow still send the identical hardened base. The selected active frame uses the existing per-generation pruning/send/completion/invalidation/acknowledgement state; no autonomous turn admission, producer changes or alternative lifecycle are introduced. Unsupported/mismatched/proof-unavailable paths retain the safe base. The generated production dialogueKnowledgeContract remains unavailable pending the remaining release gates; existing configs remain off.

Actual rebuilt Essential/provider-fetch tests now run real PS2 correlation and PS3 salience inputs through P0 capture into buffered, streaming and early-TTS requests. They prove permitted firing knowledge appears while native/host/observation/key transport data does not, ps4_context consumption is recorded without PS6 consumption, and subscriptions are released. A real pending provider request is aborted when the factual actor retires, with no delivered acknowledgement or assistant-history commit. Tests explicitly supply matching support for the offline fixture; they do not establish native payload/GTA capability validation.

Remaining baseline gates include the expanded active mic/internal/owned/mixed-host/retry/fault matrix, explicit safety reserve and pressure diagnostics, complete native interop/payload support verification and external GTA acceptance. Later master-plan phases remain unfinished. No deployment or activation performed. The full goal remains active.

Validation: full explicit offline Node suite 503/503, zero failed/cancelled; git diff --check passed.


## Checkpoint 19: actual active source/retry matrix

Expanded the rebuilt Essential/provider-fetch active matrix to all nine typed/microphone/internal × buffered/streaming/early-TTS combinations. Each uses real PS2 correlation, PS3 paired decisions, P0 capture, production frame routing and exact ledger acknowledgement. Accepted player text appears once; internal turns retain the fixed no-player descriptor and omit unsupported trigger canaries. All request bodies omit captured native/host/key transport data and release invalidation subscriptions.

Added a real retryable 503 case in which PS2/PS3 replaces the observation decision after the first send. The retry body remains byte-identical; completed reasoning reports the exact old key retired, and the successor has neither PS4 nor PS6 consumption. No replacement key or newly arrived observation enters the frozen request. This closes those tested source/retry cases, not the remaining owned/mixed-host/full fault matrix or native/GTA gates.

No production source, deployment, enabling or capability declaration changed. Explicit safety reserve/pressure diagnostics, remaining baseline support/interop/fault/GTA gates and later master-plan phases remain unfinished. The full goal remains active.

Validation: final explicit offline Node suite 510/510, zero failed/cancelled; git diff --check passed.


## Checkpoint 20: explicit selector safety reserve

The existing selector now explicitly accounts for the planned 2-KiB safety reserve inside the unchanged 8-KiB PERCEIVED bound. Highest-ranked must_include items are admitted first; routine items cannot use the unfilled reserve. Serialized item/envelope growth is measured rather than estimated. Private immutable selection diagnostics record reserved, used and remaining bytes; final rendered per-lane/allocation bytes continue to use actual serialization. Whole-item/count/overflow omissions and existing ordering remain unchanged; no new scoring or entitlement policy is introduced. Selection reserve diagnostics describe selector admission before later frame packing/pruning.

Validation: full explicit offline Node suite 512/512, zero failed/cancelled; git diff --check passed. Tests verify unused/partially used reserve, immutable byte counters, safety-first retention among 100 routine candidates, eight whole retained items/93 deterministic omissions, stable repeated output and unchanged frozen inputs. Full paired-store pressure/omission instrumentation and the remaining support/interop/owned/fault/GTA matrix are still required. No deployment, capability activation, native production source or GTA acceptance changed. Later master-plan phases remain unfinished and the full goal remains active.


## Checkpoint 21: captured-pair omission diagnostics

The existing salience snapshot optionally reports bounded observation/expired/missing-pair/revision counts while preserving its existing array API and ordering. P0 capture records retained pair count/serialized pool bytes plus retired-reference and pool-budget exclusions before immutable copying. Renderer diagnostics carry this private scalar summary; knowledge_frame_projected admits only explicitly named scalar counters through normal telemetry. No observation, decision key, profile, transcript or prompt payload is logged and no replacement pair is constructed.

Validation: full explicit offline Node suite 513/513, zero failed/cancelled; git diff --check passed. A focused missing-metadata case verifies the empty captured pool and no_matching_salience count without evaluation or consumption of the existing grant. Earlier pressure/selector/retry and actual source-path tests remain passing. Broader paired-store pressure/fault/owned/mixed-host support and native interoperability/GTA gates still require verification. No deployment, capability enabling, native production source or GTA acceptance changed. All later master-plan phases remain unfinished; the full goal remains active.


## Checkpoint 22: real active negative request gates and remote refresh

Refreshed origin from GitHub; main remains d423125, the PR #22 merge. Added actual rebuilt Essential/provider-fetch negative cases for unavailable build support, mismatched actor host/world, missing private capture and unsupported live C-14 version. Each completes ordinary safe-base dialogue with empty PERCEIVED, no private actor block in the request, no salience consumption and no invalidation subscription leak. No authority document, production capability gate or native source changed.

These cases strengthen the companion release evidence; owned-controller, broader adversarial/pressure/native interoperability/payload/GTA gates and later master-plan phases remain unfinished. No deployment or enabling performed. The full goal remains active.

Validation: full explicit offline Node suite 518/518, zero failed/cancelled; git diff --check passed.
