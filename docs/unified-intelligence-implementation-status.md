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
