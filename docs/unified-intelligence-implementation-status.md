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


## Checkpoint 23: actual first-owned active request and mixed P1/PS host proof

Added rebuilt Essential/provider-fetch integration using the existing P1 resolver, P2 profile store/canon, owned C-02 observer index, C-13 host fence and real PS2/PS3 knowledge. P1 begins disconnected at P0; preparation waits while the profile is edited, then returns fresh owner proof. A matching host releases the original captured perception beside the original canon revision; a mismatched P1 host leaves PERCEIVED empty and does not consume salience. Both complete ordinary conversation, omit private native/profile/proof IDs and the later edit, and release subscriptions.

These cases prove the first-owned request join rather than just the helper behavior. They do not establish full native physical support or GTA acceptance. Remaining adversarial/pressure/native interoperability/payload/GTA gates and later master-plan phases remain unfinished. No production source, capability enabling or deployment changed. The full goal remains active.

Validation: full explicit offline Node suite 520/520, zero failed/cancelled; git diff --check passed.


## Checkpoint 24: actual .NET/Node PS4 factual interoperability

Strengthened the existing Windows factual interop helper rather than creating a parallel transport. It links the production IntelligenceChannel source and now emits the C-13 shared host/world hello, C-02 ped observer index and C-14 situation before its supported firing signal. The real IntelligenceClient checks those extensions and feeds its actual PS2/PS3 captured pairs into the existing PS4 renderer. The interop assertion requires nonempty bounded delivery metadata and no captureRef in the model allocation, while retaining the current-user factual-only pipe.

Validation: helper net481 build succeeded with zero warnings/errors; actual Windows pipe test passed host/index/situation/knowledge-projection checks. This executes no game assemblies and does not establish physical witness/situation truth or GTA acceptance. Production addon capability remains unavailable; source/payload support and remaining adversarial/native reset/pressure/GTA gates still require completion. No deployment, enabling or native production source changed. Later master-plan phases remain unfinished and the full goal remains active.

Final validation: full explicit offline Node suite 520/520, zero failed/cancelled; git diff --check passed.


## Checkpoint 25: fresh native payload build and explicit default-off sample

The companion sample now explicitly includes dialogueKnowledge.mode off. The native addon build records its implemented ACT foundation/shared-host scope and a sharedIntelligenceContract with host/actor-capture/observer-index/observer-situation version 1, while explicitly retaining physicalAcceptance:false. Companion delivery availability remains false; this metadata is compiled support, not release approval or runtime truth.

Built the current production Release addon against the existing pinned compile-only RPH/net481/DamageTracker/RNUI references. Verified all four packaged native artifact hashes against the generated manifest. Runtime DLL SHA-256: b8c3bd98c2f80c0c80e00614a8ef03c45e9827090952e523b5a946478941d3a9. Build metadata retains deploymentPerformed:false and gtaRuntimeTest:false. Artifacts remain isolated in candidate dist; no installation performed.

Validation: full explicit offline Node suite 520/520, zero failed/cancelled; git diff --check passed. Remaining companion/native payload support verification, adversarial/pressure/reset/GTA gates and later master-plan phases remain unfinished. No enabling or GTA acceptance changed. The full goal remains active.


## Checkpoint 26: actual failed and partial reasoning delivery cases

Expanded the real active Essential/provider-fetch matrix with refused, incomplete and malformed buffered reasoning responses. Each sends the supported frozen perception frame but records rejected reasoning, consumes no PS4/PS6 entitlement, commits no assistant history and releases subscriptions. Added a real active early-TTS stream that releases a validated segment/PCM before a contradictory final response: partial speech still proves no completed reasoning delivery, so no knowledge acknowledgement or assistant commit occurs.

These tests use the actual decoder/request/controller/ledger path, not a successful synthetic result or playback as delivery evidence. No production source or capability availability changed. Remaining payload support, pressure/adversarial/native reset/interop and GTA gates plus later master-plan phases remain unfinished. Nothing deployed or enabled. The full goal remains active.

Validation: full explicit offline Node suite 524/524, zero failed/cancelled; git diff --check passed.


## Checkpoint 27: release expired/retired pair payloads while retaining suppression

Source inspection found that ledger entries could retain pair payloads after their observation/decision expired, up to the longer suppression TTL. SalienceCache.expire now removes expired pair payload references/byte metadata without deleting still-current suppression entries or changing grants/consumedBy. Factual reference retirement releases affected observer/source/target/vehicle pairs from the existing decision/ledger/latest views; ShadowRuntime calls this on its existing retirement seam. No replacement ledger, scoring rule or entitlement regrant is introduced.

Validation: full explicit offline Node suite 526/526, zero failed/cancelled; git diff --check passed. Focused tests prove payload removal at expiry/retirement while preserving exact keys, existing grants, prior PS4 consumption and unconsumed PS6 state. Actual request/retirement/retry and transport tests remain passing. Remaining pressure/adversarial/payload/native reset/GTA gates and later master-plan phases remain unfinished. Nothing deployed or enabled; the full goal remains active.


## Checkpoint 28: bounded C-14 policy refresh on existing PS3 pairs

Source verification found that native situation/profile changes could leave current observations ranked with old paired inputs until another signal arrived. SalienceCache now compares the existing pair's profile/situation revisions and its established policy fingerprint. ShadowRuntime refreshes only changed current pairs through the same evaluate path, bounded to 128 per observer; native situation rows refresh immediately and the existing factual watch checks profile-policy changes. Unchanged policy does not evaluate, missing pressure-evicted pairs are not reconstructed, and no request rendering/retry performs refresh.

Updated pairs serve subsequent freezes; an earlier frozen pair still retains its original activity/profile policy. The existing decision-key/suppression rules handle policy changes without a new scorer, event table, grant policy or prompt writer. No autonomous admission or additional timer introduced.

Remaining payload/pressure/adversarial/native reset/GTA gates and later master-plan phases remain unfinished. Nothing deployed or enabled; the full goal remains active.

Validation: full explicit offline Node suite 527/527, zero failed/cancelled; focused tests verify changed-policy-only evaluation, current pair replacement and immutable original inputs; git diff --check passed.


## Checkpoint 29: actual paired-store byte pressure and entitlement preservation

Added a production SalienceCache pressure fixture with 1,024 suppression entries and four qualified claims per routine observation. Admitted pair metadata exceeds 2 MiB; unique retained payloads across decision/ledger/latest views stay within the existing 2 MiB ceiling. An older urgent self-danger pair survives newer routine clutter even after ordinary decision-cache eviction. The evicted routine pair remains absent from snapshots, is counted as noMatchingSalience, and is not reconstructed by situation refresh. Exact suppression keys and unconsumed reaction state survive; PS4 delivery does not consume PS6 entitlement and replay remains repetition-suppressed.

No production scoring, retention policy or architecture changed. This closes this specific store-pressure regression, not the complete PS4 T27/T73 or GTA pressure/soak gates. Remaining payload/adversarial/native reset/GTA validation and later master-plan phases remain unfinished. Nothing deployed or enabled; the full goal remains active.

Validation: full explicit offline Node suite 528/528, zero failed/cancelled; focused salience suite 17/17; git diff --check passed.


## Checkpoint 30: explicit matching PS4 companion/native payload support

Removed the permanent-unavailable build dead end by adding an explicit `nativePayloadPath` build option (`LSA_PS4_NATIVE_PAYLOAD` for the CLI). Without it, ordinary companion builds retain unavailable optional-perception support. With it, the builder requires the current native compile-source receipt, all C-02/C-13/C-14 version fields, existing pinned perception contracts, and all four package artifact hashes/installation paths. It records the matching native manifest/source/file hashes and declares optional compiled PS4 support. Stale/incompatible/incomplete/modified packages fail the build rather than silently producing an active-looking candidate.

The native builder records a deterministic compile-source hash before compilation and checks that it is unchanged before publishing the build manifest; generated bin/obj and test-only sources are excluded. Existing compile-only reference pins and isolated packaging remain unchanged. Companion status now truthfully identifies offline PS4 code. No config is enabled: default-off intelligence/dialogue knowledge remain unchanged, live host/index/situation gates still apply, physicalAcceptance and gtaRuntimeTest remain false, and no installer/GTA action occurred. This is matching payload evidence, not a claim that the complete G6 matrix or G7 GTA acceptance passed.

Validation: new negative verifier matrix covers each altered binary, stale source receipt, version mismatch, unsupported perception pins, missing artifact and redirected installation path. Full explicit offline Node suite 530/530, zero failed/cancelled; fresh pinned Release native addon and explicit companion build succeeded; 54 pinned AST seams unchanged; git diff --check passed. Native source receipt `392f31e8932adfe10b7b74c0cb3a66ebc24ccde5bdc93ad9a2c5265902784412`; native manifest hash `7694ac0594d62dd88673c7518c9d6fc8743ffd49691626d09d6b5b6db1edec40`; Runtime.dll hash `e9d1471dc7dbf80d962bb762c622cdea4cd9b84bf96f1d10ff1e2a00073d8106`; companion patched bundle hash `b316b71019cb97f18af753c7518294a2a5a9079b57db7c7dc791fe7d07d4c2ff`. Hashes describe this offline build only.

Remaining complete gate audit/native reset and adversity matrix, C-09 thin health projection, external GTA acceptance and later master-plan phases remain unfinished. The full goal remains active.


## Checkpoint 31: C-09 bounded read model and recorded validation separation

Implemented the settled capability/health read model on the existing runtime service API. It reads the actual build manifest, current PS/ACT hello/host state, C-14/index support and existing ACT registry gate. Rows independently report compiled/configured/runtimeSupported/validated/suspended/derived active; current payload validation is bound to the exact companion manifest hash (including the matched native payload receipt). Configured passedProbes cannot manufacture validation. Missing local probe opt-ins or mixed ACT/PS host epochs suspend ACT eligibility. Unsupported source-time speech, gaze and radio remain uncompiled. This read model never participates in admission, action dispatch, knowledge rendering or model requests.

Added a bounded startup-only reader for versioned diagnostics/validation.v1.json acceptance references. Closed records bind capability, exact payload hash, source commit, session UUID, result and evidence hash; absent/malformed/oversized files fail closed. No physical pass is created, no new watcher/timer/database/gate engine is added, and later failures supersede earlier passes. Original manifest loading is reused for PS4 build support and PS collection. Native F11 presentation remains pending; this checkpoint does not claim the complete C-09 presentation task or any GTA acceptance passed.

Validation: four new tests cover probe/validation separation, payload mismatch, stale/failed receipts, immutable prior snapshots, disconnect/version/mixed-host status, bounded/closed file input, and actual bootstrap read-only service behavior with zero connection/provider side effects when disabled. Full explicit offline Node suite 534/534, zero failed/cancelled; git diff --check passed. Nothing deployed or enabled. Full PS4 gate audit, native reset/adversity coverage, F11 presentation, GTA acceptance and later master-plan phases remain unfinished; full goal remains active.


## Checkpoint 32: C-06 native owner truth at P2/ACT boundaries

Added the settled immutable Encounter.Owner read model (owner/mode/since; no invented lease id). Successful P2 follow/wait controls set p2 ownership, ACT BeginOwnership sets act/activity, and ACT normal/preempted terminal paths sample the exact current incarnation rather than writing idle. Supported follow/paused-follow/sit flags become essential_residual modes; conflicting/reflex/directed/unavailable or otherwise unproven state remains unknown. Same owner/mode retains since; retirement releases the token. P2 suspension refreshes residual state, and ordinary new encounters start unknown rather than claiming a wait command that never occurred. The existing private characterProfile integration block carries the token; it remains stripped from raw model ingress.

EndOwnership preserves its existing seat-flag policy but never restores an earlier task or mode. Removed the unused saved Previous mode field. This is owner truth, not a new executor, physical-completion claim or automatic resume. No native task primitive, additional sampler or public command was added. The native manifest identifies compiled primaryBehaviorOwnerVersion 1 while physicalAcceptance stays false.

Validation: actual pinned Release addon compiled and its explicit matching PS4 companion built with all 54 AST seams; production-linked P2 lifecycle/Windows-pipe tests passed 87 assertions with zero build warnings/errors, including stable transitions, follow/sit/conflict/unknown/foreign cases and DTO serialization. Full companion offline regression 535/535, zero failed/cancelled; source-receipt tests now prove test-only native project/bin/obj exclusion and production-edit detection; git diff --check passed. Native source hash `ccf4b03caea98b1d7ac3cb2cda2cab79ad517b3466c1184977796db93919128f`; Runtime.dll hash `bd23d5b29d0390a1ffa1a6c05b0ccebcaaf0c52914a459542e6a71544394c695`. No game assembly execution/deployment/activation or GTA acceptance performed.

Remaining phase 6 work includes current owner propagation into qualified C-14/frozen consumers/native admission, actual production ACT-world transition fixtures, C-05 exact callback association and fenced ACT factual projection. C-06 U08/A14 physical acceptance and full MP6 are not claimed passed. PS4 gate audit/adversity/F11/GTA and all later master-plan phases remain unfinished. The full goal remains active.


## Checkpoint 33: C-06 token through qualified C-14 and frozen paired inputs

Connected the existing P2 Encounter.Owner to the existing PS owned roster getter and observer_situation transport, without introducing another owner store. The native hello advertises primaryBehaviorOwnerVersion 1; non-null ownership requires that extension and an exact currently owned observer index/incarnation. Native association uses the current owned participant/body/lifetime; getter faults omit only optional owner metadata. Legacy rows remain compatible without a token. Companion storage copies/freezes the closed token, clears it with the existing reset/retirement paths, and supplies it through the existing C-14 normalization into immutable PS3 pairs consumed by subsequent PS4 captures.

Owner intent remains private metadata. A P2 wait token does not fabricate a physical waiting activity, and unknown sampled state remains unknown. Prior frozen pairs keep their original owner token when current ownership changes; subsequent captures use refreshed pairs. Unsupported legacy/unowned metadata is rejected rather than joined heuristically. No task execution, prompt writer, admission gate or extra sampling loop was introduced.

Validation: full explicit offline companion suite 537/537, zero failed/cancelled; production-linked native perception integration 86 assertions and P2 lifecycle/pipe integration 87 assertions, both zero warnings/errors. New fixtures cover live owned token association, retired getter/fault omission, copied source metadata, paired freeze/update/expiry, legacy/unowned fencing and malformed lease identifiers. Fresh pinned Release native package and matching companion build succeeded; production Windows factual-pipe interoperability passed host/index/situation/PS2–PS4 projection with no game assemblies executed. All 54 AST seams remain pinned; git diff --check passed.

Native source receipt: 37bd9d071b4eea743a4cef3f17b0353271117fb026bd9bf000da9c544fb69dc9. Runtime.dll: 83e6524df5d5c26b9827c95086d0d8efc42058ae60fa32abc85957e708d3ba19. Nothing deployed or enabled. Native Director admission, actual ACT-world transition coverage, C-05 callback/ACT fact projection, complete phase/gate audit and GTA acceptance remain outstanding; all later master-plan phases remain in scope and the goal remains active.


## Checkpoint 34: fenced immutable reads from existing ACT facts

Implemented the phase 6 ActivityFacts read foundation using the existing 128-fact store, not a second event ledger. Engine facts now record private host/world/encounter/incarnation provenance from the admitted binding or authenticated native acquisition. Legacy fallback actor IDs do not manufacture provenance for pre-acquisition facts. The engine's transient provenance is excluded from the public Activity contract export. Recorded facts are immutable; factsForCharacter(binding) returns at most 16 immutable facts only for an exact current host/world/body scope, and ActivityRuntime exposes that read. Existing forCharacter UI reads remain separate, including unscoped legacy records that cannot become knowledge.

Actor retirement clears that encounter's facts even after terminal activities; clock reset, host reset and client/adapter restart clear stale factual payloads. Current hello/host gating denies reads after disconnect. Evidence strength remains unchanged: weak completed/arrived claims become mode_established, and world_strong is still required for physical completion. Admission, native execution, existing plans and history remain under ACT authority. No new action transport, autonomous decision policy or prompt block was introduced.

Validation: new scoped-store and actual-engine tests cover exact host/world/body/character mismatch, immutable prior freezes, legacy UI exclusion, 128/16 bounds, retirement/reset/disconnect clearing and weak/strong completion semantics. Existing ACT2 lifecycle/admission/export/cancellation tests pass. Full explicit offline companion suite 540/540, zero failed/cancelled; git diff --check passed. Nothing deployed or enabled.

C-05 still requires a proven exact publication-to-callback association, shared ring collection/drain for ordinary actors, interruption-independent receipt capture, and required ordering/physical probes. The new fenced ACT reads still need the frozen SELF contributor/render/currentness integration. MP6 and full goal completion are not claimed; all later master-plan phases and external acceptance remain in scope. Goal remains active.


## Checkpoint 35: bounded ACT SELF contributor in the single existing renderer

Added a pure ACT factual contributor for the four implemented ACT2 intents and integrated it into renderKnowledge's existing SELF lane behind an explicit includeActivityFacts input, default false. It consumes already-frozen scoped facts, validates exact host/world/character/encounter/incarnation, and uses closed templates only. Canonical instruction/admission/handler/mode/state/physical completion strengths remain distinct. Arrival and step completion explicitly do not imply overall activity completion. Unknown/unsupported intents and malformed/stale facts are omitted. IDs, provenance, reason strings and free-form place labels remain private references outside modelAllocation.

Projection keeps at most 16 facts in newest-first order, never samples or calls a provider, and introduces no prompt block or owner store. Optional facts drop whole to fit the existing shared 16 KiB SELF/RECALLED and final frame budgets, preserving authored canon and selected memories. Private activity references remain aligned with retained facts; counters describe whole-item omissions. Default renderer/controller behavior remains unchanged because production capture does not yet supply this optional contributor.

Validation: five tests cover fixed templates and evidence separation, exact lifetime/unsupported rejection, absence of every private ID/canary, immutable projection, the default-vs-enabled single renderer, arrival/step ambiguity, and shared-budget pressure preserving canon/pins and newest retained outcome. Full explicit offline companion suite 545/545, zero failed/cancelled; git diff --check passed. Nothing deployed or enabled.

Still required before production ACT SELF delivery: freeze exact ACT inputs at P0, release them only against the matching owned proof, validate contributor currentness through the request/retry/success boundary, and apply the optional contributor's build/config/MP6/G8 acceptance gates. C-05 exact publication/callback association, ordinary callback-ring collection and physical probes remain separate unfinished work. No completion claim is made for MP6, PS4 optional contributors, the remaining phases or full goal; goal remains active.


## Checkpoint 36: ACT input freeze at P0 with original owned-proof release

The production connection now captures character inputs once and passes that same immutable capture to knowledge capture. When an ACT runtime is available, the existing P0 knowledge capture freezes at most 16 scoped ACT facts using the captured character profile and exact C-02 association. Full turn identity, original owner claim association, ACT host/world, ready hello, native run and adapter epoch must match. Ordinary/unavailable/mismatched candidates are omitted without affecting baseline PS4. No profile lookup, late fact refill, async preparation or native/model request is added to the capture seam.

Captured ACT inputs remain ownerPendingProof and cannot render until the existing parent owned-release path passes fresh P1 proof for the same captured character. Releasing preserves the original frozen facts; character mismatch keeps the contributor unverified. Added a pure currentness validator for channel reconnect/host changes and exact retained factual payloads; retirement/read faults fail closed. Optional ACT capture/read faults are isolated from the PS4 perception capture. The existing single immutable frame/proof lifecycle remains the authority.

Validation: new capture tests cover original frozen facts across later append/profile changes, pending-vs-released projection, wrong character, exact claim/turn/host/body requirements, unavailable profile/channel, retired fact payloads, reconnect and optional read faults. Full explicit offline suite 547/547, zero failed/cancelled; existing real stock controller/source/request regressions remain passing; git diff --check passed. Nothing deployed or enabled.

Still required: connect ACT currentness to actual request/retry/success/watch boundaries, supply the frozen contributor to the finalizer only behind its independent build/config/acceptance gates, and prove actual controller paths/pressure/negative cases. C-05 publication/callback association and ordinary shared-ring collection remain unfinished, as do MP6/G8 physical gates and later master-plan phases. The full goal remains active.


## Checkpoint 37: optional ACT facts through request lifetime boundaries

Extended the existing PS4 delivery boundary to validate optional ACT SELF references even when the frame contains no perception observations. First-send pruning removes whole stale SELF facts together with their private references; retries and final success reject changed selected payloads rather than refill from later facts. Validation checks only retained references, so eviction of an unselected captured fact does not invalidate the request. Canon, selected memories and original frozen inputs remain unchanged. ACT facts never consume salience or reaction entitlements.

ACT frame/event notifications reuse the existing knowledge invalidation listener after engine updates. Channel loss, reset and retirement therefore cancel pending optional knowledge requests through existing cancellation and teardown, without a new timer or callback store. The production finalizer still does not enable ACT facts: independent contributor gates and actual controller-path validation remain required.

Validation: full explicit offline Node suite 551/551, zero failed/cancelled/skipped. Added ACT-only prepare/send/retry/success/watch tests, whole-fact pruning with aligned references, and selected-reference eviction coverage. Nothing deployed or enabled. C-05 exact publication/callback association, production contributor gating, MP6/G8 and GTA acceptance, full gate audit and all later phases remain unfinished. The full goal remains active.


## Checkpoint 38: bounded passive C-05 correlation adapter

Added DialogueActionReceipts as the master plan's bounded read-only correlation adapter. Publication freezes only the exact four-field turn tuple, current encounter/incarnation/shared host scope, canonical validated action and publication time. Each publication receives a private unique reference. A callback requires that reference plus the same complete tuple/action/body/host, boolean handler result and unsigned source game tick. No latest-turn inference, lease, action dispatch, physical-completion claim, timer or history dependency is introduced. Handler success remains handler_only evidence; failed, late, malformed, mismatched or dropped callbacks cannot establish success.

The adapter bounds pending publications to 32, retained receipts to 128 and scoped reads to 16. Same-action overlap becomes UNKNOWN and is quarantined within the callback window. Retirement removes that scope; reset clears run-local evidence. Expiry uses caller-owned time rather than adding a scheduler. Four tests cover exact scope and immutable captures, duplicate/unannotated callbacks, overlap, clock regression, timeout, overflow, malformed input, bounds and reset/retirement. Full explicit offline suite 555/555, zero failed/cancelled/skipped; git diff --check passed.

This adapter is deliberately not wired to the production publication seam or native ring yet. Current source verifies output_transcript may synchronously dispatch actions, while PushActivity requires an ACT session and DrainActivityRing requires a P2-owned encounter. Completing C-05 therefore still requires the source-pinned pre-publication annotation, versioned read-only ACT-channel/native correlation, ordinary anchored actor collection/drain on the owner fiber, ordering/overflow/reconnect integration tests and the native physical association probe. No receipt in this checkpoint can enter a model request. MP6/G8, production ACT contributor gates, full PS4 gate audit, GTA acceptance and all later phases remain unfinished. Nothing deployed or enabled; full goal remains active.


## Checkpoint 39: C-05 loss and pressure invariants

Corrected two adapter gaps before production wiring: bounded receipt-history eviction could erase an ambiguity guard, and a dropped callback batch invalidated only the callback's referenced pending publication. Ambiguity now has a separate bounded 32-scope quarantine with a conservative time-limited global fallback under quarantine pressure; receipt eviction cannot restore eligibility. Callback overflow invalidates every pending publication even when the overflow notification has no publication reference. Closed channel-loss/annotation-failure invalidation uses the same path, preserving UNKNOWN evidence and preventing later callbacks from manufacturing acceptance. Reset clears guards; exact actor retirement clears only that scope. No production path is enabled.

Validation adds pressure beyond the 128-receipt limit, quarantine-capacity pressure and recovery after expiry, multi-publication unannotated overflow, channel loss and failed annotation. Focused adapter tests 6/6; full explicit offline suite 557/557, zero failed/cancelled/skipped. Existing native channel inspection confirms annotations require a versioned closed protocol extension and independent hello support: ActivityClient currently sends only execution frames in on mode, and ActivitySession closes unsupported frames. Those paths must be extended explicitly; annotations must not be disguised as execution or rely on changing ACT authority. Production/native ordering integration, ordinary callback-ring support and all MP6/G8/GTA and later phase gates remain outstanding. Nothing deployed or enabled; full goal remains active.


## Checkpoint 40: exact pre-publication C-05 observation seam

Added the passive synchronous recordDialogueActionPublication service hook immediately before the existing output_transcript boundary in runSequentialTurn, after successful decision validation/currentness and only for validated nonempty actions. It receives the original turn, validated action metadata and publication timestamp. The observer is not awaited, cannot veto publication, and fault isolation covers thrown errors and rejected promises. Unresolved observer work does not delay the existing action/TTS/playback lifecycle. No action dispatch, retry or automatic receipt is added. The production runtime does not yet register a native annotation observer, so default behavior remains unchanged.

Production OpenAI transport fixtures prove observer-before-synchronous-listener order, exact turn/action metadata, no observation for action-free replies, and unchanged complete playback for normal/throwing/rejected/unresolved observer cases. Focused transport tests 17/17; full explicit offline regression 558/558, zero failed/cancelled/skipped; git diff --check passed after preserving existing line endings. Native protocol annotation/hello support, owner-fiber correlation and ordinary actor callback drain remain required before connecting this seam to C-05 evidence. MP6/G8 and physical association gates remain open; full goal and all later phases remain active. Nothing deployed or enabled.


## Checkpoint 41: closed private C-05 annotation contract

Added matching companion/native structural validators for versioned dialogue.action.pending annotations carrying sequence, private publication reference, full turn tuple, exact encounter/incarnation/shared host-world binding, canonical action and publication timestamp. Extra authority fields, unknown versions, malformed lifetimes and fractional timestamps are rejected. Native canonical action matching uses an exact end anchor so trailing newline behavior matches the companion. This passive extension remains outside existing execution-frame validation: it cannot acquire ownership, dispatch a step or advertise support merely by being structurally valid.

Validation: full offline companion suite 559/559, zero failed/cancelled/skipped; production-linked native ACT tests 166 assertions, zero build warnings/errors, including long timestamps, execution exclusion, sequence/version/lifetime rejection and exact canonical action matching. Actual pinned Release addon and explicitly matching PS4 companion build succeeded. No deployment or activation performed. Channel hello negotiation/acceptance, source-order annotation transport, native pending correlation and ordinary actor shared-ring drain remain unfinished; this checkpoint does not enable model-visible receipts or claim C-05/MP6/G8/GTA acceptance. Full goal remains active.


## Checkpoint 42: negotiated passive annotations on the existing ACT channel

Added optional dialogueActionVersion 1 to closed host-qualified hello validation on both peers. Native ActivitySession advertises it only when constructed with an explicit passive publication observer; ordinary production sessions remain unadvertised. The client echoes supported negotiation and clears support on disconnect/stop. sendDialogueAnnotation is available in shadow/on only with ready negotiated support, exact current host/world and a valid closed annotation. It shares the existing sequence with leases, while shadow execution remains blocked. Invalid annotation input cannot consume a sequence.

Native acceptance occurs on the existing owner-fiber channel pump and requires explicit peer negotiation, closed frame/sequence and matching shared host/world before invoking the observer. No Runner is required or created, no activity/actor acquisition occurs, and failure closes the current channel. Legacy hello remains compatible but cannot submit annotations; unsupported negotiation is rejected before native client lease setup. No transport/service or execution authority is added.

Validation: companion handshake/transport fixtures plus adapter tests 14/14; full offline companion suite 561/561, zero failed/cancelled/skipped. Production-linked native ACT suite 173 assertions, zero warnings/errors, proves opt-in advertisement, shadow publication without execution, heartbeat sequencing, epoch rejection and legacy negotiation isolation. Actual pinned Release addon and matching PS4 companion builds succeeded; git diff --check passed. Production observer construction, native pending/callback correlation, ordinary anchored actor shared-ring drain and source-order/physical association probes remain unfinished. Nothing deployed or enabled; MP6/G8/GTA and all later phases remain open, full goal active.


## Checkpoint 43: source-order fence in the existing native callback ring

Added a monotonic locked capture sequence to the existing 64-entry SupersessionMonitor. Annotation acceptance can sample its fence on the owner fiber; callbacks captured at/before that fence cannot later be joined merely because their drain occurs after annotation arrival. Ordering advances for dropped capture attempts, survives drains and unsigned game-tick wrap, and fails closed on sequence exhaustion. Ring push copies source payload fields while retaining only the opaque Ped reference; producers cannot mutate earlier queued callbacks by reusing a CallbackRecord. No identity/state/native read, extra ring, sampler or timer is introduced. Existing ACT callback semantics and capacity remain unchanged.

Validation: production-linked native ACT suite 181 assertions, zero warnings/errors, including pre/post-fence ordering, tick wrap, source-record reuse, bounded overflow and null capture. P2 lifecycle/Windows-pipe tests 87 assertions passed without loading game assemblies. Actual pinned Release addon and matching companion builds passed; git diff --check passed. Companion source is unchanged; its most recent complete suite remains checkpoint 42's 561/561. Native pending correlation must still consume this fence and exact current anchor/body/host checks; no correlation or receipt advertisement is enabled by this checkpoint. Ordinary actor ring drain, publication ordering/physical probes, C-05/MP6/G8/GTA and later master-plan phases remain open. Nothing deployed or enabled; full goal active.


## Checkpoint 44: bounded native pending-publication correlator

Added the passive owner-fiber DialogueActionCorrelator alongside the existing shared callback ring. It freezes at most 32 validated annotations with the exact body reference, encounter/incarnation, shared host/world, game/wall capture time and ring capture fence. Matching requires the same current body/scope, canonical action, Essential source and a post-fence modifier-before followed by a later executed callback. Modifier-after alone and an unarmed delayed handler cannot establish evidence. Snapshot copies protect the original turn tuple from caller mutation; successful correlation consumes the pending entry exactly once and preserves the handler boolean without claiming physical completion.

Same-action publication overlap or repeated modifier-before events invalidate pending joins with a bounded conservative quarantine window; overflow invalidates all joins. Expiry, retirement and reset release pending body references. No native reads, action dispatch, lease, extra ring or timer is introduced. A missing/unproven modifier ordering yields omitted evidence; actual modifier/callback ordering and supported canonical naming remain physical integration gates, not assumed passes.

Validation: production-linked native ACT tests 239 assertions, zero warnings/errors, cover exact source/body/incarnation/world, pre-fence/unarmed callbacks, immutable tuple, unsigned tick wrap, duplicates, publication/modifier ambiguity, handler failure, overflow, expiry, retirement/reset and capacity. P2 lifecycle/Windows-pipe tests 87 assertions passed. Actual pinned Release addon and matching companion builds passed; git diff --check passed. Companion code is unchanged; latest full companion suite remains 561/561 from checkpoint 42. Production observer construction, ordinary anchor/body resolution and ring routing, closed receipt response/client ingestion, source-order/native physical probes and MP6/G8/GTA remain unfinished. No receipt reaches a model request; nothing deployed or enabled. Full goal and later phases remain active.


## Checkpoint 45: closed C-05 receipt response on the existing channel

Added matching companion/native validators for dialogue.action.receipt carrying the exact pending annotation, handler boolean, unsigned source game tick and nativeRun/adapterEpoch. Unknown fields (including physical completion claims), malformed channel identities, unsupported versions and invalid ticks fail closed. ActivitySession publishes only valid host-matching receipts in the negotiated current session, assigning its existing server sequence and exact channel epochs. Companion reception requires negotiated support, current hello epochs and host/world plus normal sequence ordering before invoking the existing frame callback. Unnegotiated/stale-channel receipts cannot become knowledge. Legacy execution-frame validation stays separate.

Validation: full offline companion suite 562/562, zero failed/cancelled/skipped; focused handshake/adapter tests 15/15. Production-linked native ACT suite 245 assertions, zero warnings/errors, covers current response epochs, unknown completion fields, unsigned tick bounds and failed handler preservation. Matching pinned Release native and companion builds passed; git diff --check passed. Receipt reception is a transport foundation: ActivityRuntime still needs exact pending-store ingestion and interruption/reset handling, and the production native observer/ordinary actor shared-ring route is not constructed. Source ordering/physical probes and MP6/G8/GTA remain open; no model-visible receipt or deployment/activation is claimed. Full goal and later phases remain active.


## Checkpoint 46: ActivityRuntime pending-store ingestion and lifecycle fencing

ActivityRuntime now owns the existing bounded DialogueActionReceipts adapter, exposes passive publication/read operations and ingests negotiated closed responses through the existing client frame callback. Publication requires ready negotiated support and current host/world; failed annotation sends invalidate pending correlation rather than fabricate handler acceptance. Receipt ingestion checks actual nativeRun/adapterEpoch/host/world, exact original publication reference/turn/body/action/publication timestamp and current retained pending data. Duplicate/unmatched/stale responses cannot append successful evidence. No activity/goal ID is invented for dialogue receipts.

Hello/reconnect, world reset and stop clear run-local receipt state; retired ACT encounter notifications clear only that encounter. Reads require the live matching negotiated scope and return bounded immutable snapshots. This store is independent of history/playback and adds no timer or provider operation. The existing requested-turn service hook and ordinary native actor routing remain unconnected, and no SELF contributor is enabled.

Validation: focused adapter/runtime tests 11/11; diagnostic TAP full offline suite 564/564, zero failed/cancelled/skipped. Two prior full runs exited early at different points with only a parent test-file failure and no diagnostic stack trace; this unresolved process-level verification issue is recorded and is not evidence of completed stability/soak acceptance. The subsequent diagnostic run completed without assertion failures. Matching current-native companion build and git diff --check passed. Production observer construction, ordinary native ring routing, requested-turn hook integration, lifetime-qualified frozen receipt contribution, source ordering/physical probes and MP6/G8/GTA remain open. Nothing deployed or enabled; full goal active.


## Checkpoint 47: C-05 ordinary actors use C-02 capture references

Source inspection confirmed ordinary TurnActor/observer anchors have captureRef but no P2 encounter/incarnation pair. Corrected the unreleased private C-05 binding accordingly: captureRef and host/world are mandatory; an owned encounter/incarnation pair is optional but all-or-nothing. Both companion/native annotation and receipt validation, retained pending scope and native callback matching now preserve that exact capture reference. Ordinary receipts cannot manufacture ownership identifiers. Native RetireCapture clears ordinary pending joins; owned retirement remains independently available. This supersedes the owned-only binding assumption in checkpoints 38–46 without creating another identity/anchor service.

Validation: ordinary and owned tests cover missing capture references, partial ownership, replacement capture, exact read/retirement and ordinary native correlation without P2 ownership. Native ACT suite 252 assertions, zero build warnings/errors. All 565 companion assertions across 60 unchanged test files passed in separate normal-Node processes with the same offline global-fetch guard. The normal aggregate TAP run captured native Node exit 3221225477; a JIT-disabled diagnostic run produced three timing-sensitive owner-proof failures, so it is not counted as passing acceptance. The isolated normal-mode result retains all assertions and verifies the change; cumulative-process crash/stability remains an unresolved verification limitation. Scratch runner/logs are outside tracked production files. Actual pinned native and matching companion builds and git diff --check passed.

Production ordinary-anchor resolution/ring routing, requested-turn publication hook wiring, frozen receipt contribution and native ordering/physical probes remain unfinished. No production observer or receipt contributor is enabled, no deployment performed, and MP6/G8/GTA/stability/soak and later master phases remain open. Full goal active.


## Checkpoint 48: native C-05 actor resolution through current shared anchors

Added owner-fiber ResolveDialogueActor to the existing promoted-character integration. It validates the closed annotation/current shared host-world, resolves only the exact C-02 capture reference, verifies the retained Ped reference/handle/address and alive body, and fails closed on missing/retired/faulting anchors. Ordinary anchors require no invented owned pair. Owned anchors additionally require the matching anchor lifetime, encounter/incarnation and existing PerceptionRoster current P1 association. A supplied owned pair cannot upgrade an ordinary anchor; an omitted pair cannot bypass owned checks. The method never calls EncounterFor, registers an identity, acquires an ACT lease or dispatches an action.

Validation: production-linked P2 lifecycle/Windows-pipe tests 99 assertions, zero warnings/errors, cover ordinary resolution with unchanged encounter/native-action counts, invented ownership, wrong world, anchor retirement, missing/wrong owned lifetime and replaced address. The test's P1 stub previously always returned false; it now exposes only exact current registered body/handle claims and clears eligibility through existing token retirement, enabling faithful owned-path checks rather than weakening production validation. Actual pinned Release native and matching companion builds and git diff --check passed. Companion source is unchanged; latest complete offline verification remains checkpoint 47's 565 passing assertions across 60 isolated normal-Node processes; aggregate-process crash limitation remains open.

The resolver still must be connected to the passive native observer and ordinary shared-ring drain, and requested-turn publication/frozen contribution/native ordering probes remain unfinished. No production receipt observer is advertised or enabled by this checkpoint, no deployment performed, and MP6/G8/GTA and all later phases remain open. Full goal active.


## Checkpoint 49: mandatory native passive-observer reset lifecycle

ActivitySession now requires an explicit reset callback whenever a passive C-05 publication observer is supplied. Transport opening/reopening and close (including world-reset close) revoke negotiation and reset pending correlation before further native lifecycle work. Reset faults suspend only C-05 support/advertisement for that session; legacy ACT handshake and heartbeat remain available. Sessions without the optional observer retain their existing constructor/default behavior. No new timer, action authority or production advertisement is added.

Validation: native ACT suite 263 assertions, zero warnings/errors, covers actual correlator pending-body release on close and reconnect, reopening without prior close, missing reset rejection, faulted reset advertisement and unaffected legacy heartbeat. P2 lifecycle/Windows-pipe tests 99 assertions and matching pinned native/companion builds passed; git diff --check passed. Companion code is unchanged, with latest complete verification still 565 assertions across 60 isolated normal-Node processes; aggregate native Node crash/stability limitation remains open.

Production observer construction/anchor-retirement fanout, ordinary shared-ring routing, requested-turn hook wiring, frozen receipt contribution and native ordering/physical probes remain unfinished. Nothing deployed or enabled; C-05/MP6/G8/GTA and later phases remain open. Full goal active.


## Checkpoint 50: opt-in native ordinary-actor callback routing

Connected the native observer factory to current C-02 actor resolution, the existing shared-ring capture fence and mandatory reset callback. Shadow/execution host startup has an internal default-false collection argument; existing RuntimeEntry calls therefore retain their default behavior. Opt-in observer setup subscribes to the existing anchor-retirement fanout, reconstructs run-local correlation for the current world on reset, and releases subscriptions/pending bodies on shutdown or fault containment. Structurally valid unavailable/retired actors omit optional evidence without revoking an unrelated ACT lease.

The existing ring drain now routes optional C-05 before legacy owned ACT processing. It reads only an original frozen pending annotation for the callback body/action, revalidates that original capture/body/owned association against current native anchors, correlates source-ordered before/handler events and publishes the closed receipt on the same session. Ordinary actors do not need P2 registration. Overflow invalidates optional joins; faults are contained to optional correlation. Existing ACT queue/receipt capacity and execution processing remain intact. No second ring, executor, timer or native task call is added.

Validation: production-linked native P2 lifecycle/Windows-pipe suite 118 assertions, zero warnings/errors, includes the ordinary annotation → shared-ring before/handler → closed receipt path, unchanged encounter/native-action counts, unavailable actor omission with live heartbeat, retirement, world reset, fresh-scope acceptance, host fault cleanup and shutdown unsubscription. Native ACT suite 263 assertions passed after the routing helper addition. Actual pinned Release addon and matching companion builds and git diff --check passed. These owner-fiber fixtures are not proof of real Essential callback ordering/acoustic/physical behavior or complete C-05 Windows interoperability. Companion source is unchanged; latest full verification remains 565 assertions across 60 isolated normal-Node files with aggregate-process crash limitation open.

RuntimeEntry configuration/build/acceptance gating, requested-turn publication hook wiring, frozen SELF receipt contribution, actual C-05 pipe interoperability/ordering and GTA probes remain unfinished. No default activation or deployment occurred; MP6/G8/GTA and later master phases remain open, full goal active.


## Checkpoint 51: requested-turn publication adapter uses original PS4 capture

Connected the existing pre-output_transcript service hook to ActivityRuntime through a pure preparation adapter. It requires one already-validated canonical action, matching validatedFor/original P0 turn identity, released original knowledge inputs, current PS anchor/index/epoch and current owned P1 proof where applicable. Only the original C-02 capture reference and optional original owned pair enter the passive annotation; no live actor/profile/action refill is performed. Current reads validate the original data. The service requires the matching PS4 native/companion build and negotiated ready ACT C-05 support before calling the existing pending-store sender. Default native loader calls still do not opt into C-05 collection, so ordinary runtime behavior remains gated.

The adapter is synchronous, immutable, provider-free and contains no raw internal transcript/profile data. Existing runSequentialTurn fault isolation and non-awaiting observer behavior preserve Essential publication timing and authority. Ordinary and owned actors use the same passive source path; pending/mismatched ownership or stale capture simply omit annotation. This is collection/wiring, not active SELF contribution or physical acceptance.

Validation: isolated normal-Node complete regression passed 568 assertions across 61 files with unchanged offline guard/assertions. An additional real-runtime service fixture passed after that run, bringing covered passing assertions to 569; the four publication-adapter tests cover frozen canonical/tuple data, invalid/stale/unavailable cases, exact owned proof and matching-build service gating. Existing real transport hook ordering/fault fixtures passed. Matching companion build and git diff --check passed. Aggregate native Node crash/stability limitation remains open; no JIT-disabled result is counted as acceptance.

Still required: native RuntimeEntry configuration/build/acceptance gates, actual C-05 Windows interoperability and Essential ordering probes, frozen lifetime-qualified receipt SELF contribution/currentness and its MP6/G8/GTA gates. Nothing deployed or enabled by default; later phases and full goal remain active.


## Checkpoint 52: C-05 receipts freeze with original P0 actor scope

Added a synchronous optional receipt capture alongside the existing ACT capture in Essential glue. It uses only the original PS4 C-02 capture, shared host/world and optional owned encounter/incarnation pair, plus negotiated ACT native-run/adapter epochs. Ordinary actors require no durable identity. The bounded last-16 receipt list and turn tuple are deep-frozen; owner release removes only the pending-proof flag after the existing parent proof succeeds and never rereads/refills receipts. Exceptions omit this optional child without blocking the Essential turn.

Added a currentness helper for subsequent single-writer integration: it rejects pending ownership, changed negotiation/native-run/adapter/host, unknown selected publication references and missing or changed original receipt contents. Current reads validate existing frozen evidence only; later receipts do not enter the original capture. Parent PS/P1 currentness remains required by the existing finalization boundary. This checkpoint does not render receipt text into requests or activate collection.

Validation: complete isolated normal-Node offline regression passed 572 assertions across 62 files; three new fixtures cover ordinary immutable capture/no late refill, owned release preserving the receipt set, selected references, channel change and unavailable/mismatched scopes. Matching companion build passed with 54 unchanged stock seams; git diff --check passed. The previously recorded aggregate-process Node crash limitation remains unresolved. No production installation, default activation or GTA acceptance occurred.

Next: closed evidence-qualified C-05 SELF templates, retained-reference/currentness integration through the existing single renderer and request pruning, then remaining native configuration/build/acceptance and real Essential/GTA probes. Full master-plan goal remains active; later phases remain unfinished.


## Checkpoint 53: bounded C-05 SELF projection through the single renderer

Added closed read-only templates for the four existing ACT2 action names (WaitHere, FollowTarget, ResumeActivity, SitOnGround). Exact original actor/host/optional owned scope, valid publication/tuple/timestamps and closed outcome/evidence/reason combinations are required. HANDLER_ACCEPTED says only that the handler accepted the attempt; FAILED says the handler reported failure, without inferring resulting physical state. Unknown/ambiguous/unsupported outcomes and arbitrary labels are omitted. The model-visible facts contain no private publication, actor, host, turn or receipt identifiers. Broader Essential action-template coverage remains required before claiming full C-05 projection.

The existing PS4 renderer accepts this contributor behind an independent default-false argument. ACT and dialogue facts share the existing SELF/manual-memory 16 KiB cap and final frame cap; whole-item budget drops remove aligned private references. Existing pruning now removes either contributor independently without shifting the other's fact/reference mapping, changing frozen canon, refilling candidates or adding another prompt writer. This is pure projection support, not active production-finalizer activation.

Validation: complete isolated normal-Node offline regression passed 576 assertions across 62 files. Four added fixtures verify qualified accepted/failed text, private metadata exclusion, wrong scope/strength/unsupported/duplicate rejection, default-off rendering and independent mixed-contributor pruning. Existing ACT pressure/pruning fixtures passed. Matching companion build passed with 54 unchanged stock seams; git diff --check passed. Aggregate-process Node crash limitation remains open. No native source changes, installation, default activation or GTA acceptance occurred.

Next: receipt-only request/lifetime watch validation with no salience acknowledgement, production finalizer contributor gates, remaining action-template coverage and native configuration/real interoperability/Essential ordering/MP6/G8/GTA probes. Full master objective remains active; later phases remain unfinished.


## Checkpoint 54: receipt-only request lifetime fencing

The existing knowledge-delivery state machine now treats retained C-05 references as optional knowledge even when no PS3 observation or ACT fact is present. Receipt-only frames therefore undergo currentness validation before send, on retry and on final valid reasoning; existing invalidation subscription/cancellation/disposal applies. Only PS3 delivery items enter salience acknowledgement, so accepted/failed/expired receipt delivery never consumes a PS3 context or reaction entitlement.

Essential finalization's existing validation and whole-item pruning callbacks now recognize retained dialogue references and call the original P0 receipt currentness helper in addition to parent PS/P1 lifetime validation. Each stale receipt can be pruned independently before first send, with no candidate refill. After send, stale evidence rejects retry/completion through the existing request lifecycle. The production renderer still does not activate the contributor: independent configuration/build/runtime/acceptance gates remain to be implemented and verified.

Validation: full isolated normal-Node offline regression passed 579 assertions across 62 files. Three added lifecycle fixtures cover receipt-only send/retry/completion, exact in-flight cancellation and one-time subscription disposal, before-send narrowing, unchanged original frame, body-hash retry rejection and zero salience consumption. Matching companion build passed with 54 unchanged stock seams; git diff --check passed. Aggregate-process Node crash limitation remains unresolved; no native changes, deployment or default activation occurred.

Next: independent contributor configuration/build/runtime/acceptance gating and actual final-request tests; broader closed Essential action templates; native RuntimeEntry collection gate; real C-05 interoperability/Essential callback ordering and MP6/G8/GTA probes. Full master objective remains active and later phases unfinished.


## Checkpoint 55: independent SELF contributor activation gates

Extended closed dialogueKnowledge configuration with optional activityFacts/dialogueReceipts off/shadow/active controls; omission remains off and the established baseline mode stays unchanged. The existing finalizer now includes original frozen ACT/receipt inputs in preview when their independent control requests shadow/active and parent/build/lifetime validation succeeds. Selected active requests include only contributors independently authorized by C-09 health for the current payload. Shadow or missing/failed acceptance never adds SELF facts to the selected allocation; optional rendering failures preserve the already selected baseline.

Added ps.activity_facts and ps.dialogue_receipts to the existing C-09 read model and bounded acceptance-record validator. Compiled support follows the existing verified matching build; runtime support requires current PS extension versions and ready shared-host ACT. C-05 additionally requires negotiated version 1. Each contributor needs its own passed record for the exact companion/native payload hash; no successful record is created, and config/passedProbes cannot substitute. Existing original-input parent/child checks and delivery/pruning watch enforce participant and transport lifetime. README documents controls, capability names and remaining acceptance limits.

Validation: complete isolated normal-Node offline regression passed 582 assertions across 62 files. New fixtures verify independent closed controls, C-09 distinct/mismatched payload records and host/negotiation loss, and real finalizer selected allocations under all receipt mode/acceptance combinations. Matching companion build passed with 54 unchanged stock seams; git diff --check passed. These are finalizer/gate fixtures, not complete provider-request or physical acceptance. Aggregate-process Node crash limitation remains unresolved.

Next: actual provider-request integration tests for ACT and ordinary/owned C-05, broader closed action templates, native RuntimeEntry collection configuration and real C-05 interoperability/callback ordering/MP6/G8/GTA probes. No deployment, default activation or accepted capability claim occurred. Full master objective remains active; later phases remain unfinished.


## Checkpoint 56: actual ordinary C-05 provider-request coverage

Extended the existing source-pinned stock-controller integration suite with all nine buffered/structured-streaming/early-TTS × typed/microphone/internal-turn combinations for an ordinary actor's original frozen C-05 receipt. Fixtures generate the accepted receipt through the real bounded DialogueActionReceipts publication/callback/read path, then exercise original P0 capture, production finalizer, controller/backend orchestration and serialized reasoning request. Captured final request bodies contain qualified handler-only SELF text, omit actor/host/transport/publication identifiers and private references, preserve genuine player input/internal-turn restrictions, and retain established PS4/PS6 acknowledgement separation and listener cleanup.

Three additional actual in-flight provider fixtures remove the original receipt, retire the actor or replace the ACT transport epoch. Each cancels the exact request and prevents assistant history commit; reset/actor cancellation leaves independent receipt evidence intact when the receipt store itself was not retired. C-09 active status is deliberately injected as an acceptance-boundary fixture here; this does not manufacture physical acceptance or replace the independent real C-09 gate tests from checkpoint 55.

Validation: full isolated normal-Node offline regression passed 594 assertions across 62 files; the updated stock-controller file passed all 32 tests, including the twelve new provider/invalidation cases. git diff --check passed. Production source/native payload is unchanged from the previously built checkpoint 55, so no new build is claimed or required by this test-only change. Aggregate-process Node crash limitation remains unresolved.

Still open: actual owned C-05 and ACT contributor provider-request fixtures, no-late-refill adversarial mic/request timing, broader Essential templates, native RuntimeEntry collection control and real pipe/callback/physical MP6/G8/GTA probes. No installation/default activation/acceptance claim. Full master objective remains active; later phases remain unfinished.


## Checkpoint 57: owned SELF requests and explicit passive collection startup

Added actual stock/Luna request fixtures combining original owned ACT facts and C-05 receipts with fresh P1/P2 preparation. Both children remain pending at P0 and are released only with the original matching owner/host proof. Facts/receipts published while that proof waits do not refill the frozen request; captured authored canon remains unchanged after profile edits. A changed ACT epoch omits SELF while retaining valid PS2/PS3 delivery; mismatched P1 host omits optional knowledge. Final serialized bodies exclude private actor/character/encounter/publication/transport provenance.

Connected RuntimeEntry's existing shadow/on host startup to an explicit activities.dialogueReceipts opt-in. Only literal JSON true enables passive native correlation on the existing host fiber; omitted/false/string/numeric values do not authorize it. With ACT off/unsupported mode, no host is started. The companion preserves only a literal true collection control and the real pre-publication service requires it in addition to matching build/current original scope/negotiated C-05. Neither flag enables ACT dialogue dispatch, changes ACT mode or grants SELF/physical acceptance. Both examples remain false/off; native/companion README documents the separate collection and projection gates.

Validation: complete isolated normal-Node offline regression passed 599 assertions across 62 files. The owned/profile stock-controller suite passed nine tests including three new original-proof/no-late-refill/child-epoch cases. Production-linked native RuntimeEntry suite passed 154 assertions covering concurrent lifetime admission plus off/shadow/on/invalid modes × omitted/false/true/string/numeric collection inputs. That harness reports one existing unused-event stub warning and zero errors. Native ACT suite passed 263 assertions; P2 lifecycle/Windows-pipe suite passed 118, both zero warnings/errors. Actual pinned Release native addon and final matching companion builds passed, 54 stock seams unchanged; git diff --check passed. Aggregate-process Node crash limitation remains unresolved.

Still required: full owned/ACT streaming/mic and independent no-PS3 adversarial request coverage, broader Essential closed action templates, real cross-process C-05 interoperability and source publication/callback ordering probes, controlled MP6/G8/GTA acceptance, truthful owner/native admission acceptance and later master phases. No installation, default activation, successful acceptance receipt or GTA completion claim. Full objective remains active.


## Checkpoint 58: real cross-process C-05 receipt interoperability

Added a test-only serve-dialogue mode to the existing production-linked native ACT test executable. It runs the existing ActivityChannel/ActivitySession, SupersessionMonitor ring, DialogueActionCorrelator and native receipt publisher over the current-user Windows pipe, with synthetic body/before/handler callback records and no game assemblies or StepRunner executor. The Node harness uses the real ActivityRuntime/client/publication/receipt store and closed SELF projector, not a replacement wire decoder.

The actual .NET↔Node path verifies ordinary and owned binding shapes, both accepted and failed handler results, exact original tuple/publication timestamp/game tick association, model-private receipt provenance, stale-host rejection without sequence consumption, unchanged passive activity count, cleared receipt evidence at stop/reconnect and fresh-tuple acceptance after reconnect. The standalone harness reports 24 checks and is registered in the offline suite on Windows. README records build/run instructions and scope limits.

The first fixture run timed out because the helper reused the timestamp sampled before pumping input when draining callbacks accepted during that pump. Its later acceptance timestamp could appear ahead of the reused drain time and correctly trigger correlation's regression fence. The helper now samples fresh drain time; the production ActivityCommands path already samples fresh time for each Match and is unchanged. Two subsequent standalone runs passed, then full regression passed.

Validation: complete isolated normal-Node offline regression passed 600 assertions across 63 files. Standalone C-05 pipe fixture passed 24 checks on each repeat. Native ACT executable built with zero warnings/errors and retained all 263 contract assertions. git diff --check passed. Production source/native package is unchanged from checkpoint 57; no additional build or installation is claimed. Aggregate-process Node crash limitation remains unresolved.

Open: adversarial real-peer rejection/epoch/overflow fixtures, actual Essential publication/before/executed order and actor-resolution physical probes, broader closed action templates, full owned/ACT streaming/mic and no-PS3 adversarial request coverage, MP6/G8/GTA and later master phases. Synthetic transport success is not physical acceptance. No default activation, successful acceptance record or deployment. Full master objective remains active.


## Checkpoint 59: malformed native peers and complete owned SELF request matrix

Expanded the real Windows C-05 peer fixture to inject mixed-host, stale-world, sequence-gap, trailing-newline action and half-owned binding packets directly on the transport, bypassing only the Node sender validator within this test. The production native session independently rejects each packet. Each case first creates genuine pending receipt-store evidence, then verifies that connection rejection clears pending and completed receipts, a replacement connection revives none of the old evidence, and a fresh tuple/publication receives its own receipt. The standalone fixture now proves 49 checks across five rejected peers and their recoveries; callbacks remain synthetic and no executor/game assembly runs.

Expanded original-owner ACT/C-05 provider-body coverage to all nine buffered/streaming/early-TTS × typed/microphone/internal-turn paths. Five scenarios per path exercise matching original proof, mismatched P1 host, child ACT epoch replacement before projection, SELF-only requests with no PS3 observations, and SELF-only ACT epoch replacement after first provider send. The 45 matrix cases preserve original pending-child release, frozen canon/facts/receipts despite late writes, private provenance exclusion, independent PS4/PS6 acknowledgement and listener cleanup. In-flight SELF-only invalidation aborts the actual request and prevents assistant history commit without salience consumption.

An initial matrix attempt waited for P1 preparation before microphone input had launched reasoning, causing fixture timeouts. The confirmed failing test process was stopped; the fixture now ends captured mic input before waiting on the existing preparation gate. Production turn ordering was not changed or bypassed. Focused mic/typed/internal cases and the complete updated file then passed.

Validation: full isolated normal-Node offline regression passed 642 assertions across 63 files, including the actual Windows peer test. Owned/profile controller file passed 51 cases, comprising the 45 matrix cells plus six retained baseline cases. Standalone Windows peer fixture passed all 49 checks; git diff --check passed. Production source/native payload is unchanged from checkpoint 57; no new production build or installation is claimed. Aggregate-process Node crash limitation remains unresolved.

Open: real-peer native world-reset/late-callback/overflow ordering fixtures, actual Essential callback/body-resolution physical probes, broader Essential action templates, exhaustive remaining PS4 T/G/GTA audit, owner/native admission acceptance and later master phases. These checks do not establish physical MP6/G8/GTA acceptance or generate a passed receipt. Defaults remain off; full master objective remains active.


## Checkpoint 60: complete pinned registry-action SELF templates

Expanded the existing closed C-05 attempt-description map from four ACT2 names to all 65 native registry canonical names in the current Essential action catalog. The map stays static inside the existing read-only projector; no registry/handler/executor, model-visible action catalog or publication permission is added. Native registry-only names still require the established validated-publication/current-body receipt path before any fact can exist. The five parser-only bridge entries and unpublished aliases remain omitted because their catalog evidence does not establish this registry handler receipt path.

All descriptions express attempts, never target/parameter identities, mode establishment, arrival or completion. Accepted output retains handler_only strength and the existing explicit physical-execution/completion qualification; failed output retains the handler-failure/resulting-state distinction. Existing exact actor/host/owned scope, pending-proof/currentness, finite receipt pool, shared SELF budget, aligned private references and final request gates are unchanged. README now states current template coverage and preserves external physical limits.

Validation: new catalog-driven fixtures verify exact coverage and accepted/failed semantics for every native canonical name, rejection of all five bridge-only entries and unpublished aliases, and private publication exclusion. The tests freshly verify the catalog against the actual pinned Essential DLL SHA-256, stock bundle SHA-256 and native metadata artifact SHA-256 using existing verifiers. Full isolated normal-Node offline regression passed 644 assertions across 63 files. Matching companion build passed with 54 unchanged stock seams; git diff --check passed. No native source change/new native build is claimed. Aggregate-process Node crash limitation remains unresolved.

Open: real-peer world reset/late-callback/overflow ordering, physical Essential callback/body-resolution probes across applicable action paths, remaining PS4 T/G/GTA audit, owner/native admission acceptance and later master phases. Static template coverage does not establish callback delivery or physical MP6/G8/GTA acceptance for any action. Defaults remain off; no installation/acceptance record was produced. Full master objective remains active.


## Checkpoint 61: user-authorized playable v1.0 scope revision

The user replaced the full-master implementation objective with a finite playable v1.0 milestone: finish Phase 6 C-05/C-06, close baseline PS4 acceptance, then implement Phase 13a context-aware spontaneous speech. Phase 10a is included only if actual Essential behavior proves insufficient; unknown behavior cannot justify another gaze driver. All other unfinished phases are deferred and existing work remains intact.

The new milestone document defines the unchanged master limits, exact native ticket/intake/playback and empty-effect requirements, automated requirement audit, external GTA gates and stopping boundary. ROADMAP, CURRENT and the master plan link the scope override without editing the immutable PR #21 plan or settled contracts. The previously planned standalone C-09 F11 presentation is deferred; existing health gates remain.

This checkpoint changes documentation only. Checkpoint 60 remains the latest implementation/validation evidence; no fresh production build/test result, deployment, active configuration or GTA acceptance is claimed. The goal remains active under the user's revised scope. Next: remaining Phase 6 ordering/ownership validation, baseline PS4 requirement closure, then Phase 13a. Stop at this boundary with physical acceptance explicitly documented rather than claiming all later master phases complete.


## Checkpoint 62: Phase 6 cross-process reset and overflow ordering

Extended the production-linked C-05 Windows pipe fixture with owner-fiber test controls through helper stdin, outside the production wire vocabulary. Original before/handler callbacks can be held across a native world reset or shared-ring overflow. The fixture proves native pending association retirement, companion pending/completed evidence reset on world discontinuity, discarded late/overflow callbacks, and fresh-connection publication recovery in the updated world. It preserves real ActivitySession/ActivityChannel, SupersessionMonitor, DialogueActionCorrelator and Node ActivityRuntime; no executor/game assembly runs.

The first reset fixture failed because its test host did not refresh the cached pipe hello after changing world epoch. Inspection confirmed production ActivityCommands already calls WorldChanged, RefreshHello and Flush together. The helper now follows that same sequence; no production transport or lifecycle change was needed. Overflow drain likewise follows production's invalidate-before-drain ordering. The harness now reports 66 checks, retaining the earlier ordinary/owned, failed/accepted and five malformed-peer scenarios.

Validation: native ACT harness rebuilt with zero warnings/errors and passed 263 assertions; standalone real Windows pipe harness passed all 66 checks. Complete normal-Node isolated offline regression passed 644 assertions across 63 files, including the expanded pipe fixture. git diff --check passed. This changes only test infrastructure/documentation; production source and packaged runtime remain unchanged, so no fresh production build/install claim is made. The aggregate-process Node crash limitation remains open.

Remaining v1.0 work: native C-06 owner-transition/admission audit and applicable missing tests, baseline PS4 T/G requirement closure, Phase 13a implementation/automated acceptance, and external physical callback/owner/PS4/initiative gates. Synthetic callback ordering is not Essential/GTA acceptance. Conditional gaze remains deferred pending evidence of insufficient stock behavior; other master phases remain deferred. The revised milestone goal remains active.


## Checkpoint 63: production C-06 owner-sample matrix

Audited native owner transitions: P2 follow/wait set p2 owner; ACT BeginOwnership sets act/activity; both normal and preempted EndOwnership call RefreshPrimaryOwner instead of assigning idle; suspend resamples after releasing control; retirement sets none/unknown. RefreshPrimaryOwner samples only the original registered body and conservatively preserves Essential residual follow/paused-follow/sit, conflicting modes/reflex/directed interaction as unknown, and unavailable/failed samples as none/unknown. Repeated unchanged ownership preserves since. Empty state does not establish idle.

Added production RefreshPrimaryOwner tests to the existing P2 lifecycle harness, covering eight native sample shapes, stable since, null/throwing reads, reused address and absent registration. The test stub now permits explicit null samples rather than silently substituting an empty state, so missing evidence is exercised faithfully. No production policy, task or owner authority changed.

Validation: lifecycle harness rebuilt with zero warnings/errors. Its sandboxed Windows-pipe run timed out; the authorized unsandboxed run passed all 157 assertions (previously 118). git diff --check passed. Production and Node code are unchanged, so prior checkpoint-62 normal-Node 644/63 regression remains the relevant evidence; no redundant companion build is claimed.

Limits: the lifecycle harness links production owner sampling but substitutes the ACT world binding; it does not directly exercise production EssentialActivityWorld BeginOwnership/EndOwnership against game state. StepRunner tests cover ownership calls with a fake world, and the production addon compiles the actual world, but neither is physical proof. Those transitions and Q/F/K/R/FR probes remain explicit MP6 GTA gates. Phase 13a admission must resample native busy/safety/player state and exact identity; a C-06 token or empty NpcState is not sufficient permission. No idle inference or automatic restoration was introduced.

Next: baseline PS4 requirement-to-evidence audit and remaining concrete automated gaps, then the checked Phase 13a ticket/intake pipeline. The user-authorized v1.0 goal remains active; physical gates are unaccepted and other master phases deferred.


## Checkpoint 64: PS4 requirement inventory and actual overlapping actors

Started the explicit baseline acceptance audit with machine-readable/Markdown inventories preserving PR #21's exact 81 test oracles and nine gate definitions. Verified all IDs are unique/complete, candidate evidence paths exist and the immutable authority hash is unchanged. Candidate harness links are deliberately marked unreviewed until their concrete assertions match the full compound oracle; the inventory is not a passed-test manifest. Radio-only T77/T78/T80 are deferred by v1.0 scope; T79 retains its ACT portion. Physical G7/G8 remain external. T64's existing reasoning-before-TTS-failure tests were inspected and their injected-frame scope is documented rather than overstated as direct active-ledger coverage.

Added a real patched-stock overlapping-actor buffered request test for T51. A's firing request is held while B's sampled self-injury request proceeds through the same PS2/PS3 runtime and actual provider serialization. Each request retains its own observation/current input and excludes the other input plus private refs/host IDs. B commits its assistant history; exact cancellation of A aborts only A, prevents its assistant history and releases all knowledge listeners. The fixture uses the existing stock Qi cancellation path; no production scheduling or pipeline change. Owned canon overlap and other modes remain separately reviewable parts of T51.

Validation: focused T51 test passed; complete normal-Node isolated offline regression passed 645 assertions across 63 files. Inventory structural/source equality checks and git diff --check passed. Production sources/payload are unchanged; no new production build/deployment or physical acceptance is claimed. The aggregate-process Node crash limitation remains open.

Next: review the inventory's compound requirements against concrete assertions, implement missing automated cases (including direct active-ledger reasoning/TTS failure where needed), refresh the complete native/build acceptance matrix, then implement Phase 13a. The user-authorized v1.0 objective remains active and other master phases deferred.


## Checkpoint 65: direct active PS3-ledger reasoning versus speech acceptance

Closed PR21 T64's automated oracle with actual active PS2/PS3/stock-controller/provider fixtures rather than a substituted delivery frame. Buffered, structured-streaming and early-TTS paths each send the qualified frozen firing observation and acknowledge its original decision key exactly once only after successful final reasoning. A later TTS failure preserves ps4_context consumption, consumes neither ps6_ticket nor ps5_memory, commits the genuine user input once, excludes assistant history and releases knowledge listeners. The finalizer wrapper observes the real delivery success only; it neither replaces knowledge nor fabricates acknowledgement.

Expanded the existing actual early-TTS partial-PCM negative fixture to separately test contradictory final output and a stream that closes without any final model result. Both produce partial audio yet consume no ledger entitlement and commit no assistant history. The acceptance register now records T64 as automated_oracle_verified with exact test pattern/evidence; other compound requirements and physical gates are not promoted by this pass.

Validation: all five focused T64 fixtures passed. Full normal-Node isolated offline regression passed 649 assertions across 63 files; the actual active request suite passed 37 cases. git diff --check passed. Production source/payload unchanged; no new build/install/activation or GTA acceptance claimed. Aggregate-process Node crash limitation remains open.

Next: remaining individual baseline acceptance oracles and fresh native/build closure, then bounded Phase 13a on the same ticket/Essential/frozen-frame/playback architecture. v1.0 goal remains active; deferred phases remain outside current implementation scope.


## Checkpoint 66: exact terminal acknowledgements through actual retries

Closed PR21 T65's automated oracle with six actual active PS2/PS3/stock-controller fixtures: retry success and exhausted HTTP failures in buffered, structured-streaming and early-TTS modes. Both attempts send identical serialized bodies and observe zero acknowledgement calls before provider execution; only the final successful/failed result reports delivered/rejected exactly once for original captured decision keys. Success commits assistant history, failure does not; genuine user input is committed once, PS6/PS5 entitlements remain untouched and knowledge listeners are released. No production retry/lifecycle code changed.

Strengthened existing refusal/incomplete/shape-invalid fixtures to inspect the real ledger acknowledgement trace directly, and added syntactically invalid JSON. Each terminal failure reports rejected only for original keys and consumes none. Combined direct active-ledger fetch-start/final-result traces and the inspected existing preview/prepare/pruning one-shot delivery tests also close T63's automated oracle. The audit register now records T63/T64/T65 as individually verified; other requirements/gates are not promoted by an aggregate count.

Validation: focused retry/output-failure matrix passed all ten cases. Complete normal-Node isolated offline regression passed 656 assertions across 63 files; git diff --check passed. Production source and payload unchanged, so no fresh production build/install or physical acceptance is claimed. Aggregate-process Node crash limitation remains open.

Remaining: other individual baseline oracles, complete matching native/build gate refresh, then Phase 13a checked speech tickets/intake/empty effects/full-playback lifecycle. Physical MP5/MP6/MP13a gates remain external; conditional gaze and all deferred phases retain their user-defined scope. v1.0 objective remains active.


## Checkpoint 67: selected manual-memory ordering and privacy

Closed PR21 T39's automated oracle by combining the existing ten-selected-memory renderer fixture with an explicit five-pin importance/private-ID tie fixture. A higher-importance unselected record remains excluded; reversed source order produces identical scene bytes; the authored profile remains unchanged. Both request-schema serializers include each selected text once and exclude every private memory ID, note and related-character canary, while preserving the genuine player input and existing final request byte bound. Private IDs remain only in internal frame references. No production canon/profile/persistence implementation changed.

The acceptance register records T39 individually verified. This fixture's privacy/order evidence does not separately claim recognition-aware relevance in T41 or complete observation/Map-order determinism in T45. Physical authored-memory conversation acceptance remains an external PS4 gate.

Validation: complete renderer suite passed 15 cases. Full normal-Node isolated offline regression passed 657 assertions across 63 files; git diff --check passed. Production source/payload unchanged; no fresh production build/install/activation or GTA acceptance is claimed. Aggregate-process Node crash limitation remains open.

Next: remaining compound baseline requirements and matching native/build closure, then Phase 13a. User-authorized v1.0 objective remains active; other master phases remain deferred.


## Checkpoint 68: combined PS4 pressure and deterministic request bytes

Closed PR21 T44/T45 automated oracles with a production selector→renderer→request serializer fixture combining 128 selected authored pins, 30 oversized prior messages, 100 routine competing observations, one must-include sampled self-injury and large escape-heavy genuine current input. The safety claim remains first and intact; memories/history/routine items are dropped whole with bounded reported counts. Shared canon, allocation and both final request-schema byte budgets hold. Separate all-safety capacity pressure reports exactly 93 omitted safety items; reversal retains the same deterministic result.

Reversing irrelevant observation/pin order and Map-derived live-reference insertion produces identical model allocation, exact selected delivery references and both serialized request bodies without mutating inputs. Committed history order remains untouched. This is combined final-request serialization evidence, not only selector rank equality. No production budget, ordering, store or renderer implementation changed.

Validation: full selector suite passed seven cases. Complete normal-Node isolated offline regression passed 658 assertions across 63 files; git diff --check passed. Acceptance register records T44/T45 individually verified; other compound requirements and physical gates remain unclaimed. Production source/payload unchanged; no fresh build/install/default activation or GTA acceptance is claimed. Aggregate-process Node crash limitation remains open.

Next: remaining individual baseline oracles and matching native/build closure, then Phase 13a. Revised v1.0 goal remains active; conditional gaze and other phases remain deferred under the user's boundary.


## Checkpoint 69: exact serialized Unicode and history allocation

Closed PR21 T42/T48 automated oracles with a mixed emoji/CJK/combining-character/quote/backslash/control fixture through production renderer and both final request-schema serializers. It verifies exact UTF-8 byte counts, decoded nested scene content, preserved authored/genuine text, exclusion of invalid system/tool/nonstring history, exact whole-message suffix retention and one current terminal user allocation. Existing escape-heavy maximum-input and malformed-surrogate fixtures were inspected as complementary encoding/budget evidence.

Inspected the existing actual patched-stock microphone oversize-STT fixture: a 12001-unit accepted transcript fails before fetch (zero provider calls), retains established truncated accepted-player history policy and commits no assistant response. Combined evidence closes the mandatory-input part of T48. It does not promote every optional error branch in T49 or physical gate. No production serializer/lifecycle implementation changed.

Validation: renderer suite passed 16 cases. Complete normal-Node isolated offline regression passed 659 assertions across 63 files; git diff --check passed. Acceptance register records only T42/T48 individually verified. Production source/payload unchanged; no fresh build/install/activation or GTA acceptance is claimed. Aggregate-process Node crash limitation remains open.

Next: remaining individual baseline acceptance oracles and matching native/build closure, then Phase 13a. Revised v1.0 objective remains active; deferred master phases remain outside current implementation scope.


## Checkpoint 70: actual optional projection failure fallback

Closed PR21 T49 automated oracle with actual buffered/structured-streaming/early-TTS stock-controller requests that fault optional renderer enumeration after genuine P0 capture. Original lifetime/currentness checks remain in place. Each path reports projection_failed, sends one hardened base request with genuine player input and no perceived/raw/private canaries, consumes no salience entitlement and completes ordinary assistant history/listener cleanup. The test observes the production finalizer; no rendering, authorization or request implementation changed.

Complementary existing unsupported-build/host/world/capture/situation actual fallback tests, stock microphone mandatory-input overflow zero-fetch test and both provider instruction-overflow zero-fetch checks were inspected. Combined evidence closes T49; it does not imply all other optional-service failures or any physical acceptance gate passed.

Validation: three focused actual projection-failure fixtures passed. Complete normal-Node isolated offline regression passed 662 assertions across 63 files; git diff --check passed. Acceptance register records T49 individually verified. Production source/payload unchanged; no fresh build/install/default activation or GTA acceptance is claimed. Aggregate-process Node crash limitation remains open.

Next: remaining baseline oracles and matching native/build acceptance refresh, then bounded Phase 13a. Revised v1.0 goal remains active; all other master phases remain deferred.


## Checkpoint 71: original owned association and first-turn proof audit

Reviewed existing original-capture and first-owned proof suites against T06/T29 rather than duplicating their substantial actual provider matrix. Added explicit captured encounter/incarnation/profile disagreement checks in the production capture fixture; each rejects owner join, and restoring the original fields succeeds. Existing wrong-actor, P1 host/claim mismatch, pending binding/revision/tuple/currentness/retirement tests cover the remaining association fences.

Existing character service fixtures prove a mismatched/revoked claim never releases persistent canon, absent-at-freeze profile stays absent despite late loading, and actual first-owned requests retain captured canon/observations across proof awaits without refill. Actual owned ACT/C05 provider matrix exercises matching/mismatched P1 host and child epoch/lifetime scenarios in all nine request paths. The acceptance register now records T06/T29 individually verified. No production identity/proof/freeze implementation changed.

Validation: focused knowledge-input suite passed 13 cases; existing frozen-character/owned-provider suite passed 51. Full normal-Node isolated offline regression passed 662 assertions across 63 files; added assertions do not increase the test-case count. git diff --check passed. Production source/payload unchanged; no fresh build/install/activation or physical acceptance claimed. Aggregate-process Node crash limitation remains open.

Next: remaining individual baseline acceptance groups and matching native/build closure, then Phase 13a. User-authorized v1.0 goal remains active; other master phases remain deferred.


## Checkpoint 72: T20 scope fences and paused web handoff

Closed the T20 automated oracle with positive controls and observer/run/expiry/identity/revision/decision-key/source/target scope negatives in production selector/input fixtures. A different syntactically valid decision key rejects delivery; no production implementation changed. Focused selector/input suites passed 8/13 cases. Complete normal-Node isolated offline regression passed 663 tests across 63 files, with no failed files.

The user requested a good stopping point and submission of all unfinished work for web continuation. See WEB-IMPLEMENTATION-HANDOFF-20261009.md for authoritative v1.0 scope, remaining baseline acceptance and Phase 13a work, prior native evidence, tooling limits and external GTA gates. The actual isolated runner is preserved under tools/isolated-offline-tests; logs stay outside the checkout. Implementation is paused, not complete; no deployment, activation, physical acceptance or merge is claimed. Resume only on user instruction.

## Checkpoint 73: bounded, default-inert Phase 13a deterministic policy selection

Web continuation from PR #23's clean checkpoint-72 handoff. Added `src/perception/sceneDirector.mjs`, a **read-only selection function**, and `tests/scene-director.test.mjs`. The policy accepts only an explicitly bounded observer-qualified PS2/PS3 candidate slice, exact speaker/player references, a supplied current PS3 entitlement, original observation/decision identity and revision, current situation/lifetime, and source-time monotonic age. It orders routine/urgent speech proposals deterministically and returns a frozen reference-only proposal with a strict expiry. It produces no trigger text, prompt, DO, activity, ticket, model call, native request, salience acknowledgement or memory write. The established 13a policy limits are constants for the future invariant admission shell; **none of these budgets is yet enforced as a runtime reservation**.

Four standalone normal-Node tests passed in the available Linux tool container (`node --test`), covering proposed speech-only shape, stale/unauthorized evidence refusal, urgent expiry and ordering/bounds. The committed source and test files were subsequently refetched from the connected GitHub branch. This is **not** a rerun of the previous 663-test Windows isolated suite; native/.NET, complete production companion build and physical GTA testing are unavailable in this container and remain unclaimed.

This pure selector is not connected to the PS3 live ledger, native DirectorAdmission, ticket/intake transport, actual Essential special-turn admission, output effect guards, or full-playback acknowledgement. It cannot initiate speech and has no production behavior while unwired. The authoritative next work remains: finish individual baseline PS4 automated acceptance and final matching native/companion build; implement the bounded Phase 13a admission shell, native PS pipe ticket transport, checked Essential intake, effect rejection, playback outcome and required all-path tests; document and execute external GTA acceptance separately. Retain all default-off gates, do not merge or deploy, and do not claim milestone completion.

## Checkpoint 74: PR #23 web continuation, Phase 13a guarded design and CI verification

Starting from checkpoint 73, committed `src/perception/sceneDirectorAdmission.mjs` as a **default-off, RAM-only invariant shell**, with `tests/scene-director-admission.test.mjs`. It enforces one global pending/in-flight reservation, four attempted starts/minute (counting failed safety checks), routine/urgent per-speaker cooldowns, scene gap, bounded two-second pre-admission tickets, one-time UUID consumption, exact host/world/speaker/listener/owner incarnation/proof/player-turn/policy binding and mandatory injected live currentness checks on reserve, consume, after hydration, before publication, binding and complete playback. It binds an **actual supplied** Essential tuple only after admission and acknowledges `ps6_ticket:delivered` only after a matching complete, non-interrupted, audio-present native playback receipt. It does not infer a tuple, call the provider, allocate a native turn, send PCM, issue DO, write memory or activate any capability. Original selection TTL is required through publication but is not incorrectly reapplied after long successful playback. Budget tables are bounded and never reset by a selector.

Committed `src/perception/directorDecisionGuard.mjs` with `tests/director-decision-guard.test.mjs`, and added an unconditional pre-stock-action guard in `src/openai/runSequentialTurn.mjs` for turns carrying a Director ticket or source. Nonempty commands, activity proposals, invalid ticket IDs or invalid Director streaming modes fail before the stock action validator/`output_transcript` dispatch. Original player/internal/special turns without a Director ticket retain E1–E6 behavior. The guard is defense-in-depth; it does **not** prove native ticket authenticity, stock `kb` admission or effect rejection in pinned Essential hooks.

Added `.github/workflows/lsa-v1-offline.yml` for Node 22 isolated normal-Node verification on both Linux and Windows, plus focused Phase 13a tests, and bounded CI-only error excerpts in the existing isolated test runner (the first diagnostic regex was corrected to literal matching after CI exposed it). The initial workflow on commit `5955fc5` **passed all 12 then-committed focused Phase 13a tests on both runners**. Its full isolated suites failed on intermittently failing `frozen-character-inputs.test.mjs`, and Windows additionally failed `dialogue-action-interop.test.mjs`; no blanket clean regression claim is made. Further CI runs (including the guarded decision tests and corrected diagnostics) must be judged by their actual results, never assumed green.

**Explicit implementation blocker:** the production `native/intelligence/IntelligenceChannel.cs` is `PipeDirection.Out` (factual observations only); Phase 13a still needs a *separately versioned, checked reserve/submit/cancel vocabulary* through that existing PS transport, owner/Core-fiber intake, source-pinned Essential `kb` special-turn admission, native one-shot UUID consumption, authoritative live C-06 busy/reflex/player-priority checks, an actual Essential tuple, matching native playback mapping and cancellation callbacks. No such native path is implemented, compiled or GTA-tested by the web additions; no synthetic PS6 request can be enabled or claimed to work. Windows/GTA dependencies and the pinned Essential runtime needed to verify these seams are not available to this web execution container. The source-pinned native route must be implemented and validated before the shell is connected or the milestone is declared complete.

**Open acceptance:** full individual PR21 T/G baseline review, matching final native/companion builds and hashes, ACT C-05/C-06 callback/physical owner gates, PS4 GTA G7, PS6 MP13a A33/A34/A39/A40, and all remaining full regression failures. Phase 10a remains conditional with no evidence yet requiring it. All gates remain off; no merge, install, deployment, native-effect permission or GTA acceptance.

## Checkpoint 75: CI source build and non-green regression diagnosis

On PR #23, GitHub Actions has executed the focused Phase 13a selector/reservation/decision-guard matrix **16/16 passing** on Linux and Windows. The Windows job on commit `bbc4f4f` successfully built the actual `native/activities/tests/ActivityTests.csproj` source helper; a later CI revision `4efb499` additionally includes execution of its standalone ACT contract suite (see that run for its result). This restores the cross-process test's missing `ActivityTests.exe` prerequisite without skipping that test.

The full isolated normal-Node suites on earlier CI commits are **not clean**: `frozen-character-inputs.test.mjs` intermittently fails during its many matrix cases with `Cannot read properties of null (reading 'name')` when the expected P1 profile canon was not released. The failure is present on both platforms and at variable matrix indices; it appeared before the new Director decision-guard integration. The identity preparation contract caps timeout at 25–1000 ms, so the CI fixture cannot simply raise the deadline without changing the production contract; this failure requires investigation against source and exact per-case timings, not weakened assertions or a fictional pass. An earlier Windows CI run also failed `dialogue-action-interop.test.mjs` due to missing unbuilt helper EXE; the prerequisite has now been fixed by Windows CI source build.

These are **test/build evidence only**. No native C-11 Director ticket intake, checked Essential `kb` binding, in-game effects veto, native tuple source or physical playback acceptance was implemented by the standalone JavaScript selector/guard/shell. The PR remains draft, with default-off gates and all previously recorded external acceptance and baseline 81-oracle review still open. Phase 10a remains unsupported by gaze-insufficiency evidence and deferred.

## Checkpoint 76: native Director shadow-transport seam, source-time candidates, and clean cross-platform CI

PR #23 remains a draft and unmerged. Scope is still the [v1.0 milestone](lsa-v1-implementation-milestone.md): finish Phase 6, baseline PS4 acceptance, and Phase 13a. This checkpoint advances accessible automated implementation, **not** an installed, active, GTA-accepted or production-release-ready feature.

### Implemented and kept default-off

- Native `DirectorAdmission` provides an independently checked, one-use reserve/submit/cancel UUID contract with bounded replay history, attempt rate, two-second pending expiry, precise host/world identity, and exact tuple/playback outcome checks. The `DirectorFrameCodec` validates a closed 17-field, versioned request. `IntelligenceChannel` can optionally receive a bounded inbound Director vocabulary on the *existing* PS pipe, with an off-fiber socket reader and owner-fiber handoff. The unmodified legacy mode remains **output-only**. `IntelligenceIntegration` explicitly rejects all admission in its **shadow preview** and never delegates native GTA effects or Essential speech to this path.
- Companion `directorWire`, `IntelligenceClient` and `ShadowRuntime` negotiate the optional protocol, submit one-shot requests without retrying backpressure, bind exact receipts with timeout/disconnect cancellation, and retain at most 32 inert receipts. The original PS2 native signal age now survives privately into observer-qualified PS3 candidate selection, so policy refresh cannot revive old source evidence. Candidate reads never allocate turns or consume response grants.
- `SceneDirectorSpeech` composes deterministic proposal choice, PS3 reservations and a hypothetical exact native/stock completion path behind injected admission/dispatch dependencies. Its production owner and scheduler remain **unwired**. The pinned stock `kb` guard rejects claimed PS6 input before hydration without an independently verified ticket; the post-hydration proof callback is also fail-closed. The `DirectorDecisionGuard` bars physical DO/activity proposals for actual Director-tagged turns without affecting ordinary player/mic/special turns. A null-ticket classification regression was identified and corrected.
- PS4 PR21 T01–T04 have now been individually reviewed against executed source-native tests and changed from candidate mapping to **automated_oracle_verified** in the JSON/Markdown audit: shared PS/ACT lifetime and non-promotion, exact wrapper/handle/address/owner transitions, 256/16/32 reference caps with conversation priority, and retirement/failed-subscriber fanout. This is **16** individually automated-verified requirements overall, not 81/81 acceptance.

### Reproducible automated receipts

GitHub Actions run [37988428015](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/37988428015) on source SHA `2bbdde7e84872426c751198aca8ba33696c4f92a` finished **success** on both runner operating systems:

- Linux normal-Node isolated regression: **698 passed across 70 files; no failed files**.
- Windows normal-Node isolated regression: **698 passed across 70 files; no failed files**.
- Focused Phase 13a module/stock-contract suite: **33 passed on each platform**.
- Windows native ACT standalone source-built test binary: **263 assertions passed**.
- Windows production-source shared intelligence tests: **115 assertions passed**.
- Windows isolated native PS6 ticket/channel tests: **55 assertions passed**.
- Windows production intelligence host integration stubs: **86 assertions passed**.

The previous repeated `frozen-character-inputs.test.mjs` red run was traced to a **test fixture collision**: `setup()` overwrote its mock native owner client in `f.native` with a plain turn identity tuple. `CharacterService.syncEncounters` only attempts its native `request('roster')` after the five-second throttle, producing timing-dependent optional canon failures late in the matrix. Test injection now uses a separately retained `nativeOwner` client and explicitly checks its request interface; temporary CI diagnostics were removed, and the final full run is green. No production safety checks or expectations were weakened.

### Not completed or accepted

- **Phase 13a is not functionally complete:** native C-06/player-priority live admissibility, an *authorized* owner-fiber reserve/submit path, independent post-hydration and pre-publication checks, actual Essential zero-delay scheduler binding, native real turn/generation/session tuple ownership, authoritative playback callback reconciliation, and the fully traced player-takeover path remain unimplemented or unaccepted. The test composer uses injected doubles and the only current production native endpoint is a rejecting shadow preview; no spontaneous NPC speech can be enabled from this checkpoint.
- Remaining baseline PS4 individual T/G oracles and Phase 6 late-callback/world-reset/physical-owner gates must be audited without replacing proof with aggregate counts. Final pinned full Windows RPH/GTA addon build and payload hashes were **not** established by this CI run; the Windows test binaries and stubs do not substitute for the real game host.
- GTA PS4 G7 and included ACT/Phase 13a physical gates are external and **not run**. No claim of installation, deployment, enabled capabilities, GTA playability, merge, or release readiness. Phase 10a gaze still lacks the required evidence that stock Essential playback gaze is insufficient and remains deferred; all other master-plan phases remain outside v1.0 scope.

## Checkpoint 77: native C-06 truthful state split, bounded playback, PS4 T09, and complete cross-platform CI

This continuation is **strictly within the user-selected playable LSA v1.0 boundary** (Phase 6, baseline PS4 automated acceptance, Phase 13a; Phase 10a only on evidence). No other master-plan phases were implemented. PR #23 remains **draft/unmerged**; there was no deployment, installation, enabling, or real GTA test.

### Implemented and reviewed

- The native `DirectorAdmission` contract now separates a two-second pre-admission ticket deadline from a bounded 120-second **actual bound playback** lease. Unrelated arriving frames cannot retire an active matching native speech tuple merely because its original source-time admission TTL elapsed; the lease still expires and rejects late terminal acknowledgments. Invalid identity/old tuple/interrupt/full-audio outcome checks remain intact.
- Added pure `native/intelligence/DirectorC06Policy.cs` with fail-closed requirements for current speaker/player anchors, exact host/world and owner incarnation/proof revision, player-turn version, physical owner mode, trusted mic/Essential/playback busy state, reflex/script state and PS3 original observation/entitlement. The test matrix checks every required unknown/false input, wrong owner/host/turn and player takeover. The real native `IntelligenceIntegration.ReadDirectorC06` only supplies existing independently verifiable PS/P2/current-local-player anchor facts. **Original proof revision, authoritative player text/mic turn version, Essential scheduler/playback idleness and PS3 grant truth remain unknown/false**; they are not borrowed from a model or companion declaration.
- Native C-06 safety is stage-specific. **reserve/submit** require actual idle; **bind/complete** recheck original owner/player/currentness without requiring the NPC's already-running Essential turn to be idle. The production adapter remains an inert shadow preview with `DirectorAdmission(enabled:false)`, so no PS6 request can start an Essential turn. Native regression explicitly simulates real tuple binding under busy speech, completed audio after candidate TTL, capped terminal expiry and takeover after admission.
- PS4 audit entries **T05** and **T18** were individually reviewed against executed original frozen-capture/projection and qualified-claim tests. Added a new direct observer-index runtime regression for **T09**, testing a real admitted observer index lost on sequence gap and rejecting old-stream frames after new hello; it passed and was individually marked verified. The inventory is now **19/81 requirements** with `automated_oracle_verified`; other requirements are still separately open/partial/deferred. There is no aggregate-completes-audit claim.

### Exact current source-level automated validation

[GitHub Actions run 37991307936](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/37991307936), commit `74cdc448f27f414fab372ccef0f8996a04444c28`, finished **success** on both OSes:

| Executed test | Result |
|---|---|
| Ubuntu isolated normal-Node offline suite | **699 passed / 70 files / 0 failed** |
| Windows isolated normal-Node offline suite | **699 passed / 70 files / 0 failed** |
| Focused PS6 / Phase 13a modules on each OS | **33/33 passed** |
| Windows native ACT contract and shadow suite | **263 assertions passed** |
| Windows native PS/ACT production source shared intelligence | **115 assertions passed** |
| Windows native Director admission and C06 + pipe test suite | **111 assertions passed** |
| Windows real intelligence host-integration stubs | **89 assertions passed** |

CI compiled the standalone native source contracts and production-source integration stubs, **not** a matching final RPH/GTA addon payload. This was the final code SHA for the present increment; subsequent audit/status text changes do not modify the executed source.

### Remaining at the user-agreed implementation stopping boundary

**Phase 13a cannot yet be described as functionally implemented or playable.** The independently sourced player-turn version, C-06 Essential busy/reflex/physical owner state and native PS3 entitlement receipt still need real Core-owned producers. The authoritative **reserve/submit admission, actual source-pinned Essential `kb` zero-delay scheduler connection, original native turn/generation/session tuple callbacks, playback mapping, immediate player takeover and cancel/backoff** still require implementation/verification. The current native PS endpoint deliberately replies from a rejecting preview, and companion orchestration still relies on injected test doubles. Source evidence does not justify enabling a Director turn.

Phase 6 C-05/C-06 world reset and late owner callbacks and remaining individual baseline PS4 T/G automated audit gates also require closure; 263 ACT assertions are substantial but not a substitute for unperformed required oracles. Windows pinned complete addon build and payload hashes remain unproven. **GTA PS4 G7 and Phase 13a A33/A34/A39/A40 acceptance are external and not executed.** Stock Essential gaze insufficiency has not been demonstrated, so Phase 10a and every other master phase remain deferred. Do not merge, deploy or activate features.

## Checkpoint 78: additional individual baseline PS4 frozen-turn review

Follow-up evidence review against the already executed **699 tests / 70 files on both OSes** in CI run [37991307936](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/37991307936), source `74cdc448` (no production source changes in this checkpoint):

- **T32 automated_oracle_verified**: real stock text, microphone and special-event integration tests separately assert the P0 actor, listener, world, alias/capture and revision snapshot survives later realtime refresh, and omitted listener vs explicit null has distinct behavior.
- **T28 partial_verified**: original captured promoted canon/acting direction survives mid-flight edits, but next-generation selected memory/relationship edit and recapture is not separately established.
- **T30 partial_verified**: ordinary unowned observer and session/basic canon fallback are proven; real unavailable profile-store failure with valid perception still requires an exact oracle.
- **T31 partial_verified**: observation and decision pairs are frozen against later signals; next-generation recapture of changed event/profile needs its own assertion.

The authoritative [PS4 JSON acceptance inventory](ps4-v1-acceptance-audit.json) and [human-readable inventory](ps4-v1-acceptance-audit.md) now contain **20 automated-verified requirements out of 81**, with **4 partial**. Neither this documentation nor the full 699-test count proves the other 61 individual automated oracles or the external GTA tests. The Phase 6 and Phase 13a implementation and GTA blockers from checkpoint 77 remain exactly open, and no feature gate was enabled.

## Checkpoint 79: fully green P2 manual-memory freeze regression and still-open mic acceptance

Source commit `681dac064cb6b421e3dd1cbd39d09b9c0b3c2b44` was verified by [GitHub Actions run 37991971353](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/37991971353), **conclusion success on both platforms**. Each Linux/Windows isolated normal-Node suite passed **700 tests across 70 files, with no failed files**, and each platform passed **33/33 focused Phase 13a tests**. Windows also passed **263 ACT**, **115 native intelligence**, **111 native Director/C06** and **89 native host-integration** assertions.

Added `PR21 T28 selected manual memory, personality and relationship remain P0-frozen across an edit; next capture sees revisions` to the existing `tests/frozen-character-inputs.test.mjs` matrix. It creates and edits a player-authored selected P2 v1 manual memory along with personality and relationship, verifies the old actual CharacterService turn projection still uses the original frozen values, and verifies a *new frozen capture and projection* sees the updated revisions and facts. This uses P2's existing manual store, **not** Phase 11 automatic memory or any new migration.

T28 deliberately stays `partial_verified` in the JSON acceptance inventory: its additional end-to-end delayed mic/STT → one old provider request and a subsequent new provider request carrying edited selected memory/relationship is not individually executed. Audit remains **20/81 individually automated-verified** with T28/T30/T31 and one additional requirement partial. Never infer remaining baseline PS4 acceptance or GTA gates from passing total test counts.

The native Phase 13a endpoint remains `DirectorAdmission(enabled:false)` in **rejecting shadow preview**. No source-proven real Essential C-06/player priority version, native PS3 entitled grant admission, actual stock scheduler/tuple/playback callback wiring, or GTA run is yet delivered. Full Phase 6, PS4 and Phase 13a milestone implementation therefore remains incomplete; Phase 10a remains conditional and deferred. No merge, installation, deployment or enabled feature.

## Checkpoint 80: pinned Essential mic proof, source reset fanout and 702/70 clean two-OS validation

The user-selected playable v1.0 scope remains **Phase 6 C-05/C-06, baseline PS4 automated acceptance, and Phase 13a**, with conditional Phase 10a only on a demonstrated existing playback gaze defect. **No other master-plan feature was enabled, merged, deployed or installed.**

### Source changes

- `native/intelligence/IntelligenceIntegration.cs` now constructs the existing `EssentialMicState` **only after** the Core assembly hash pin passes and reads its actual current `Available`/`CanStart` gate on the existing native owner fiber. `MicStateKnown`/ `MicIdle` distinguish source-proven idle, busy and unsupported. A throwing, missing or unsupported reflection source remains an **unknown C-06 veto**; no player-turn version or Essential scheduler idle is inferred from an empty mic. Native host integration tests use a strictly scoped test substitute for idle/busy/unknown and verify none alone authorizes Director speech.
- Added PS4 **T19** full source `EpisodeCorrelator` regression: successful action callback, playback started/ended with `hadAudio`, and valid report-only native claims never generate spoken text, a player utterance, overheard speech or action completion.
- Expanded the Windows pipeline to compile and execute **actual P2 owner lifecycle/ACT UX reset source** and the existing **shared HostContext/EntityAnchors contract** (net481). Strengthened source HostContext tests for uint wrap, one backward regression, ordered subscriber fanout, idempotent tick, explicit timeline change and failure-isolated callback propagation. Existing PS integration proves shared adapters do not create a second clock pump.

### Executed current-HEAD validation

[GitHub Actions run 38001446757](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38001446757), source SHA `251454c5a555856939d911a813207cc7967eb522`, **completed success on Linux and Windows**:

| Verified stage | Result |
|---|---|
| Linux full network-blocked isolated Node regression | **702 passed / 70 files / 0 failed** |
| Windows full network-blocked isolated Node regression | **702 passed / 70 files / 0 failed** |
| Focused Phase 13a suites on each platform | **33/33 passed** |
| Windows ACT native contract suite | **263 assertions passed** |
| Windows PS/ACT shared native identity suite | **115 assertions passed** |
| Windows C-11/PS6/C-06 native admission suite | **111 assertions passed** |
| Windows real P2 native owner lifecycle/reset suite | **157 assertions passed** |
| Windows shared HostContext/anchor contract suite | **62 assertions passed** |
| Windows production-source PS host integration stubs | **92 assertions passed** |

Baseline PS4 per-requirement audit now contains **22/81** `automated_oracle_verified`, **4 partial** and **3 explicitly deferred-radio**; 52 mapped items still need direct acceptance review. T19 closed by executed source-level claim checks. T10 stays **partial**: all standalone source contracts pass, but combined RPH/Core-host-owned P2→PS→ACT/UX reset ordering is not demonstrated in the real GTA-loaded host. No aggregate test-count shortcut closes the remaining items.

### Still not the playable milestone

Phase 13a's production Director endpoint remains an explicit `DirectorAdmission(enabled:false)` rejecting **shadow preview**. A current native read of microphone idleness is not the same as a proven player-turn version or real Essential turn acceptance. The **trusted original PS3 grant**, independently current player/text/mic arbitration, authoritative C-06 owner/Essential/reflex state, real source-pinned zero-delay Essential `kb` scheduling and exact native turn/generation/session completion/playback receipt correlation still require implementation and end-to-end validation. Native C-05/C-06 phase completion, remaining PS4 T/G automation, and Windows final pinned production RPH addon binary/payload hash checks remain open. **GTA physical acceptance A33/A34/A39/A40 and PS4 G7 were not executed**. The successful C# test executables are not an actual GTA runtime test. No merge, deployment, installation or enablement was performed.


## Checkpoint 81: source-scoped native C-06 vetoes, original PS3 identity and callback-proof regression (October 9, 2026)

**Verified source commit:** `63adfbc84bb0d785bdf21e3b10b0a1f7ddc1f0bc` on draft PR #23. **GitHub Actions [38005298078](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38005298078) completed SUCCESS on Linux and Windows.** Any later documentation-only commit does not change these tested native/Node source files.

### Implemented within this C-06-only work block

- `DirectorC06Policy.Snapshot` now binds its decision to the **original PS3 observation ID, exact revision and decision key**, in addition to host run, world epoch, speaker/player capture refs, owner incarnation and proof revision, policy and player-turn version. Empty/matching-null original identifiers cannot authorize speech. Policy fixtures explicitly test swapping each field and losing the original grant.
- `EssentialMicState` now distinguishes a failed/unsupported private-field reflection read from an actually empty Essential microphone. Its `CanStart`, `Owns` and `StopOwned` paths do not accidentally convert an exception into idle; the production reflection code is tested with a failing FieldInfo.
- The existing P2 native owner roster publishes a read-only `DirectorOwnerSample` from the **exact currently registered encounter** with its primary-owner mode and suspended state. Core owner-fiber C-06 samples that P2 state; it independently samples Core `NpcStateStore` reflex/directed-interaction and the existing GTA scripted-state natives. Foreign ACT/P2 owners, suspended encounters, reflex/directed interaction, scripted mission/cutscene/online state and unknown reads **veto** admission. No second authority store, fiber or scheduler was added.
- Native admission requires a distinct, once-only `NotePlaybackStarted` receipt with the original full tuple before a successful terminal `Complete` can qualify. Wrong, duplicate, missing, interrupted, stale and failed callbacks cannot fabricate successful delivery. A failed current-owner recheck on tuple binding or playback start retires the pending reservation immediately. Bound-turn stages use the live-original-owner check instead of incorrectly demanding global idleness during legitimate playback.
- Existing single-ticket reserve/submit/cancel, 2-second ticket TTL, bounded playback lease, one-use replay protection and failure-counting rate limits were preserved. Director requests remain preview-only and **disabled in the actual native integration**; no scheduling, native TASK, model or playback action was added.

### Executed matching-head CI

| Verification at `63adfbc8` | Actual result |
| --- | --- |
| Full isolated Node regression, Linux | **702 passed / 70 files / zero failed files** |
| Full isolated Node regression, Windows | **702 passed / 70 files / zero failed files** |
| Focused Phase 13a suites, each OS | **33 passed** |
| Windows ACT native test executable | **263 assertions passed** |
| Windows shared native intelligence test executable | **115 assertions passed** |
| Windows C-11/Director/C-06 native test executable | **147 assertions passed** |
| Windows real-source P2 lifecycle, owner and clock recovery executable | **179 assertions passed** |
| Windows shared HostContext/anchor executable | **62 assertions passed** |
| Windows production-source PS owner-fiber integration executable | **100 assertions passed** |

All six Windows native test-project build steps succeeded (Debug/net481). The newly added direct P2 owner/actual private-mic reader checks and native C-06 player takeover, PS3 identity/revision swaps, world reset, expiry, callback loss and exact playback matching run in those suites. Two transient failures on **superseded** runs were fixed (wrong C-06 stage in a test harness, wrong single-argument P2 test helper); the final source run above is entirely green. No test acceptance was weakened to mask failures.

### Genuine remaining production admission blocker

**C-06 is NOT end-to-end authorized or playable.** The native current-source readings above prove some separate negative gates, **not** a real, positive, independently authorized C-06 proof. The pinned Essential/Core native surface currently inspected still lacks a source-verified complete *player-turn version and priority/busy arbiter*, *Essential active-turn/playback admission*, and *monotonic owner-proof revision*. The original PS3 observation and response-entitlement ledger is companion-side; matching request-provided IDs is necessary but **not** an independently verified original entitlement receipt. The live native owner-fiber must receive/source-verify the original current PS3 grant before it can assert `ObservationReceiptCurrent` or `ResponseGrantCurrent`. Likewise actual zero-delay `kb` scheduling, real Essential turn/generation/session tuple and original-ticket-correlated native playback callbacks remain unwired and **out of scope for this work block**. Existing tests exercise successful admission only through **injected, explicitly controlled authorization fixtures**; they must not be construed as game-authoritative permission.

Therefore `DirectorAdmission(enabled:false)` still rejects live speech in the production integration; no field marked unknown was flipped true from a pointer, default-zero state, inferred clock, request body or model statement. This is a documented **source-authority blocker**, not a Windows .NET test-build failure. Preserve the off gates until the missing authoritative Essential/PS3 interfaces exist and are tested.

**External gates not performed:** pinned RPH/GTA production Release addon compilation and payload hash verification, physical GTA runtime PS4 G7, Phase 6 native physical C-06 acceptance and Phase 13a A33/A34/A39/A40. Offline Windows stub builds are not a substitute for those. No merge, deployment, installation, feature enablement, spontaneous scheduler, additional master-plan phase or Phase 10a expansion. Baseline PS4 individual-oracle audit remains at its earlier 22/81 verified checkpoint; this focused block does not close unreviewed PS4 items.


## Checkpoint 82: actual uploaded Essential DLL source-interface audit and fail-closed C-06 sampling (October 9, 2026)

**Pinned binary confirmed:** uploaded `LosSantosAlive(3).dll`, 2,407,424 bytes, SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`, exactly matches `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll` and the existing native Core runtime pin. This is a metadata/IL investigation of the actual Core assembly, **not** proof of in-game runtime readiness.

### Direct binary findings and safe implementation

- The publicly accessible `LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.ReadPlayerTurnVersion()` (metadata token `0x060015ba`) returns **Int64**, and `NotifyPlayerTurnStarted` exists (`0x060015b9`). That counter is **special-turn-scoped evidence**, not a verified global player text/microphone/essential-turn arbitration protocol. Native C-06 records it as separate `SpecialTurnVersionKnown`/`SpecialTurnVersion` diagnostics; it **does not** set `PlayerTurnSourceCurrent`, `PlayerTurnIdle`, or the native request's unrelated 32-bit player-turn version. Failure/invalid value never becomes a source-positive grant.
- `LosSantosAlive.Audio.NpcPlaybackCoordinator.IsAnyAudioPlayingOrPending()` (token `0x06001402`) is a public static Boolean method backed by Core playback state. The pinned owner-fiber integration now samples it at C-06 preflight and independently treats **playing or queued/pending audio** as not idle. Exceptions reset the sample to unknown/fail-closed rather than infer no audio.
- Actual Core `NpcPlaybackStartedEvent` and `NpcPlaybackEndedEvent` contain **TurnId: String** and **GenerationId: Int64**. The end event also exposes `PlaybackStarted: Boolean`, `HadAudio` and `WasInterrupted`. The existing native ticket contract formerly used 32-bit generation IDs; it now preserves **Int64** through binding, start and completion, and rejects IDs outside JavaScript's exact integer limit (`9007199254740991`). Tests verify large but exact IDs, rejection of unsafe IDs, and wrong/truncated callback generations.
- New `tools/essential-abi` metadata-only .NET 8 verifier runs on Windows CI against **the real pinned Core DLL**, checking SHA-256, public static method returns and native event field types. No Essential code or GTA executable is loaded. This closes a prior gap where only simulation stubs established method availability.

### Executed matching-code CI

Code HEAD `39bdc681bb5d39c6c3dd17012a934a3f66799a5b` — **[GitHub Actions run 38006819821](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38006819821) completed SUCCESS** on Linux and Windows:

| Verified stage | Result |
| --- | --- |
| Linux full isolated Node regression | **702/702 tests, 70 files, 0 failed files** |
| Windows full isolated Node regression | **702/702 tests, 70 files, 0 failed files** |
| Phase 13a focused Node tests | **33/33 each OS** |
| Windows real pinned Essential metadata ABI verifier | **PASS** |
| Windows ACT C-05 suite | **263 assertions passed** |
| Windows shared native PS/ACT intelligence | **115 assertions passed** |
| Windows Director/C-06/PS6 admission | **160 assertions passed** |
| Windows actual P2 owner lifecycle/clock reset | **179 assertions passed** |
| Windows HostContext/anchor contract | **62 assertions passed** |
| Windows native PS host integration | **107 assertions passed** |

There was a superseded Windows run where the old generic reflection test incorrectly assumed that **every** new Boolean field must be an admission gate, including the explicitly diagnostic-only special-turn counter. The test was corrected to prove that this diagnostic neither grants nor revokes permission, while **all real C-06 gate-failure tests were retained**. The matching-head run above is fully green. No behavior was enabled to obtain passing tests.

### Still blocked for real Director speech

The binary supplies valuable source-authenticated negative/diagnostic facts but **not** a complete authority model. Global player text/mic/special-turn priority arbitration, authoritative **Essential pre-playback active-turn/hydration** state, a monotonically revised native P2 ownership proof, and the independently matched *original PS3 observation/response-entitlement receipt* remain unsupported. PS3 observation and salience response entitlement live in the companion-side store; reusing companion-provided request fields is not independent native proof. The native original-ticket / actual scheduled Essential turn / playback callback / session nonce bridge also does not exist, and no zero-delay `kb` scheduling was implemented under this narrower C-06 work boundary.

**Therefore** production still constructs `DirectorAdmission(...,enabled:false)`, and all outstanding positive gates remain fail-closed. The successful native reserve/submit/cancel and callback tests use controlled injection, not a playable speech authorization. GTA/RPH Release addon/payload hashes, PS4 G7 and Phase 13a A33/A34/A39/A40 physical tests were **not executed**. Baseline PS4 audit remains at **22/81 verified individual oracles**, with no unverified oracles closed here. No merge, deploy, installation, enabled feature, scheduler or deferred master-plan phase.


## Checkpoint 83: Core callback owner-fiber bridge, dormant stock request and immediate P2 revocation (October 9–10, 2026)

**Matching tested code HEAD:** `b46a9987900c29644640381dfc9723b794bcd5a1`. [GitHub Actions run 38009580806](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38009580806) completed **SUCCESS on Windows and Linux**. This is a Phase 13a-only implementation increment; it does **not** close the playable-v1.0 scope.

### Native source integration (still off)

1. **Original-ticket Core playback events:** `DirectorAdmission.ObserveCorePlaybackStarted` / `ObserveCorePlaybackEnded` accept only a *previously reserved, submitted and natively bound* active ticket with the exact original speaker capture, PedId, TurnId and Int64 GenerationId. No event can create a ticket, rebind one or borrow another actor's identity; the existing verified preflight, single-playback and terminal gates remain required. Failed/duplicate/wrong-source/late/cancelled callbacks are rejected. The events themselves carry **no SessionNonce**; the native original binding retains it, and a separate original full-tuple production binding source is **still missing**. Therefore passing isolated callback tests does not establish real session-nonce provenance.
2. **Callback-thread containment:** `IntelligenceIntegration` now copies Core `NpcPlaybackStartedEvent` and `NpcPlaybackEndedEvent` into a bounded **32-entry** queue only in Director shadow mode. The existing native `Update` owner fiber drains it, checks the live exact Core Ped handle/object and nonretired PS anchor, then consults the preexisting Director admission. Invalid/recycled actors and callback tuple mismatches cannot advance native tickets. Overflow discards the entire batch and resets the native Director, never silently treating lost callbacks as delivered. Native world resets/shutdown clear the queue. Existing PS playback factual signals are preserved.
3. **Exact P2 owner retirement:** the P2 source `OwnerRetired(incarnation)` callback now revokes only the ticket bound to that original incarnation and clears any queued Director callback records. Other actors' ownership retirement cannot cancel the original ticket. Late playback cannot restore it, while original replay/attempt accounting survives.
4. **Stock Essential `kb` request preparation:** `DirectorStockTurnRequest.Prepare` now builds the *real pinned Core* `SpecialGeminiTurnRequest` type with exact speaker/listener/target Ped instances, original `ps:<ticket UUID>` dedupe, `ps6_observer` reason, zero delay, no face/interrupt, cancel-on-player-turn, and skip-busy gates. It requires an existing **fully valid 'submit' ticket shape**, an independently all-positive C-06/PS3 snapshot, live distinct Peds and a short control-character-free context string. This is **pure DTO construction only**: it does not call `Submit`, `SendNow`, create a fiber, dispatch to the companion, or begin playback. No native source currently satisfies all required positive admission gates.
5. The real pinned Core ABI verifier now additionally checks `SpecialGeminiTurnRequest` speaker/listener/speech-target, content/reason/dedupe, five safety flags and delay, plus `SpecialGeminiTurnScheduler.Submit`, `SubmitAfterCurrentTurn` and `SpecialGeminiTurnService.SendNow` signatures. These are **source-verified available methods, not executed live schedulers**.

### Matching-head automated receipts

| Suite at `b46a9987` | Result |
| --- | --- |
| Linux isolated Node | **702 passed / 70 files / zero failures** |
| Windows isolated Node | **702 passed / 70 files / zero failures** |
| Phase 13a focused Node tests | **33/33 passed per OS** |
| Windows actual pinned Essential metadata-ABI verifier | **PASS** |
| Windows ACT contract | **263 assertions passed** |
| Windows shared native PS/ACT | **115 assertions passed** |
| Windows native Director/C-06 | **187 assertions passed** |
| Windows source P2 owner lifecycle | **179 assertions passed** |
| Windows HostContext/anchor | **62 assertions passed** |
| Windows PS host integration source/stubs | **122 assertions passed** |

Intermediate CI found a test-only bad newline fixture (literal escaped characters instead of an LF). The input was corrected; the policy still rejects actual control characters and the matching code run above is completely green. All native test assemblies were built Debug/net481 using offline RAGE/Essential test doubles for the game-specific types. Only the separate metadata verifier checks the real Core DLL without running it; **no production RPH/GTA Release addon binary or physical GTA scenario was validated**.

### Scope and remaining blockers

`DirectorAdmission(...,enabled:false)` **still prevents live Director speech**. The bridge cannot bind a real Essential tuple because no source-verified native/companion intake yet obtains the original full turn/generation/**sessionNonce** after a real stock `kb` request. Neither the compiled Core special-turn revision nor queued-audio idle sample establishes the complete global player text/microphone arbitration or active Essential hydration/turn state. P2 does not yet publish a source-authoritative monotonic owner proof revision into the native-to-companion stamp. The original PS3 observation and salience grant are still companion-owned: matching IDs or an injected test-all-positive `Snapshot` cannot authorize a live native ticket, and no separately original native PS3 grant receipt exists. Stock `Submit` is **not called**. Consequently player priority, full source authorization, live cancellation and Phase 13a spontaneous speech scheduling remain incomplete.

Baseline PS4 audit stays at **22/81** individually verified oracles; the unreviewed cases are not closed by aggregate test counts. Native Phase 6 / PS4 full acceptance, pinned production Release addon and payload hashes, GTA PS4 G7 and Phase 13a A33/A34/A39/A40 remain outstanding. No merge, installation, deployment, feature enablement, Phase 10a, or other deferred phase.


## Checkpoint 84: genuine P2 native owner-proof revision propagated to PS6 companion (October 10, 2026)

**Verified production/test code head:** `39b43b574f2ccab8eeca5514cbdfd7d8c4ad2b19`. [GitHub Actions run 38010438187](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38010438187) completed **SUCCESS on Linux and Windows**. This increment narrows an earlier source-authority blocker without enabling speech.

### Native original owner authority

- The **existing actual P2 `Encounter`** now owns a monotonic `DirectorProofRevision` starting positive. Its immutable `PrimaryBehaviorOwner` setter increments only when the original owner token actually changes; `Suspended` setter increments on transitions. This catches rapid A→B→A mode/ownership changes even when the later idle mode looks the same and the game tick has not advanced. Idempotent mode/suspension updates do not increment. Integer exhaustion permanently switches the revision to zero/unknown—no wrap or nonce recycling.
- The original P2 `PerceptionRoster` returns the source revision only for its **exact still-registered encounter**. `ReadDirectorC06` reads that revision as `OwnerProofRevision`, so a candidate with an older requested proof revision fails the existing exact owner comparison. It never derives revision from a Ped handle, clock, model, request field, or legacy `primaryOwner.since`.
- The native PS `observer_situation` sample now also carries optional `ownerProofRevision` from its independently current original P2 association, alongside the existing `primaryOwner`. Missing/unreadable, unowned, retired or overflowed producer state remains **null** and does not become positive authority.

### Source-scoped companion receipt

- The existing strictly authenticated perception stream accepts the optional v1 `ownerProofRevision` only when it is a positive exact 32-bit integer and the original valid `primaryOwner` exists. The receiver additionally requires a live **owned native `observer_index` with an original incarnation ID** for any positive revision. Valid-but-contradictory ownership and a rollback from revision N to an earlier revision during the same lifetime retire the stream; malformed frames are simply rejected without accepting proof, preserving original parser semantics.
- New `ShadowRuntime.directorOwnerProofFor(captureRef)` exposes a frozen, source-produced owner proof tuple (`hostRunId,worldEpoch,speakerCaptureRef,ownerIncarnationId,proofRevision`) only while the native observer, matching registered ownership, and owner situation sample remain current. Expiry, retirement, world reset, missing proof, and unowned/legacy input yield null. This is **native-source observation evidence**, not permission to speak, a PS3 response entitlement, a full global player turn/version, nor an Essential scheduling claim. The active Director orchestrator is **not** enabled or granted authority by this method.

### Matching-HEAD executed tests

| Suite | Result |
| --- | --- |
| Linux full isolated Node | **704 passed / 70 files / no failing files** |
| Windows full isolated Node | **704 passed / 70 files / no failing files** |
| Focused Phase 13a Node tests | **33/33 each OS** |
| Windows real pinned Essential Core metadata ABI | **PASS** |
| Windows ACT native contracts | **263 assertions passed** |
| Windows shared PS intelligence native | **115 assertions passed** |
| Windows Director/C06 native | **187 assertions passed** |
| Windows actual P2 owner lifecycle | **194 assertions passed** |
| Windows HostContext/anchors | **62 assertions passed** |
| Windows production-source PS host integration test doubles | **128 assertions passed** |

The first intermediate Linux test run rejected malformed owner revisions correctly but its new test mistakenly expected a **stream disconnect** instead of the existing parser's malformed-frame drop behavior. The test was corrected to verify the actual no-permission/no-sample invariant. No permission check, validator, or regression assertion was weakened. The matching-source full run above is green.

### Still not functional Phase 13a

The source-owned P2 revision is **now available**, replacing the previous unknown native owner-revision evidence gap. However, the complete **player text/microphone/Essential turn-priority arbiter**, independently original **PS3 observation and response-entitlement** admission record, production **real stock `kb` Submit** with original ticket, original **Core-produced full session nonce / generation / turn binding**, and accepted in-game callback path are **still not established**. Companion source proof is a separate optional fact; a full C06 stamp is not synthesized. The native constructor still supplies `enabled:false` and its shadow preview rejects speech; other independent unknown C06/PS3 gates still refuse. No production RPH Release build, verified payload hashes, GTA PS4 G7, or Phase 13a A33/A34/A39/A40 acceptance executed.

PS4 audit remains **22/81** individually verified cases; Phase 6 overall, remaining PS4, Phase 13a and all physical gates are **not complete**. No merge, installation, deployment, feature enablement, scheduler call, Phase 10a or deferred phase.


## Checkpoint 85: exact original companion PS3 grant verification and mandatory Director prepublication gate (October 10, 2026)

**Matched source code head:** `ed3575ca8095ad68b6e465b4929d976a738604ac`; [GitHub Actions 38014164566](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38014164566) **completed SUCCESS Windows and Linux**. This is an incremental fail-closed Phase 13a implementation and does **not** establish native authorization or enabled spontaneous speech.

### Original companion PS3 entitlement — not reconstructed permission

- `ShadowRuntime.directorOriginalEntitlementFor(proposal,stamp)` now independently rereads the existing **PS2 observation store** and original **PS3 salience ledger/pair**, rather than accepting the proposed `decisionKey`, an inferred owner, or a synthetic all-positive `entitlementCurrent` as proof.
- It requires exact original observation ID/revision/native run/episode, PS3 decision ID/revision/key/policy/response, **unconsumed original ledger grant**, source supported non-report claims, original observed-at monotonic timestamp and original urgency-limited expiry. It cross-checks the separately authenticated live P2 native incarnation/revision stamp, host run, world epoch, exact speaker/player, and original evaluated situation revision. Unknown, expired, mismatched, revoked or stale information yields `null`.
- `sceneDirector.mjs` remains the separate *unprivileged selector*. PS0/PS1 `shadowRuntime.mjs` does **not import the Director module**. The entitlement verifier recomputes its source-time limits independently so policy drift fails closed rather than letting the selector authorize itself.
- The returned frozen `source:'original_companion_ps2_ps3'` tuple is **only proof that the companion currently holds that source grant**. This is NOT a native-original PS3 receipt, NOT a global player-turn proof, NOT a playback permission, and NOT an Essential scheduling capability. Reading it does not consume a grant, submit a native ticket or affect world state.

### Required prepublication proof at the Director orchestrator

- `SceneDirectorSpeech` now accepts an `originalEntitlement` reader and **rejects active attempts without it**. A proposed exact source record must match the original host/world/speaker/player/incarnation/source revision, PS3 ID/revision/key/policy and source expiry, separately from the injected native C-06 gate.
- The original companion source is re-read **before native reserve**, **after native reserve**, **before native submit**, **after native submit**, and at both **hydration and publication** gates. Losing it during an asynchronous await cancels the original ticket and prevents subsequent `kb` dispatch. It is **not** required after already begun TTS playback merely because the observation TTL elapsed; native original playback callback/ownership gates are distinct.
- No production active `SceneDirectorSpeech` is instantiated. The *disabled* native `DirectorAdmission(enabled:false)` remains unchanged. Test injected fake source records validate the orchestrator contract, while tests against actual `ShadowRuntime` validate the original PS2/PS3 source-store read.

### Matching-code automated results

| Suite | Result |
| --- | --- |
| Linux isolated Node full | **709 passed / 70 files / zero failed** |
| Windows isolated Node full | **709 passed / 70 files / zero failed** |
| Focused Phase 13a Node | **36/36 each OS** |
| Windows pinned Essential DLL ABI | **PASS** |
| Windows ACT | **263 assertions** |
| Windows shared PS/ACT | **115 assertions** |
| Windows Director native C-06 | **187 assertions** |
| Windows P2 lifecycle | **194 assertions** |
| Windows HostContext | **62 assertions** |
| Windows production-source integration stubs | **128 assertions** |

One superseded run failed a deliberately strict PS0/PS1 source-module boundary because the first entitlement implementation imported the PS6 selector into `shadowRuntime`. The implementation was corrected to use **independent local source-time/TTL matching, retaining the dependency boundary**; the successful run above includes that regression plus complete cross-platform tests. No gating requirement was loosened.

### Still requiring trustworthy native integration

The **companion original PS3 grant** can now be checked truthfully and the orchestrator requires it, but native code still has **no independently verified original PS3 observation/grant receipt**; copying fields from the companion request into a native snapshot must never turn `ObservationReceiptCurrent` or `ResponseGrantCurrent` true. Pinned Core's special-turn revision and playback APIs are not a complete authoritative global player text/mic/Essential-turn priority arbiter. No production stock `kb` `Submit` has been called, no original Core session nonce + generated TurnId/Int64 generation tuple binding has been authoritatively established, and in-game native start/terminal matching is not validated. Thus **production spontaneous speech remains disabled, preview-only and unplayable**. Phase 6 and full PS4/13a acceptance remain open; baseline individually verified PS4 oracles remain **22/81**. GTA RPH Release addon, payload-hash verification, PS4 G7 and A33/A34/A39/A40 physical gates not run. No merge, deployment, installation, gate enablement, Phase 10a or deferred features.


## Checkpoint 86: source-pinned Core player-priority vetoes, special-turn revision race fence, companion original grant transport (October 10, 2026)

**Matching tested code HEAD:** `68f7f10c97410d36236080185d69c0e13c4692bf`. **[GitHub Actions 38041071340](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38041071340)** completed **SUCCESS** on Windows and Linux. All changes remain Phase 13a work with the existing production admission feature gate **OFF**.

### Authoritative negative native player-priority evidence

- Core's actual pinned public `LosSantosAlive.NPC.NpcTargeting.GetPlayerConversationPed()` and `GetCurrentSpeakerPed()` are now sampled on the native PS host owner fiber in `ReadDirectorC06`. The presence of **either** a current player conversation or current Essential speaker is an explicit negative veto for *new* Director speech. Unknown/throwing Core state remains fail-closed. The Windows **real DLL** SHA/metadata verifier now checks both no-argument public static `Rage.Ped` signatures.
- New `ConversationStateKnown` requires both source reads, and `ConversationIdle` is required **only for pre-admission** C-06 `Safe`. Post-binding/started/terminal `CurrentPlayback` retains `ConversationStateKnown` but does **not** require idle: a legitimate newly speaking NPC can naturally become the current speaker and its playback may be active. Tests explicitly preserve successful completion with busy Core speaker and reject unreadable state at both boundaries.
- These are conservative **negative observations**, not proof that global Essential player text, active microphone, or other priority logic is idle. No unsupported source field was marked true.

### Native original Core special-turn version anti-ABA fence

- `DirectorAdmission` now requires a source-injected **actual Int64 Core special-turn version reader** for every enabled reservation. Production uses the pinned `SpecialGeminiTurnService.ReadPlayerTurnVersion()` method; the isolated positive fixtures inject a deterministic version. No source / negative version / thrown source read cannot reserve, even with an otherwise all-positive mocked C-06.
- A new native ticket stores its independently sampled version and refuses an in-flight version change: it samples **before and after** the initial reserve safety check and also **before and after** submit, bind, actual Core playback-start and terminal proof checks. Changes release or invalidate the original ticket and never acknowledge a stale original PS3 grant. Tests include changes between stages, **during** a stage's proof callback, read failures and post-playback false-success prevention.
- This is not a substitute for the missing complete global player-turn arbiter. The publicly available Core special-turn counter is a narrower source whose update coverage cannot be taken as proven across all possible player input modes; a *change* is a veto, stability does not grant authorization.

### Companion original-PS3 transport gate

- `IntelligenceClient.directorOriginalEntitlement(proposal,stamp)` now delegates only to the genuine `ShadowRuntime.directorOriginalEntitlementFor` original PS2/PS3 source after validating that the negotiated Director v1 channel, current native epoch, and writable live shadow connection are present.
- `requestDirector` refuses both native **reserve** and **submit** when the original ledger entitlement is missing or has been revoked, even if someone bypasses the higher-level `SceneDirectorSpeech` orchestrator. Native **cancel** remains sendable when the source grant is gone, so cleanup does not deadlock or leave a submitted ticket behind. The lower-level `sendDirectorPreview` remains a raw preview wire helper, **not an authorization API**; native production admission remains disabled.
- New transport tests explicitly isolate response matching with a stubbed original grant, demonstrate missing-source denial, revoke the grant between reserve and submit, require native cancellation to remain available, and reject stale connection epochs. No `kb` operation was performed.

### Exactly executed matching-code CI

| Stage | Result |
| --- | --- |
| Linux full isolated Node | **710 tests passed, 70 files, zero failed** |
| Windows full isolated Node | **710 tests passed, 70 files, zero failed** |
| Focused Phase 13a Node | **37/37 each OS** |
| Windows pinned real Core metadata ABI | **PASS** |
| Windows ACT native | **263 assertions** |
| Windows shared PS/ACT native | **115 assertions** |
| Windows Director/C-06 native | **209 assertions** |
| Windows source P2 owner lifecycle | **194 assertions** |
| Windows HostContext/anchor | **62 assertions** |
| Windows PS host integration | **133 assertions** |

A superseded intermediate Windows run revealed an incorrect idle fixture: the integration baseline already had a live Core player-conversation target. The test was corrected to deliberately clear and restore that target around the true-idle read, preserving the busy-target veto. A later review also corrected the policy to enforce conversation idle **before** new playback, not while the original NPC is already speaking. These were tested on the matching final code HEAD above. Source-verified ABI checks load the pinned DLL *as metadata only*; native game tests use their established offline .NET/RAGE doubles, not a running GTA instance.

### Remaining Phase 13a and stop boundary

- **Original independently checked native PS3 grant receipt still unavailable:** companion original PS2/PS3 truth is now verified at the orchestrator and transport, but request-controlled fields cannot become a native source-owned original grant. `ObservationReceiptCurrent` and `ResponseGrantCurrent` remain **unknown** in production.
- **Global player/Essential priority remains unresolved:** special-turn revision and target/current-speaker busy-state are useful negative checks but do not cover every player text/microphone/active Essential turn. Complete independent `PlayerTurnSourceCurrent` / `EssentialTurnKnown` remain unknown.
- **Actual stock Essential `kb` `Submit` / original tuple / nonce correlation and production playback acceptance remain unimplemented.** `DirectorStockTurnRequest.Prepare` is still pure and no stock scheduler is called. `DirectorAdmission(enabled:false)` rejects live reservations.
- No production RPH Release build, installed GTA smoke acceptance or verified deployment hashes. PS4 remains 22/81 individually accepted; G7 / Phase 13a A33/A34/A39/A40 and Phase 6 full acceptance remain open. **PR draft/open/unmerged, no deploy, install, feature enable, Phase 10a, or deferred phases.**


## Checkpoint 87: original PS3 source-bound native receipt bridge (October 10, 2026)

**Matching implementation/test code HEAD:** `a3db1bd8d48be0ac8af0ebf52b392c08150c4c6a`; **[GitHub Actions run 38043181447](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38043181447) SUCCESS on Linux and Windows**. This is the bounded PS3-authorization slice on draft PR #23, with **no stock speech scheduler, native Director gate enablement, installation, or merge**.

### Producer receipt originated from the original PS2 + PS3 state, not a request echo

1. The native owner-fiber producer `IntelligenceIntegration.Sample` now issues a **native UUID challenge** only for an authentic current P2-owned observer with a positive original P2 `DirectorProofRevision`. The challenge is carried as optional `ps3Challenge` in the existing `observer_situation` v1 factual stream, bound to the original host/world/speaker/owner/revision/sampled situation. Changes, expiry, owner retirement, connection loss, and world reset invalidate challenges.
2. The native publisher independently remembers `RawSignal.signalId` **only after successful outbound native factual signal enqueue** and only for an original native witness or native source/target self-involvement. The ledger stores which observer was entitled to that native event. Signal ID was already in the original PS2 claim's immutable `details.eventSignalId`; the companion does **not** obtain this evidence from a request field.
3. `ShadowRuntime.directorOriginalEntitlementFor` (Checkpoint 85) continues to check the original stored PS2 observation, unconsumed PS3 salience decision/grant/pair, positive source claims, age/expiry and exact current native P2 proof. It now also extracts original **native claim signalId**, actual native `observer_situation.ps3Challenge` and situation revision, and age in milliseconds. Missing source facts remain null: they are never synthesized from a requested ticket or an LLM assertion.
4. Companion `IntelligenceClient.requestDirector` emits a **separate, strictly closed 18-field `director.ps3_receipt` version 1** over the *existing* user-ACL named pipe **before** a native `director.request reserve` and only after an original PS3 source check. The submit operation rechecks original producer truth but does not forge a second receipt. A cancel is always allowed even if the original PS3 grant has expired. No new pipe, other service, token signer, or Essential action was created.

### Native source proof and once-only admission

- The existing native pipe reader queues these two messages FIFO and the native **owner fiber** dispatches them through separate strict `DirectorPs3ReceiptCodec` and `DirectorFrameCodec` contracts. Receipt frames cannot decode as Director commands, and unknown, noninteger, extra, or malformed fields are refused.
- New bounded `DirectorPs3Receipts` stores at most **16 original observer challenges**, **256 native source-signal/observer matches**, **32 original PS3 grants**. It independently checks the challenge, original signal witness, native host/world, speaker and original P2 owner incarnation/revision, situation revision range, source PS3 decision/observation identity, policy version and bounded source age. Issued challenge and native source signal each redeem once, with challenge/signal/accepted-grant leases **3000/10000/at most 2000 ms** (accepted grant TTL is shortened by original evidence age).
- `DirectorAdmission` remains the separate, default-disabled source of one-use C-11 speech reservation. If it ever returns an authorized native reserve, the original PS3 ledger must claim the exact matching ticket once. Source grant cleanup occurs on exact cancel, P2 owner retirement, anchor retirement, disconnected native connection, host/world reset and shutdown.
- Most importantly, `ReadDirectorC06` now sets `ObservationReceiptCurrent`, `ResponseGrantCurrent`, `ObservationId`, `ObservationRevision` and `DecisionKey` **only** from a validated **native-stored independent receipt**, never by copying the inbound `director.request` fields. The stored receipt is sealed by scalar copy so mutating the decoded input or returned copy cannot alter authority. Forged request host/world/owner/player, ticket/observation ID, PS3 decision/revision, duplicate receipt, different original native witness, borrowed native challenge, future situation, expiry and revoked ownership all fail closed.
- **Trust-boundary qualification:** Native proves that the receipt was delivered on its existing same-user ACL pipe and corroborates native-origin observer/owner/source-signal/challenge evidence independently. Native does **not** reproduce the PS3 salience-policy calculation; the original companion PS3 ledger remains the authority for decision eligibility and its response grant. The source message is not a cryptographic attestation against malicious same-user code with pipe access.

### Matching-HEAD automated acceptance

| Test suite | Result |
| --- | --- |
| Linux isolated Node full | **711 tests / 70 files / 0 failed** |
| Windows isolated Node full | **711 tests / 70 files / 0 failed** |
| Focused Phase 13a Node | **38/38 on each OS** |
| Real pinned Essential DLL metadata ABI (Windows) | **PASS** |
| ACT native contracts (Windows) | **263 assertions PASS** |
| Shared PS/ACT intelligence (Windows) | **115 assertions PASS** |
| **Director + actual native PS3 receipt ledger (Windows)** | **237 assertions PASS** |
| Actual P2 lifecycle/clock (Windows) | **194 assertions PASS** |
| Shared host/anchor (Windows) | **62 assertions PASS** |
| **Native production-source PS host integration (Windows)** | **137 assertions PASS** |

Regression specifics: the new native ledger has source-identity, distinct original observation/decision/owner/world fields, replay and zero-proof rejection, original native source signal/vs unrelated observer, unissued challenge, future situation, immutable input copies, monotonic expiry, owner retirement and reset tests. Tests also use the **actual production `ReadDirectorC06` method** with independently seeded native P2/signal/PS3 receipt; it sees the original PS3 approval, while **still refusing speech** because the separate global player-turn and Essential authority flags remain unknown. Companion tests confirm original PS3 ledger-sourced signal and challenge and strict two-message native FIFO.

Intermediate checks caught and corrected a double-escaped JS receipt wire newline/control-character regex, and a native ledger predicate missing the **second comparison** of host/world fields to the original *ticket* (as opposed to checking only the live host/world). The final matching-code CI receipt above includes both fixes and passes. The owner-retirement test was also strengthened to prove the receipt was truly live *before* it was revoked.

### Milestone and remaining blockers

**This slice implements the PS3 producer-to-native receipt transport and proof ledger.** It resolves the missing native PS3 grant-source integration **at the offline contract/test level**; production GTA reception and behavior remain unverified. It does *not* mean native independently recalculates PS3's policy, authenticates against adversarial same-user processes, or permits live speech.

**Still incomplete:** full global player text/mic/Essential-turn arbitration, source-verified actual stock `SpecialGeminiTurnScheduler.Submit` and original session nonce/turn/generation binding, and production GTA acceptance. Native `DirectorAdmission(...,enabled:false)` is **still disabled**, no `kb` is invoked, and baseline PS4 remains **22/81** individually verified; Phase 6 full acceptance, G7, A33/A34/A39/A40, pinned RPH production Release build and verified deployment are outstanding. No merge, installation, deployment, enablement, Phase 10a or deferred phase.


## Checkpoint 88: Phase 13a Architectural Piece #2 — independently fenced player-priority revisions, Core text UI takeover, source-verified ownership gap (October 10, 2026)

**Matching tested implementation code HEAD:** `7671647b307a6d64886c927820a9095ea74586f3`. **[GitHub Actions 38045049639](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38045049639) SUCCESS**, Windows + Linux. **Result: bounded implementation and safety tests completed; Architectural Piece #2 is NOT complete.** No production source is falsely promoted into a global player-turn arbiter.

### New authoritative negative sources and revision-safe admission

- Native `ReadDirectorC06` samples the **real pinned Core** `TextInputService.IsOpen` and `LsaControlsMenu.BlocksLsaInput` on the original PS host owner fiber, in addition to the existing mic private-field, active conversation/speaker, queued/playing Core audio, and special-turn revision checks. The Windows ABI verifier independently checks the public static Boolean getter signatures. Open text input or controls menu vetoes new Director admission **and** previously authorized speech; a thrown Core read is unknown and fails closed. These are real input UI negative facts, *not* proof that queued/submitted text or pending hydration is idle.
- `DirectorAdmission` now pins a separate **Int64 global player-priority revision source** at reserve, alongside the existing source-backed special-turn revision, and checks both before/after every independently safe reserve, submit, bind, playback start and terminal C-06 callback. Source absent/negative/unreadable or any changed epoch rejects; cancellation and retirement remain available. The revision protects A→B→A changes that return to idle between callbacks, and does not invalidate valid NPC playback merely because *its own* Essential speaker/audio state becomes busy.
- **Critical nonclaim:** isolated tests inject a deterministic, monotonic all-input epoch to verify the API and race fencing. There is **no source-verified exhaustive production Core epoch** wired to `playerPrioritySource`: the production caller deliberately omits it. Neither `ReadPlayerTurnVersion()` nor an input UI getter is automatically such an epoch. Native `enabled:false`, and `ReadDirectorC06` still leaves `PlayerTurnSourceCurrent`, `PlayerTurnIdle`, `EssentialTurnKnown` and `EssentialTurnIdle` unproven.
- The existing verified pinned-DLL metadata-only tool was extended with a **diagnostic-only** inventory/IL call-target probe. It located `InputController.SendMicStart/Stop/SendTextPrompt`, `TextInputService.StartTextInputMode`, `ConversationHydrationCoordinator.BeginMicTurn/MarkMicReleased/Update`, and `SpecialGeminiTurnService.NotifyPlayerTurnStarted/ReadPlayerTurnVersion`. The exploratory direct-token IL scan detects a Core mic-stop→hydration release link and input-path call candidates, but it **does not** establish every state transition, a definitive terminal text/model ownership event, or that Essential's version covers normal mic/text. Opcode-token scanning can produce candidate matches and cannot be treated as an ownership proof.

### Matching-code CI acceptance

| Test suite | Executed result |
| --- | --- |
| Linux full isolated Node | **711 passed / 70 files / 0 failed** |
| Windows full isolated Node | **711 passed / 70 files / 0 failed** |
| Phase 13a focused Node | **38/38 on each OS** |
| Pinned actual Essential DLL SHA + metadata ABI (Windows) | **PASS** |
| ACT native Windows | **263 assertions PASS** |
| Shared PS/ACT intelligence Windows | **115 assertions PASS** |
| Director/PS3 native Windows, including new all-player epoch/ABA tests | **256 assertions PASS** |
| P2 owner native Windows | **194 assertions PASS** |
| Shared HostContext Windows | **62 assertions PASS** |
| Production-source PS host native Windows, including real C-06 text/menu reads | **142 assertions PASS** |

The new tests exercise player mic/text start→stop and busy→idle ABA **using explicit supplied epoch transitions**, source missing/throwing, text-editor/menu takeovers, within-check version races, before-binding/start/terminal player takeover, queued/playing audio, Core input getter failures, and already-authorized exact-tuple NPC playback completing successfully. They **do not** simulate or prove actual in-game stock Core text/mic/model completion propagation, and the DLL inventory is metadata-only. No Windows GTA/RPH runtime test was executed.

### Genuine remaining Piece #2 blocker

The pinned Core's source-verified public mic Ped field, text UI getter, conversation/current-speaker getters and global audio query do **not** jointly disclose the authoritative **player/Essential conversation owner and complete in-flight turn lifecycle**. Especially unresolved: stock mic start→release→hydration windows, asynchronous player text submission after the text UI closes, normal player-directed turns while generation is pending, Essential dialogue ownership during a pending-but-silent turn, and a monotonic **all-input** revision that records busy→idle→busy/ABA across these paths. `SpecialGeminiTurnService.ReadPlayerTurnVersion` exists but its complete global update coverage was not established by the pinned IL survey. A genuinely complete Piece #2 requires a source-verified producer spanning these state transitions and terminal outcomes, potentially narrow pinned Core/backend hooks, **before** setting the unknown C-06 authority fields true or wiring the production revision reader. Merely adding another idle boolean or using a monotonic counter from an unrelated path would be incorrect.

**Stopping boundary preserved:** Architectural Piece #2 **partial / blocked by missing verified exhaustive Essential ownership source**; **not ready** for Piece #3 stock scheduler integration. No original `SpecialGeminiTurnScheduler.Submit` or server `kb` call; no original session tuple allocation, no native enabled gate, no GTA deployment/install, no merge, no Phase 10a or other phases. PR #23 remains draft/open/unmerged; previous PS2/PS3/P2/ACT/UX/native Director contracts remain intact.


## Checkpoint 89: original Core input transition epoch + stock backend ownership projection (October 10, 2026)

**Verified implementation code HEAD:** `23bc8ae3b66110489cc77074e7a2f4c4d8ea916e`. **[GitHub Actions 38046762653](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38046762653) SUCCESS (Windows + Linux)**. This is the next bounded slice of **Phase 13a Architectural Piece #2**, **not full player/Essential turn arbitration**. Native Director remains `enabled:false`; absolutely no stock `SpecialGeminiTurnScheduler.Submit`, `kb` speech dispatch, live GTA effect or deferred phase.

### Source-backed Core player-transition observer — actual negative version, not synthetic positive idle

- The exact SHA-256-pinned Essential DLL was traced using a metadata-only **real instruction-decoding** IL audit, with normal call targets and field accesses instead of a raw byte scan. The results show **both** `InputController.SendMicStart` overloads and stock `InputController.Update` call the **same** original internal Core mic-entry method (metadata token `0x0600016f`). The original `SendMicStop` invokes `ConversationHydrationCoordinator.MarkMicReleased`; `TextInputService.StartTextInputMode` calls `SendTextPrompt`. These are original Core seams, not a new talk executor.
- `EssentialPlayerPriorityMonitor` now installs an **optional, read-only Harmony prefix** on that pinned shared mic entry, Core mic stop, text submit, text input start, mic hydration begin/release, player conversation targeting set/clear and `SpecialGeminiTurnService.NotifyPlayerTurnStarted`. Only Director **shadow** runtime attempts the observer; pinned DLL identity and method shape plus exact original entrypoints are mandatory. It reuses already-present Harmony, changes no arguments or return values, creates no input/turn ownership, and fails closed if any required patch cannot be installed. A failed partial installation is never reported as a valid source.
- `PlayerPriorityEpoch` is a separate real **Int64 monotonic observed-transition revision**: it increments on each observed original Core entry, including conservative extra invalidations from rejected/duplicate calls, preserves pre-install history and permanently disables source availability on wrap. It never asserts complete mic/model/Essential turn idleness. Native `DirectorAdmission` (from checkpoint 88) **now reads that real observer revision** under shadow instead of the previous deliberately absent source, rechecking before/after reserve, submit, binding, playback start and terminal via its existing anti-ABA fence. This does not grant native C-06: `PlayerTurnSourceCurrent/Idle` and `EssentialTurnKnown/Idle` remain explicitly UNKNOWN.
- **Correction to earlier Core naming inference:** the pinned `NpcTargeting.GetCurrentSpeakerPed` body simply calls `GetPlayerConversationPed` and returns. A real-DLL metadata/IL test now asserts this alias. These are two read invocations of **one** current-target source, not two independent dialogue-ownership authorities; production C-06 comments were corrected without weakening target-based vetoes.

### Genuine original Essential stock backend in-flight ownership facts (read-only, not native grant)

- The source-hash-pinned **stock Node backend's own `A` state** holds `mic.status`, the active microphone TurnId, mic release-before-hydration flag, pending PCM chunks, `turnsById`, `activeTurnIdByPedId`, pending session opens, active/pending/retiring output owners, pending player and conversation contexts, and player-turn recovery records. The existing AST-patched E1 host bridge now offers a bounded **synchronous `directorTurnPrioritySnapshot()`**, reading these **original maps** and using stock `Vt(turn.status)` terminal semantics to count unfinished original turns. Unavailable/malformed maps fail closed. No `kb`, session creation, stock audio or model call is added.
- `projectOriginalTurnPriority` is a pure, frozen, scalar-only projection. It refuses incomplete/unreadable types and treats any capturing/releasing/hydrating mic, current mic turn, buffered PCM, unfinished turn, pending text/session/context/recovery, or queued/active/retiring output as busy. Even an all-clear snapshot states `grantsNativeAdmission:false`, because a point-in-time Node read has no independently ordered, complete native owner revision/receipt.
- `IntelligenceClient.requestDirector` now independently rechecks this stock backend state **alongside the original PS2/PS3 grant at both reserve and submit**, via the real runtime host binding established in `bootstrap.mjs`. Absent, throwing or busy source state refuses any new native request. **Native cancel remains allowed** after Core source loss, original PS3 grant revocation and player takeover. The lower-level inert preview serializer remains a wire test only, not authority.
- The original backend bridge is verified against the pinned stock AST and tests; it is **not a synchronized native source of truth across asynchronous await**. The native observer still cannot independently certify all player text/mic *completion* or original Essential's pending turns. No source is promoted to a complete global arbiter.

### Exactly executed code-HEAD automated acceptance

| Matching-code test suite | Result |
| --- | --- |
| Linux isolated full Node | **717 passed / 71 files / 0 failures** |
| Windows isolated full Node | **717 passed / 71 files / 0 failures** |
| Focused Phase 13a Node | **39/39 on each OS** |
| Actual pinned Core DLL SHA, original mic/helper wrappers, text/hydration/target/revision signatures and Core speaker alias (Windows) | **PASS** |
| ACT native contracts (Windows) | **263 assertions PASS** |
| Shared PS/ACT native (Windows) | **115 assertions PASS** |
| Director/PS3 + real epoch-source fixture (Windows) | **262 assertions PASS** |
| P2 owner lifecycle (Windows) | **194 assertions PASS** |
| HostContext/anchor (Windows) | **62 assertions PASS** |
| Production PS host integration and actual monitor compilation against offline Core absence (Windows) | **144 assertions PASS** |

New tests cover source-unavailable startup, monotonic native mic/text rapid ABA, missing/shutdown source veto, real pinned ABI/helper trace, normal playback terminal acceptance in an unchanged epoch, genuine Core text/menu takeovers and unknown reads, stock backend mic release/hydration buffering, queued audio, pending text/model session/context ownership, missing/corrupt maps, original backend busy/unknown reserve+submit rejection and source-loss-safe native cancel. Metadata validation verifies the actual pinned DLL but does **not** run Unity/RPH/GTA or execute actual Harmony patches against a loaded game.

### Remaining precise Architectural Piece #2 boundary

**Still incomplete / do not start Piece #3:** even with the real native input observer and original stock backend quiet/busy projection, the missing capability is an **exhaustive, source-versioned original Essential conversation ownership receipt, transported to and coherently fenced on the native owner fiber**, covering text after editor close, mic release through hydration/recognition/generation, non-player special or directed turns, queued/active playback, asynchronous terminal transitions, and ABA under changed host/world/session. The synchronous backend snapshot has no globally authoritative terminal-transition revision or acknowledged native happens-before ordering. Native C-06 must continue to fail closed rather than map backend `quiet` or an input-hook-only counter to complete authority. The observer hook's actual on-machine runtime installation and race timing also await GTA tests.

Native stock scheduling, real `kb` call, original session/turn/generation dispatch, production RPH validation and deployment remain outside this bounded slice. All PS2/PS3/ACT/P2/UX behavior preserved, **no live GTA installation modified, PR #23 open/draft/unmerged**, Phase 10a deferred.
