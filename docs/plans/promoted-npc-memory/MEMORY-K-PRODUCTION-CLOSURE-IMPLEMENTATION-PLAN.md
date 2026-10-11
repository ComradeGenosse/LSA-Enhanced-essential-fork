# Memory K — production closure implementation plan

Status: **PLAN ONLY / NOT IMPLEMENTED / CONTROLLED GTA NO-GO**  
Plan date: 2026-10-11. Base: draft PR #94, exact reviewed head `0201731973a1c02a8852271897e2c8df420396b9`. Branch for this plan: `planning/memory-k-production-closure-20261011`. Implementation target: `integration/memory-closure-final-k-20261011`, or its latest verified successor. Original PR #75 baseline: `8443a8adec9433626902b46b81bd3e58fc382fb2`.

This plan is a source-level implementation specification. Nothing here demonstrates a completed runtime, a passing cross-agent test, an approved GTA install, or a physical-GTA receipt. Review actual current source at implementation launch; do not replay an outdated head SHA against a moving integration branch.

## 0. Delivery contract, immutable architecture, and stop conditions

**Invariants on every code path:**

1. The original Essential Core owns accepted input, session/generation validity, native playback and player speech priority. Native P2/PS2 source evidence is the only valid owner/witness input. The model, names, text transcripts, ped handles, proximity, quiet timers, a caller-supplied `nativeVerified`, or an isolated test fake cannot manufacture provenance.
2. Exactly **one P2-owned serialized SQLite connection/writer**, with explicit world profile, active timeline, current native host run/epoch, character incarnation/encounter and protagonist fences. No second SQLite owner, daemon or local AI backend. Save rollback or uncertain host state suspends mutation until explicit confirmation.
3. Only **one PS4 knowledge frame** (`renderKnowledge`/`knowledgeDelivery`). Both M4 source facts and M8 character opinions use that existing frame, with strictly validated byte limits and `RecallBundle.totalBytes`. No second hidden prompt writer.
4. M5 memory commands execute only after the **original** accepted line has a durable P2 readback and before any Luna/provider call. Acknowledgements require committed evidence. Correction, tombstone, deletion and seven-day trash restrictions apply to M4/M6/M7/M8/M9 too.
5. M7 cloud curation is default **off**, explicit persisted opt-in only, Luna-only, off-turn and native-idle-only. No real cloud call unless consent, current native priority evidence, P2 timeline, verified pricing, durable daily/monthly budget and a bounded lease all independently pass.
6. M9 never bypasses PS2 witnessing, original PS3 selection, PS6 C-06/C-11 native authorization, player priority or cooldown. Missing source means no event memory or spontaneous speech.
7. Tests may provide explicit trusted *fixtures* only within tests. No production fallback to fixture setters, STT transcript guesses, invented native source capabilities or 'success' return when evidence was merely enqueued.
8. Default existing off/shadow/experimental product behavior stays unchanged unless full source capability is positively negotiated. No merge to main, GTA installation or physical testing without a separate decision and authorization.

**Mandatory fail-closed policy:** If pinned Essential Core cannot expose an independently verifiable normal C-01 accepted-turn callback, a source-time observer attestation, complete original Core idle proof or a named native game-event source, keep that feature disabled and record the exact missing ABI/API. Do not emulate a missing source with PS3, source-time inferred from current time, JS `isCurrent` or a paid model response.

## 1. Current verified integration gaps

| ID | Actual gap at reviewed SHA | Source location | Required exit receipt |
| --- | --- | --- | --- |
| G01 | Native `acceptedTurns=[]`, existing v1 frame validator refuses nonempty C-01 data | `native/promoted-characters/MemoryOwnerAuthority.cs`, `src/perception/contracts.mjs`, `src/memory/nativeMemoryAuthority.mjs` | Original Core accepted turn + native identity/protagonist proof; stale/recycled veto |
| G02 | Runner uses older `createM2TurnCapture` instead of Agent C strict original input and completed speech-transport ports | `src/integration/essentialGlue.mjs`, `src/openai/runSequentialTurn.mjs`, `src/memory/m2EssentialCapture.mjs` | Durable exact player bytes and native-audibly-completed NPC bytes only |
| G03 | M3 `sourceAtObservation` required but current owner ledger has no historical attestation; negatives/prepromotion unavailable | `lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs`, `src/memory/nativeMemoryAuthority.mjs` | Two independent observers, source-time proofs, no false negatives |
| G04 | M5 accepts no original post-durable-commit / pre-Luna dispatcher; editor not integrated with scoped privacy | `src/openai/runSequentialTurn.mjs`, `src/characters/editorServer.mjs`, `lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs` | Exactly once command + verified receipt, clarification and seven-day trash |
| G05 | M4 + M8 exist but are not passed through the one production PS4 frame at every provider send/retry | `src/integration/essentialGlue.mjs`, `src/context/knowledgeRenderer.mjs`, `src/context/knowledgeDelivery.mjs` | One bounded, source-fenced frame, no deleted facts |
| G06 | M6 coordinator expects `readM6Checkpoint`/`readM6JournalPage`/`ackM6Checkpoint`; B exports `readCommittedEvidenceCursor`/`readCommittedEvidencePage`/`ackCommittedEvidenceCursor` and no live lifecycle orchestrator | `lsa-shared-brain/src/memory/m6CursorConsumer.mjs`, `src/characters/sqliteProfileStore.mjs`, `src/bootstrap.mjs` | Atomic cursor/proposal/queue CAS and >2,500-event crash-recovery replay |
| G07 | Verified native idle source + explicit persisted consent are absent from production; M7 scheduler not started | `lsa-shared-brain/src/memory/m7Consent.mjs`, `src/memory/lunaCurationBridge.mjs`, `src/bootstrap.mjs` | No cloud when busy/off/stale, reserved bounded budget and outage recovery |
| G08 | M9 isolated classifiers/guards are not registered on the original native gameplay source / PS2 / PS6 production chain | `native/intelligence/m9/M9NativeFrameAdapter.cs`, `src/perception/m9DirectorCueAdmission.mjs` | Actual authenticated event -> qualified witness -> admitted original Director path |
| G09 | Exact-head CI, pinned native payload/build, original M0 S01–S10 integrated replay absent | `.github/workflows/memory-k-final-acceptance.yml`, `tools/memory-sim/scenarios.v0.json` | Green relevant final-head jobs with SHA, replay logs; physical GTA separate |

Paths prefixed `src/` in this table are under `lsa-essential-e1-candidate/`. All status statements are **as of the reviewed head**; first inspect newly committed code and supersede the status if proven otherwise.

## 2. Phases and parallel critical path

| Phase | Implementation work | Prerequisites | Gate to proceed |
| --- | --- | --- | --- |
| P0 — Baseline/contract freeze | W00 inspect all agent PR heads, contract v1, PS2/PS4/PS6/native, pinned build and exact-head step logs; eliminate preexisting CI regressions before activation | PR #94 head | Reproducible baseline; documented source-owned negative gates |
| P1 — Native provenance | W01 C-01 accepted turn, W02 source-time PS2 ownership/coverage, W07 native-idle proof, W08 native M9 event hooks (separate new modules) | P0 source contracts | Native compile + isolated original-source ABI tests; no unsupported shortcut |
| P2 — Durable input and observation | W03 M2 original accepted/speech receipt, W02 M3 source-time PS2->P2, W06 source cursor adapter | P1 interface fixtures, P2 current DB | Exact SQLite persisted readbacks; host/epoch/timeline vetoes |
| P3 — Synchronous gameplay features | W04 M5 commands/privacy, W05 M4+M8 one-frame producer | P2 accepted-line and witnessing | Commands before provider, deleted facts suppressed at send/retry |
| P4 — Background features | W06 M6 scene/idle/recovery, W07 M7 consented scheduler, W08 M9 to original Director | P2/P3, native idle and C-06 | Durable crash recovery, zero unauthorized cloud/effects |
| P5 — Final integration/verification | W10 owns shared production files; W09 owns cross-agent acceptance harness | All implementation PRs pushed | Exact-head green Node 24 Windows/Linux, C# harness, pinned build, S01–S10 |
| P6 — Controlled GTA review | W10 independently reviews source/offline/physical acceptance matrix | P5 genuinely passed | Explicit **GO/NO-GO for separately authorized controlled GTA testing**; not automatic install |

Can run W01, W02, W07 native source module, W08 native source module and W09 harness scaffolding in parallel once the source contract is frozen. W03 may start with denied-source fixtures, but cannot claim production completion until W01. W04 depends on W03, W05 depends on W02+W03+W04, W06 depends on durable W02+W03, W07 scheduler depends on W06; W10 merges only verified implementations. See machine-readable `tools/memory-sim/closure-workstreams.v1.json` for the dependency DAG.

## 3. Exact workstreams and engineering deliverables

### W00 — K baseline and native/API contract freeze

Owner: **K only** (coordination, no specialist code edits).

- Verify latest PR #94 head vs the stated SHA; fetch all A–J implementation branches, handoffs and CI. Record exact file diff, contract hash, pinned upstream DLL and patch-tool SHA. List any source differences since this plan was committed.
- Run/fetch full Node 24 Windows/Linux workflow *step logs*, `npm run build` (original Essential AST patch), source hash/packaging checks and original .NET net481/8 harness status. A workflow marked 'queued' is not a passing receipt. Inspect the first failing step, fix the actual source or narrow the gate honestly.
- Publish a versioned proposed native evidence contract before W01/W02/W07/W08 start. It must fit the existing 8,192-byte named-pipe frame maximum, host/epoch/stream/sequence validation and read-only owner-fiber cadence. Do not silently mutate the existing v1 vocabulary: either add exact, strictly checked optional fields with explicit negotiation or version a new message type.
- Freeze four proof envelopes: `OriginalAcceptedTurn`, `SourceTimeObservationOwner`, `NativeIdlePriority` and `VerifiedGameplayEvent`. Each contains exact host run/epoch, adapter/stream, player/observer incarnation, source tick/time, bounded identity, source category and explicit non-claimable provenance. Define which evidence is per turn, per observation or per scene.

**Exit:** reviewed contracts and a failure inventory of all existing final-head workflows with source lines. Explicit capability flags distinguish 'not compiled', 'not exposed by pinned ABI', 'unsupported' and 'verified'.

### W01 — Original C-01 accepted-turn source and owner/protagonist authority (G01)

Allowed specialist source: new `native/intelligence/memory-*/` normal-turn evidence producer, `native/promoted-characters/MemoryOwnerAuthority.cs`, `lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs` and their isolated native/Node tests. **K alone edits** existing native global registration, `PromotedCharacters.csproj`, `IntelligenceIntegration.cs`, `IntelligenceChannel.cs`, `bootstrap.mjs`, `contracts.mjs` and `intelligenceClient.mjs`.

1. Inspect pinned original Essential Core metadata and find actual accepted normal player turn (typed/STT), original generation/session nonce, active speaker owner/turn lifetime and legitimate native model source. Prove acceptance on the original source, not on `input_transcript`, model turn readiness or a Director stock ticket. If no source exists, create an explicit unsupported ABI gate; do not fabricate one.
2. Bind accepted receipts to immutable (pedId, turnId, generationId, sessionNonce), hostRunId/worldEpoch/adapterEpoch/streamId, exact P2 ownerAlias/observerCaptureRef/incarnationId/encounterId, source tick and one of Franklin/Michael/Trevor/unknown. A player-switch transition returns unknown/rejected, never nearest player.
3. Native source publishes bounded, monotonically sequenced positive evidence. K extends validated frame protocol from positive-only `acceptedTurns=[]` while enforcing complete roster, 8,192 bytes, no missing required fields, no old stream reactivation, no retroactive proof and expiry <= current acceptance window.
4. Extend `verifyCurrentTurn` so authorizing one accepted turn never authorizes a later generation, same ped recycled handle, different speaker, world rollback or reconnect. Verify P2 current owner profile is from current SQLite timeline; ownerAlias is not CharacterId. Re-check immediately before each accepted write.
5. Add native source policy harness, two characters, all three protagonists + unknown, switch mid-turn, stale native receipt, reordered frames, host epoch/stream reset and no-origin rejection.

**Exit:** original runtime can positively prove valid normal turns, and failing/absent proof prevents all M2 capture. A mock-only `nativeVerified:true` test is insufficient.

### W02 — PS2 source-time witnessing, negatives, prepromotion (G03)

Allowed specialist source: `lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs`, `m3Ps2ObserverAdapter.mjs` and new `native/intelligence/memory-*/` immutable source-time owner/coverage producer (avoid W01 new files), with tests. K owns existing pipe/glue registrations and `integrationPorts.mjs`.

1. At native **observation source time**, save/release a bounded immutable owner snapshot for the same observerCaptureRef, incarnationId, encounterId, hostRunId/worldEpoch, adapterEpoch, sampled game tick. Bind it to the actual PS2-correlated observationId/revision; current P2 ownership sampled 250 ms later is not retrospective proof.
2. Expose `resolveNativeOwner(...).sourceAtObservation` and source-tick-qualified `resolveParticipants` with exact claims, current profile and source attribution. Unknown actor/protagonist remains `unknown`, not a guessed Franklin; PS3 'staged' or mere collision is not PS2 witness.
3. Preserve separate statuses: witnessed, explicitly source-certified did_not_witness, reported, unknown. Never convert missing observation to negative. Negative proof must include event/observer/owner/source/epoch and independently certified coverage; if the native source cannot certify it, write unknown only.
4. Prepromotion S08 needs a reserved future CharacterId+ownerAlias bound to the exact same physical incarnation **before** promotion, <=120 seconds, with source-verified first observation. Do not import unrelated ambient observations or treat a later created P2 profile as proof of earlier ownership.
5. Enqueue accepted PS2 receipts synchronously without SQLite work in the callback. Drain to the original P2 writer, idempotently store source sidecar+event, count overflow as loss and never label uncommitted callbacks persisted. Retire on observer demotion/epoch/timeline changes.
6. Add source-time tests for two simultaneously promoted NPCs seeing only their own events, ped handle recycling, delayed observations, report-only facts, certified vs unknown negatives, buffer saturation and save rollback.

**Exit:** actual correlated PS2 -> source-time owner -> one P2 SQLite event+sidecar readback works. Missing source-time proof is a safe rejection (not a pass).

### W03 — M2 accepted text and truly audible NPC receipt (G02)

Allowed specialist source: `lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs`, optional new isolated `src/memory/acceptedInputAuthority.mjs` and `speechTransportReceipts.mjs`, `lsa-shared-brain/src/memory/m2TurnCapture.mjs` and tests. K owns `essentialGlue.mjs` and `runSequentialTurn.mjs`.

1. In the existing original runner, after hydration and accepted original input, capture the exact UTF-8 typed or completed STT text *once*. Get source-confirmed `acceptedInput.verifyAccepted` and the A C-01 turn proof; then require the P2 `recordPlayerAccepted` **durable receipt**. Return structured {status, recordId, scope, proof} to W04; do not treat a RAM history boolean as SQLite acceptance.
2. K must replace old `createM2TurnCapture` runtime usage with `createM2EssentialCapture` and provide real synchronous `acceptedInput`, `playbackHistory` and `speechTransport` verification ports. No test-only ports in production. Keep acceptedLine availability explicit for per-turn command decisions.
3. Early streaming: register each provider-completed and actually forwarded segment (`admitSpeechSegment`) with ordered sequence/text/audioBytes/forwardedBytes. Buffered mode uses the same completed accepted bytes; never infer audible content by concatenating model-generated text. Bind original native `playback_started` + terminal `playback_ended` and exact host/identity; no commit on partial TTS, synth-only completion, interruption, timeout, or stale ack.
4. Call `completeNpc` only after the original history has accepted the exact native completion receipt. Treat a failed memory write as explicit loss diagnostics; do not retroactively claim completion or block stock dialogue. Retire on terminal, cancellation, identity/epoch retirement and player switching.
5. Offline real SQLite + original-runner acceptance tests: 201+ Unicode/profanity lines, Franklin/Michael/Trevor/unknown attribution, text/STT correction, buffered/streamed audio, no double commit, stale/late/recycled completion and reconnect.

**Exit:** one source-confirmed accepted player journal line and one truly audible NPC line persist with intact text and fences. W04 waits for the **actual committed receipt**.

### W04 — M5 explicit commands and scoped editor/privacy (G04)

Allowed specialist source: `lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs`, `m5SqlitePrivacy.mjs`, `m5ScopedPrivacyFacade.mjs` and new narrow service adapters/tests. K alone edits original `editorServer.mjs`, `characterService.mjs`, `runSequentialTurn.mjs` and `essentialGlue.mjs`.

1. Wire `createM5SqliteServices({store,authorize})` into original P2 serialized writer and `bindCommands()` into `createM5RuntimeCoordinator`. Provide a synchronous authority.assertCurrent backed by the W01 accepted-turn source and exact P2 scope, not JS input alone. All pending clarification reads/writes and privacy operations use that same SQLite transaction/cursor.
2. K runner sequencing (required order): original line acceptance -> W03 **durable** P2 player receipt -> W04 `acceptAcceptedPlayerLine` readback -> validated command response/clarification (if handled) -> otherwise single Luna provider call. Missing receipt must not permit a 'saved' utterance or route command text to model as an authorized mutation.
3. Stable command ID from source line+world/timeline/character/protagonist; idempotent same-line repeats, atomic compound commands, clarification alternatives frozen against the exact source/evidence revision. Pending clarifications are revoked on deletion/correction/epoch/switch or expiry.
4. Existing local editor must display correctly scoped **inspect/export/trash/restore/purge/correct** under explicit same-owner authorization with source fences. Do not use the legacy P1 memories form as a second journal/DB. Confidential exports exclude other protagonists; trash suppressed immediately, eligible restore inside seven days, purge permanently after TTL.
5. Tests: command before provider, zero false 'saved' on offline DB, ambiguous two-choice clarification, STT mishearing correction, seven-day trash/expiry, overlap/conflicting writes, cancelled/replayed command, restore after purge refused, cross-character/other protagonist isolation.

**Exit:** user-visible commit acknowledgment only after durable readback; no model/pre-write parser can mutate memory.

### W05 — M4 recall + M8 personality through one PS4 frame (G05)

Allowed specialist source: `lsa-shared-brain/src/memory/ps4RecallContribution.mjs`, `m8Interpretation.mjs`, `lsa-essential-e1-candidate/src/context/knowledgeSelector.mjs`, `knowledgeRenderer.mjs`, `knowledgeDelivery.mjs` and tests. K alone owns `essentialGlue.mjs`, `runSequentialTurn.mjs`, `knowledgeInputs.mjs`.

1. Derive a bounded `createAcceptedRecallQuery` from the exact accepted W03 source line; build authoritative snapshot (worldProfileId, timelineId, characterId, protagonistKey, hostRunId, worldEpoch, observerCaptureRef, incarnationId, encounterId, turnIdentityHash, turnId). `preparePs4Recall` within its explicit 200 ms upper deadline using existing P2 `createP2IntegratedRecallAdapter`; no invisible second fetch or invented read authority.
2. Independently project `createM8ReadAdapter` from immutable *committed* P2 sources, corrections/tombstones, approved appraisals and P2 personality. **Shared facts must be byte-identical** for two characters; only attributed feelings/relationship/joke interpretations vary. Label `opinion` distinct from `verifiedFact`; silence derived opinion if its source is no longer available.
3. Merge validated M4 + M8 payloads via `renderKnowledge` into **ONE** PS4 TurnKnowledgeFrame (existing RECALLED allocation; other lanes remain within their budgets). Verify encoded Unicode byte counts and strict `RecallBundle.totalBytes`—not a character-count approximation. Deterministically prune optional low-priority recall/opinion; fail closed when required envelope is malformed.
4. Before each provider request/stream retry and after every await, re-read exact native turn/P2 scope/source visibility, correction overlay, deleted record IDs and player/Director priority. `createKnowledgeDelivery` must prune *only* unsent recalled contributions when source is revoked; a sent stale revision must abort rather than send another old frame.
5. Tests: exact 4,096-byte recall boundary plus total frame budget; delete source before/retry/after send; actor/epoch swap mid-await; unknown protagonist; conversations after reconnect; personality divergence with identical fact source hashes; no unverified source becoming `verifiedFact`.

**Exit:** normal Luna response receives a single, source-fenced and current PS4 frame; correction/deletion prevents old facts or opinions from resurfacing.

### W06 — M6 deterministic lifecycle, durable replay and atomic cursor (G06)

Allowed specialist source: new `lsa-shared-brain/src/memory/m6P2ReplayAdapter.mjs`, `m6CursorConsumer.mjs`, `m6Coordinator.mjs` and source-bound SQLite foundation/store schema adaptations (coordinate with W04: one P2 writer only); tests. K owns `bootstrap.mjs`, `integrationPorts.mjs` and original character service.

1. Implement explicit adapter for **both** existing B `readCommittedEvidenceCursor/Page` and G `readM6Checkpoint`/`readM6JournalPage`/`ackM6Checkpoint` contracts. Do not merely rename methods: the G ack additionally proves source hashes, saved proposal IDs, queued jobs, rejection diagnostics, hour-bucket quota and CAS *inside one P2 transaction*. Extend P2 store/schema where evidence is missing; no external second writer or in-memory cursor 'success'.
2. Never advance source cursor before all eligible committed evidence is processed **or safely accounted for by a durable rejection receipt**. Preserve backlog page ordering, deterministic proposal IDs, idempotent crash restart and soft six-per-active-hour policy; avoid hard discarding eligible overflow.
3. K hooks original scene-close, verified idle, reconnect/restart and native world/clock boundary to `createM6SelectionCoordinator.onSceneClose/onIdle/recover`. Require current writable P2 scope for every page, save, curation enqueue and ack. On save rollback/host switch stop and preserve last committed cursor; resume only after explicit confirmation.
4. Drain 2,500+ authenticated source event/sidecars and 201+ accepted lines across at least two NPCs in real SQLite; crash between save and ack, before/after queued M7 job; refuse corrupted hash and late old-epoch pages; verify no evidence silently skipped after reopen.
5. Positive memory proposals must preserve source evidence IDs and correction/deletion dependency suppression before and immediately before ack.

**Exit:** crash-consistent replay from committed P2 journal, stable source IDs and atomic ack, not a 1,000-item bounded snapshot or a mock feed.

### W07 — M7 consented Luna idle scheduler and native quiet authority (G07)

Allowed specialist source: `lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs`, `lsa-shared-brain/src/memory/idleCurationScheduler.mjs`, `m7Consent.mjs`, additional native read-only idle proof module under unique `native/intelligence/memory-*/` name, plus tests. K owns native global registration, central configuration and bootstrap.

1. Extend *original native* Core/P2/PS6 priority source to certify **every** `M7_PRIORITY_QUIET_FIELDS` is positively known and idle, same host run/epoch/character/incarnation/encounter and native player speech state. `M7_IDLE_PROOF_KIND` must be derived from authenticated P2/native message only; default no proof when original ABI cannot supply the complete tuple. Silent mic for 1.5 seconds is not sufficient.
2. Explicit player settings approve off-turn evidence upload, priced Luna model and daily/monthly/max-batch budget, with a durable current consent revision. `validateM7Consent` and `validateM7Pricing` are mandatory; mode toggle, existing key or `cloudOptIn:true` alone never authorizes.
3. Use `createDurableCurationAdapters(store)` and `createEssentialM7Scheduler` over the single P2 SQLite connection. Off/shadow do not create provider work; experimental runs only when consent + `validateM7IdleProof` pass **before read, reserve, call, result and commit**. Cancel on player input, mic activity, native source change, reset or withdrawal.
4. Reserve conservative cost before calling Luna; reconcile actual billed use (including timeout/unknown) against persistent ledger, daily/monthly caps, retries/Retry-After and leased idempotency. After crash recover stale leases and never bill a duplicate admitted outcome; cloud outage must not erase M2/M3/M6 facts. Never instantiate a local GPU model.
5. Tests: busy player turns, unknown idle flags, pause, protagonist switch, idle proof expiry mid-request, consent revocation, quoted/priced costs, cloud outage/retry, spending overshoot veto, stale lease/restart/recovery, source deletions during model response.

**Exit:** verified native quiet + durable consent + price + reservation are jointly necessary; otherwise **zero outbound provider calls**.

### W08 — M9 authentic native events + qualified PS2 + original Director (G08)

Allowed specialist source: `native/intelligence/m9/M9NativeFrameAdapter.cs` and new scoped event producer module(s); `lsa-shared-brain/src/events/m9EventProducers.mjs`, `m9Ps2CandidateBridge.mjs`, `m9MemoryCues.mjs`, `lsa-essential-e1-candidate/src/perception/m9DirectorCueAdmission.mjs` and tests. K owns original GTA native integration registration, `bootstrap.mjs` and existing Director global.

1. Register genuine **supported by this pinned GTA/RPH/Core ABI** source producers for rollover/airborne/water/wanted/Wasted/Busted, with explicit unknown fields, no invented collision outcomes/positions/reasons. Every event has authenticated source run/epoch, native event ID, source tick, current actor scope and bounded content. Unsupported sources stay disabled.
2. Admit as memory only after source candidate -> PS2 correlated observation -> W02 source-time witness -> durable P2 event+sidecar -> M6/M4 eligible recall. A native callback alone proves event occurrence, not that any promoted NPC saw it.
3. Memory callbacks are proposals, never independent speech. Feed only genuine PS3 candidates and PS6 original Director entitlement through `M9DirectorCueAdmission.attempt`; verify source/owner/grant before and after async lookup. Preserve C-06 native final veto, cooldown, player text/mic/essential playback priority, and refusal on unsupported action.
4. Record an audible callback only after original native playback completion using W03's accepted receipt system; do not record generated-but-never-heard dialogue.
5. Tests: corrupted/source-unknown event rejection, duplicate frame, two observers, player priority in mid-callback, cooldown and per-character concurrency, retroactive event rejection, native 'busy' veto and no side-effects on off/shadow modes.

**Exit:** authentic native callback, independently witnessed P2 fact and original Director approval are all present; zero bypasses.

### W09 — Real end-to-end tests, pinned packaging, negative gates (G09)

Allowed specialist source: `lsa-essential-e1-candidate/tests/memory-k-*.test.mjs`, `lsa-shared-brain/tests/memory-k-*.test.mjs`, `native/intelligence/*-tests/`, `tools/memory-sim/` (except coordinator-owned acceptance status fields), and dedicated `.github/workflows/memory-k-*.yml`. K owns acceptance report and final CI/workflow conflict resolution.

1. Introduce deterministic **end-to-end original runner** test harness over a real temporary P2 SQLite file, original input and native-playback receipt adapters; each source proof must be emitted from its own narrow source fixture. Separate "mocked component" from "integrated source simulation" and "physical GTA" in emitted reports.
2. S01–S10 actual replay implementations, not a manifest-only `implemented:true`:
   - S01 exact Unicode/profanity across reconnect;
   - S02 mundane qualified firing still recalled after >=3 minutes despite PS3 omission;
   - S03 two promoted observers, unwitnessed second has no fact;
   - S04 ambiguous remember -> clarification, no false saved ack;
   - S05 Luna offline, deterministic memory durable and budgeted retry;
   - S06 same committed source facts / differing two-NPC interpretations;
   - S07 clock regression/timeline suspension/explicit confirmation;
   - S08 <=120 second source-proven prepromotion exact owner import;
   - S09 accepted mic mishearing, source-linked correction and suppression;
   - S10 original Director cooldown/player priority/verified playback callback.
3. Stress real SQLite: >=201 accepted dialogue lines and >=2,501 event source receipts, two+ promoted NPCs, each Franklin/Michael/Trevor/unknown, recycled native handles, late/duplicate receipts, crash between every durable phase, save rollback, reconnect, transient M7 failures, privacy seven-day expiry, and source hashes/byte caps. Require assertions on actual stored rows, not just queued counts.
4. Final SHA tests: Node 24 on Windows/Linux; original `npm run build` pinned Essential AST patch; strict schema, original native .NET 4.8.1/8 harnesses and compile-time registration; packaging manifest verifies actual source hashes/ABI/embedded dependencies and no GTA deployment. Check that native source was **actually compiled**, not just standalone class tested.
5. Keep `tools/memory-sim/scenarios.v0.json` `implemented:false` until original complete replay produces pinned machine-readable log (scenario ID, source SHA, test command, case/result, phase and receipt path). A copied earlier PR/agent success is not sufficient.
6. CI must have a **hard non-green acceptance gate** when original replay or required native build cannot execute. Report environment/pin missing vs code failure honestly; do not weaken checks to achieve green.

**Exit:** source-level, integrated offline and (later) physical-GTA acceptance remain separate columns with exact head-specific logs; no handoff-only completion.

### W10 — K exclusive source-correct final integrator

**The following paths MUST have one writer (K):**

- `lsa-essential-e1-candidate/src/bootstrap.mjs`
- `lsa-essential-e1-candidate/src/integration/essentialGlue.mjs`
- `lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs`
- `lsa-essential-e1-candidate/src/context/knowledgeInputs.mjs`
- `lsa-essential-e1-candidate/src/perception/intelligenceClient.mjs`
- `lsa-essential-e1-candidate/src/config/e1Config.mjs`
- Original `src/characters/editorServer.mjs` and `characterService.mjs`
- `lsa-shared-brain/src/memory/integrationPorts.mjs`
- Original native global Core/PS2/PS6 registration, `native/promoted-characters/PromotedCharacters.csproj`, `RuntimeEntry.cs` and `native/intelligence/IntelligenceIntegration.cs`
- Central CI/packaging and `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`.

Create fresh integration branch from the **latest verified PR #94 head** *after* specialist PRs are delivered. Cherry-pick reviewed code, not docs-only changes. Wire original source hooks in this strict order:

```text
trusted native hello/epoch + P2 explicit timeline confirmation
    -> immutable original accepted C-01 turn + owner/protagonist/source evidence
    -> original accepted typed/STT text -> M2 P2 SQLite durable commit
    -> if durable: M5 scoped command/clarification readback, before Luna
    -> if normal dialogue: M4 source recall + M8 typed opinions
    -> ONE PS4 frame: validate/prune before EVERY model dispatch/retry
    -> strict original speech transport + native completed playback -> M2 NPC commit

independently: authentic native event -> source-time PS2 witness -> P2 event+sidecar
    -> M6 source cursor/scene+idle+restart -> deterministic memories
    -> explicitly consented + native-verified idle + durable budget -> M7 Luna
    -> M9 eligible verified memory cue -> original PS3/PS6 Director -> native receipt
```

No event path may call an LLM, perform SQLite write or schedule speech directly from a native callback. No background work begins while player priority is uncertain. For every shared integration seam add source-fenced tests of the **actual production imports**, not copied fixture glue.

## 4. Machine-readable work assignment and PR discipline

- All specialist branches start from the same **verified implementation baseline**; first parent exact SHA is required. Never branch off main or another specialist's in-progress branch. Target PRs to the K integration branch; if it advances, rebase under K supervision without rewriting source history claims.
- W01–W09 own only their designated new/specialist paths; K owns all shared integration files above. Any shared-file change proposed by a specialist must be a reviewable diff/handoff, **not a pushed overlapping edit**.
- Each specialist publishes one implementation PR containing actual source, offline tests, and `docs/plans/promoted-npc-memory/closure-handoffs/PRODUCTION-Wxx.md` with exact commit, files, test commands, CI run URLs and remaining source limitations. Documentation-only PR is not completion.
- Workstream metadata and DAG are held in `tools/memory-sim/closure-workstreams.v1.json`. Keep status `planned` until a code commit and source-correct review proves otherwise; source tests are not proof of physical GTA functionality.
- K performs conflict resolution, combined source code review, full exact-head CI, pinned builds, acceptance matrix and final **GO/NO-GO for separately authorized controlled GTA testing**. Do not auto-merge PR #94 to main.

## 5. Mandatory acceptance gate matrix

| Gate | Required code / evidence | Scope | Release consequence |
| --- | --- | --- | --- |
| A00 | Full immutable source contracts and negative ABI inventory | W00 | Blocks activation if source unknown |
| A01 | Original C-01 accepted turn and exact native owner/protagonist | W01 | M2 disabled if unavailable |
| A02 | Source-time PS2 witness, certified negatives and reserved prepromotion | W02 | M3 negatives/S08 disabled if unsupported |
| A03 | Source-bound player text + completed audible NPC payload | W03 | No journal false completion |
| A04 | Durable command/clarification + privacy readback | W04 | No false acknowledgment |
| A05 | One PS4 frame, byte exact, source/tombstone current at every dispatch | W05 | No stale recall/opinions |
| A06 | Atomic P2 cursor/proposal/queue CAS and 2,500+ event restart | W06 | No M6 activation if backlog lossy |
| A07 | Explicit consent, complete original native idle and durable M7 budget | W07 | No paid cloud activity |
| A08 | Authenticated M9 events + PS2 witness + original PS6 priority | W08 | No spontaneous memory speech |
| A09 | Node24 Windows/Linux, strict schema, native harness and pinned patch/build/packaging | W09/W10 | No controlled-GTA GO without receipts |
| A10 | All original S01–S10 integrated source-sim replay and isolation/soak | W09/W10 | No controlled-GTA GO without receipts |
| A11 | Source/offline/physical-GTA separate matrix and review | W10 | Manual gate; no physical success pre-authorization |

**Final decision rule:** GO for *separately authorized controlled GTA testing* only if A00–A10 are proven on the same final SHA, no unsupported required native producer remains, all source/epoch/privacy/priority guards are enforced, and all failure logs/packaging are reviewed. This is not GO for a GTA deployment, merge to main, paid cloud traffic or a physical-GTA acceptance claim. Subsequent physical testing needs explicit user authorization and real game receipts; it has not occurred.

## 6. Immediate first commits to implement

1. W00: pin latest PR #94 head and collect K workflow failures and exact ABI evidence; avoid changing source until the failing CI step is understood.
2. W01/W02: prove native C-01 and observation-time source can exist in the pinned Core; contract-negotiate and implement source producers. W07 investigates all original native idle priority fields concurrently.
3. W03: replace the old M2 binder with Agent C's strict ports **only after source proof works**, preserving default fail-closed semantics; expose immutable commit receipt for W04.
4. W06: add **real** B-to-G atomic replay cursor adapter and tests before any M6 lifecycle timer/scene hook.
5. W04/W05: original accepted-line command gate, then one-frame recall/opinion path, with revalidation before each provider request.
6. W07/W08: last—activate consented M7 and Director memories only after native quiet/PS2 witnesses are real.
7. W09/W10: run final exact-head suite, close all S01–S10 with real replay logs, verify original pinned package, update acceptance and produce an independent decision.

**Do not treat the creation of this document, the workstream manifest or its validation script as feature implementation.**
