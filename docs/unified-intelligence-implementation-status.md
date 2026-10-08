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
