# PS4 dialogue knowledge projection: remaining implementation against current main

Date: **October 8, 2026**. Scope: reconcile the existing PS0–PS8 design with source; identify the implementation needed for Luna's conversations. This is an implementation update to the corpus consolidated in **PR #16**, not a new architecture or research program.

For the exhaustive implementation handoff requested after this update, see the [PS4 code-level implementation plan](PS4-code-level-implementation-plan-20261008.md): exact C-02/C-04/C-13/C-14 integration points, phased changes, required tests, rollout gates and GTA criteria. It extends this update without changing settled architecture or implementing production code.

Audited `main`: **`7e54b17b53f2786f3e9294e546db6b560fb5f6a7`**, last committed October 6 at 13:49 EDT. All main-source evidence links below are pinned to that commit. Implementation recommendations do not mean those changes are already merged, enabled, deployed, or GTA-accepted.

## Finding

**PS4 is still missing on current main.** PS2 constructs observer-qualified observations and PS3 produces deterministic salience decisions, but the production Luna request does not consume either. P2 already supplies useful character canon and selected manual memories; the gap is connecting those existing inputs through **C-04 `TurnKnowledgeFrame`**, with an authenticated actor/observer join and a safe projection of every request input.

Complete the existing knowledge assembly seam. Reuse Essential's lifecycle, P0 snapshots/action fences, P1 bindings, P2 profiles, PS2 observations, PS3 ranking/acknowledgements, and ACT receipts. A second context compiler, memory database, event ledger, model-based ranker, or research effort is unnecessary.

## 1. GitHub updates and corpus authority

The repository was checked through GitHub API metadata and a fresh clone of its branches:

| Update | Verified state | Consequence for this work |
| --- | --- | --- |
| [PR #16: research corpus](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/16) | Merged October 6; corpus head `f154257` is an ancestor of audited main. | Start with the canonical entrypoint, CURRENT, DECISIONS, contract register, domain maps and phase status documents. |
| [PR #14: PS3 follow-ups](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/14) | Merged October 5. | C-03 acknowledgement and retained-history/telemetry fixes already exist; do not reimplement them. |
| [PR #18: ACT0–ACT2](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/18) | Merged October 6 at `b2221917`; confirmed in main ancestry and phase status documents. | ACT consolidation is no longer a prerequisite to repeat. Its cross-system C-02/C-06/C-13/C-14 work must still be checked separately. |
| [Radio v2 branch][radio-v2] | `ad6cad61a0108f40e9ed2e738be756c63ab05350`; five commits ahead of main, zero behind; unmerged. Includes R0–R5 and corrected text-ID catalog integration. | There is reusable partial dialogue projection work outside main, but it is not general PS4. Integrate it as a C-04 contributor. |
| [Damage-delivery update][damage-update] | Research-only branch `569ed9e`; not merged. | Existing evidence reports zero direct callback entries despite sampled injury/death events. Keep precise callback-derived attribution gated; this update introduces no new investigation. |

Authority remains [the corpus entrypoint][corpus], [D-001–D-017][decisions], [C-01–C-15][contracts], and [the convergence architecture][convergence]. The old PS/Director document is preserved as historical design provenance, including the original PS4 scope; its old statuses, budgets and ownership assumptions are not current authority.

**Status correction:** the opening summary/table/queue in ROADMAP and CURRENT still describe ACT0–ACT2 as unmerged. The later [ROADMAP ACT sections][roadmap-act], [ACT0/1 status][act01-status], [ACT2 status][act2-status], main ancestry and PR #18 establish the newer state. Likewise, the roadmap's radio row predates the unmerged R3–R5/v2 branch. Use the verified states above rather than redoing already merged work or assuming branch work is production.

## 2. PS0–PS8 reconciliation

| Phase | What exists on audited main | What remains / relationship to PS4 |
| --- | --- | --- |
| PS0 | Closed factual contracts, bounded transport, lifetime anchors, immutable Observation contract. | Preserve them; implement the C-02 cross-system observer join and C-13 shared lifetime fencing around them. |
| PS1 | Native snapshot/callback/sampling adapters and bounded shadow facts. | Producer-specific GTA acceptance remains incomplete. Enum names or service-running flags do not establish reliable delivery. |
| PS2 | Witness policy, episode correlation, immutable per-observer revisions, bounded observation/transcript stores. | Direct player-speech hearing remains unavailable without C-01 source-time receipts. Consume observations, never the more knowledgeable raw signal/episode. |
| PS3 | Deterministic context/memory/response categories, ranking helpers, bounded caches and C-03 acknowledgement. | Runtime calls omit profile/recognition/memory/trait inputs and supply `activity: 'unknown'`. Connect existing policy branches; do not replace the ranker. |
| PS4 | P0 and P2 provide reusable pieces; no general knowledge frame, selector, projection, actor/observer binding, or request integration. | The implementation checklist in section 5 is the remaining core work. Radio R5 is only a branch-local partial slice. |
| PS5 | P2 schema v1 manual memories and ordinary dialogue history exist. | Automatic experiential memory staging/promotion/writing is absent. It requires TimelineGuard, Profile v2 and SubjectRef (C-07/C-08/C-15). PS4 reads current manual canon without pretending PS5 exists. |
| PS6 | Essential special-turn lifecycle exists. | Director admission/ticketing, autonomous initiative and arbitration are future consumers. `urgent` does not authorize a new turn. |
| PS7 | Related-character IDs can be stored in manual memories; native directed-interaction seams exist. | Relationship edges, recognition policy, responder reservation and shared/NPC-to-NPC conversation are not implemented. ACT7 owns physical directed execution. |
| PS8 | Existing supported native/Essential vocabulary only. | Broader verified producers and actions remain later work. PS4 must not invent missing evidence or action capabilities. |

PS0–PS3's recorded shadow deployment proves transport/evaluation activity, not conversational enrichment. [PS3 status][ps3-status] explicitly records that relationship, memory and trait relevance are offline policy coverage only. [ROADMAP's PS sequence][roadmap-ps] still calls for PS4 before automatic experience and initiative.

## 3. Actual production conversation path

```text
GTA / Essential
  -> IntelligenceIntegration + retained native anchors
  -> IntelligenceClient.runtime / ShadowRuntime
  -> EpisodeCorrelator -> ObservationStore -> SalienceCache
  -> diagnostics/cached decisions                      [stops here]

Essential typed / microphone / special turn
  -> OpenAIConnection.beginTurn: P0 actor/listener/world/reference snapshot
  -> prepareIdentity -> CharacterService.prepareTurn
  -> P2 allowlisted canon + selected manual memories
  -> runSequentialTurn -> decide / decideStreaming -> buildRequest -> Luna
```

The missing connection is **the captured turn actor's observer-qualified observations + character-aware salience -> one frozen C-04 frame -> the actual request body**.

Evidence:

- [Bootstrap][bootstrap] constructs intelligence only for `mode: 'shadow'` and attaches a transcript callback. It supplies no general turn-knowledge service. ACT is bound to CharacterService for controls, not to model knowledge.
- [ShadowRuntime][shadow] owns the observation/episode/salience stores and calls `noteSalience`; its call provides current lifetime/channel/player facts and `activity: 'unknown'`, without a character view.
- [OpenAIConnection][connection] freezes the P0 actor/listener/world/reference map. Its identity preparation subsequently invokes CharacterService; it has no PS knowledge snapshot.
- [CharacterService][character-service] reads the current profile during `prepareTurn`, attaches its narrative to `actor.characterProfile`, and appends a canon authority block to the system instruction. This is useful existing P2 behavior, not a perception consumer.
- [Both reasoning paths][decide] call the same [buildRequest][request] with `systemInstruction`, actor, listener, world, contextText, internalEvent, current input and history. No observations or salience are passed.

### Existing memory enrichment is real, but narrower than PS5

[sessionProfiles][profiles] projects name, biography, personality/traits, player-facing relationship and memories with `selectedForContext === true`, within **16 KiB**. Selected memories are sorted by importance descending, then memory ID; there is no explicit three-memory limit or contextual selection of unselected entries in current code. Their related-character metadata is not passed into this narrative selection.

The profile is serialized in both its authority block and actor data, so **16 KiB is a canon projection limit, not a total request limit**. PS4 should render each piece once under its lane budget while retaining the existing canon precedence and diagnostics. Do not revive the archived 4 KiB canon assumption or archived storage-order selection rule.

[ProfileStore][profile-store] remains schema v1. Its player-facing memory create operation stamps player provenance; it is not an automatic event writer. `worldProfileId` partitions a store but is not a save timeline. A selected player-authored event/promise memory can remain authored canon; that does not establish a verified gameplay experience.

[DialogueHistory][history] is scoped by ped/session and already commits assistant speech only after matching successful playback. Preserve this store/lifecycle; a model response, TTS completion, or PS3 label is not a durable-memory write.

## 4. C-04 is the existing solution

Implement the six lanes already defined by [C-04][contracts]:

| Lane | Existing owner/input to reuse | Projection rule |
| --- | --- | --- |
| SELF | P2 canon; actor's own validated state; later ACT/C-05 evidence | Preserve authored characterization. Distinguish instruction, acceptance, mode established and physical completion. |
| PERCEIVED | PS2 Observation revisions, ordered using PS3 | Select only this observer's live, qualified claims. Preserve modality, uncertainty and claim-specific time. |
| CONVERSE | Existing committed history + current accepted typed/STT input; future receipt-qualified overhearing | Render history/current input once as role messages. Direct input to the selected actor is distinct from other NPCs hearing it. |
| RECALLED | Current selected manual P2 memories; later timeline-safe experiential memories | Manual canon is readable now. Recognition/timeline-filtered automatic recall waits for its real dependencies. |
| SITUATION | Allowlisted local world/environment and normalized situation facts | Expose experienced time/location/weather/current activity only at the strength of available evidence. |
| COMPAT | Explicitly allowlisted Essential actor/listener/world facts and grounded action labels | Preserve capability semantics and valid P/V labels without exposing backend IDs, private profiles or global knowledge. |

The frame's exact turn tuple, observer captureRef, decision keys, revisions and provenance are **private validation metadata**. Keep them for fences/acknowledgements; the model-visible serializer excludes CharacterIds, ownership/authentication data, native addresses, raw handle maps and transport internals.

Listener data describes what the speaker can know about the listener. It must not import the listener's private biography, memories, warrants or perception. An auditory shot is a heard sound; it does not establish a visible shooter, victim or death. A report remains attributed hearsay. Shared episode claims cannot fill gaps in an individual Observation.

## 5. Exact remaining implementation checklist

### 5.1 Bind the captured actor to its observer: C-02 + C-13

- [ ] Promote the existing [EntityAnchors][anchors] service to the shared host seam described by C-02; retain its handle/address/wrapper/owner-lifetime validation and quotas. Reuse it from PS/ACT/P2 rather than minting another entity table.
- [ ] Add a private, versioned actor/observer association at the existing [native EnrichActor seam][enrich]. Current actor enrichment carries `encounterId`; PS wire anchors carry captureRef/kind/observer/owned/conversation, without an encounter/incarnation join. Publish enough host/epoch/incarnation evidence for the exact captured actor to resolve its PS observer.
- [ ] Join promoted actors to P1-authenticated profile identity only for the same owned incarnation. Ordinary actors remain supported through a validated transient lifetime; they need no promotion, CharacterId or fabricated session.
- [ ] Implement the shared `hostRunId`/world epoch broadcast required by C-13 and negotiate matching closed native/companion schemas. Today PS, ACT and P1 have separate run identities; PS clock regression resets its own channel. Reject stale/mixed-run bindings and clear joins on retirement, reconnect, replacement, host reload or world discontinuity.
- [ ] Missing/ambiguous join means empty PERCEIVED and a safe basic frame. A bare ped handle, matching model/name, the newest observer, or `conversation: true` alone is not the exact actor association.

**Exit:** switching speakers or reusing a handle cannot transfer observations or profile state. This is a prerequisite for general PS4 perception delivery, not a completed consequence of ACT2's merge.

### 5.2 Supply character-aware ObserverSituation: C-14

- [ ] Wire the existing [situationFromCharacterView][salience-situation] adapter to the bound actor's frozen P2 profile/revision, explicit trait policy tags, player relationship, memory relevance metadata and valid participant recognition bindings.
- [ ] Add C-14's one normalized activity view from trusted ACT/P2/Essential state. Use `unknown` for unsupported fields. [ACT EndOwnership][act-owner] currently writes encounter mode `idle` after detach; do not treat that alone as proof that a continuing native behavior stopped. Implement C-06's truthful owner/mode view before relying on that distinction.
- [ ] Keep backend identity and observer recognition separate. The v1 Observation validator requires `recognizedCharacterIds` to be empty; do not start inserting UUIDs into it. Keep recognition in an independently validated private binding/view, with a closed contract if its schema evolves.
- [ ] Reuse PS3's classification and [ordering helper][salience-order]. Re-evaluate the frozen observations against the frozen character situation when its policy/revision requires it; preserve grant/consumption rules rather than adding a second scoring engine.

**Exit:** valid actor canon/memory/activity changes affect relevance; a backend-known but unrecognized participant contributes no private name, relationship or prior-memory link. Baseline observations can be projected with unknown activity/anonymous participants while unsupported situation inputs remain omitted.

### 5.3 Freeze knowledge with P0; finish input selection without resampling

- [ ] Extend `OpenAIConnection.beginTurn` / P0's snapshot boundary with the eligible Observation revisions, matching salience state, character/profile revision, recall candidate pool, committed-history snapshot and situation inputs. Clone/freeze them before identity/provider awaits. Do not keep mutable Maps or live store readers in the frame.
- [ ] Capture profile content/revision at this boundary when its current binding is valid. If identity preparation must finish asynchronously, it may validate that captured binding; it must not silently pick up a later editor revision, a replacement actor, or a newly witnessed event.
- [ ] After STT supplies the accepted input, complete CONVERSE and any query-sensitive selection from the **frozen** pool. Reuse one final frame for nonstreaming, structured streaming, early TTS and a safe provider retry. Do not run selectors against live state on every attempt.
- [ ] Check exact tuple, actor lifetime, host/world epoch and evidence eligibility before dispatch. Expired or invalid input is omitted/rejected with a safe fallback or the existing turn cancellation; never substitute newer evidence into an already frozen frame. Late facts belong to the next turn.

**Exit:** events, profile edits and recognition changes during delayed STT/model work cannot rewrite the in-flight narrative. P0 action reference validation still uses its private captured maps and time-of-use checks.

### 5.4 Select bounded observations and recalled canon

- [ ] Implement the previously scoped `knowledgeSelector.mjs` against ObservationStore + PS3, not raw signals or EpisodeStore. Match observer, observation ID/revision/native run, expiry and current participant lifetimes before ordering/selecting.
- [ ] Pair each decision with its matching frozen Observation and ObserverSituation before using the ordering helper. Current SalienceCache entries hold observer/decision/time, not those complete ranking inputs; cache enumeration alone is not a selector.
- [ ] Honor `context: omit|candidate|must_include`; prioritize current safety, material escalation, personally relevant evidence and deterministic tie-breaks using existing PS3 ordering. A `response: none` observation can still provide dialogue context; `memory: stage` does not write memory.
- [ ] Preserve claim-level visual/auditory/self/report qualification. Do not deduce causality, identification, action completion or later outcomes from episode continuity.
- [ ] Reuse P2's authored-memory filtering, importance/ID ordering and canon precedence. Make observation/memory count and byte limits explicit. The historical PS4 starting scope was two observations/three memories; those limits are not enforced on main. If adopted, apply the cap after current selected-memory ordering, report excluded pins, and keep manual selection ahead of automatic candidates. Do not silently restore the historical first-three storage-order rule.
- [ ] Preserve the implemented 16 KiB canon bound and define total/per-lane UTF-8 accounting for C-04, including serialization overhead and role-message allocation. The active contract names these budgets but does not supply a locked numerical total. Set explicit implementation constants and test them; do not mislabel the canon bound as a whole-request bound. Budget pressure needs deterministic omissions/counts and reserved safety space.

**Exit:** a useful personal/event fact reaches the turn within a fixed budget; repeated low-relevance events and large profiles cannot swamp it. No embedding service or extra model call is needed.

### 5.5 Replace every model-facing narrative ingress

- [ ] Implement `knowledgeProjection.mjs` / `TurnKnowledgeFrame` by extending the existing P2 allowlist and canon grounding. CharacterService becomes an input provider for the frame; ACT/radio become typed contributors. Serialize canon/memory once.
- [ ] Route `decide` and `decideStreaming` through the same frame renderer in `buildRequest`. Cover typed, mic, special-event and retry/early-TTS controllers, including turns with identity/P2 unavailable or disabled.
- [ ] Audit **systemInstruction, actor, listener, world, integrations/raw integrations, contextText/realtime context, internal-event text, profile authority text and history/current input**. Today's [request serializer][request] directly stringifies actor/listener/world and interpolates the other strings. Stripping two integration names is insufficient.
- [ ] Separate trusted behavior/action/output instructions from their stock-generated scene narrative at the source-pinned [build hook][build-hook]. Rebuild scene facts from closed allowlists. Preserve current Essential capability declarations and grounded P/V labels; keep raw reference maps exclusively in validation. Never forward an unchecked stock narrative or special-event Content beside the safe frame.
- [ ] Retain listener omission versus explicit null semantics. Unknown fields remain unknown. Projection/optional-storage/contract failure falls back to the same privacy-safe basic actor/compat projection, never raw actor/world/system context.
- [ ] Preserve player-input-once and playback-gated assistant history. Special/internal sources remain internal, with no fabricated user transcript. Existing history is conversational evidence, not proof that an assistant's assertion or intended action happened.

**Exit:** every supported OpenAI request uses the same epistemic boundary. Stock Gemini retains its existing route; opt-in Gemini knowledge parity remains a later capability, not permission to alter its lifecycle in PS4.

### 5.6 Deliver and acknowledge: reuse C-03

- [ ] Expose a bounded snapshot/selection/acknowledgement service through existing runtime services/IntelligenceClient rather than leaking store access to each feature.
- [ ] For each actually delivered selected item, call [SalienceCache.acknowledge][salience-ack] with its exact `decisionKey`, consumer `ps4_context`, and outcome `delivered|rejected|expired`. Define and test delivery as a successful reasoning result from a request containing that item, independent of whether its reply later plays; merely selecting, freezing or starting a failed request is not delivery.
- [ ] Keep acknowledgements tied to the frozen revision/key and current lifecycle. A new live salience revision must not redirect an old acknowledgement. Model retries must not acknowledge twice or regrant initiative. Late cancelled/superseded completions do not publish an acknowledgement for a successor.
- [ ] Respect current semantics: `ps4_context` delivery records `consumedBy`; **only delivered `ps6_ticket` sets response consumption**. Dialogue context does not consume the future Director's response entitlement.
- [ ] Add passive allowlisted counters/hashes for frozen frames, lane counts/bytes, omissions, join failures, source/revision and outcomes, plus a final-request hash. Extend event validators where needed; normal operational JSONL must not include prompts, canon, transcripts or memory text. Existing explicit private prompt audit can be used for a controlled acceptance check.

**Exit:** a selected fact is demonstrably present in the sent request and has the correct consumer outcome. PS3 counters alone are insufficient evidence.

### 5.7 Convert the existing radio slice; add evidence-backed SELF contributors

- [ ] Reuse v2 radio producer/catalog/witness logic and bounded phrasing. Replace its [R5 projector][radio-projector] as an independent prompt writer with a typed PERCEIVED/SITUATION contribution selected from the exact frozen actor's observations.
- [ ] The branch currently selects the one live `conversation` observer, selects after STT, and appends `[SELECTED AUDIBLE ENVIRONMENT]` to existing `contextText` for player turns. Those are useful partial hooks, but they leave raw request paths intact and do not provide P0-time general knowledge freezing. Carry over its failure/unknown-song tests while replacing those gaps.
- [ ] Read ACT's existing [ActivityFacts][activity-facts] and receipts for qualified SELF/situation items. `instructed`/`accepted` are intentions/admission; `mode_established` proves a mode; `world_strong` is required for physical completion. Do not inject F11 display phrases as stronger narrative evidence.
- [ ] Implement C-05 DialogueActionReceipt before claiming that a Luna-issued `DO` was accepted/executed independently of spoken-history commit. Reuse the ACT callback ring. Until then, omit unsupported action-outcome self-knowledge. C-05 is not a reason to delay baseline PS4 perception/manual-canon projection.

**Exit:** radio and ACT use the same assembler and evidence strength rules; neither adds another free-form prompt block. Later ACT4 can build on these contributors without owning a prompt writer.

### 5.8 Explicit rollout gates

- [ ] Keep existing perception `off` and `shadow` meanings. Current config normalizes anything except `shadow` to `off`; neither mode authorizes general PS4 enrichment. Add an explicit validated PS4 delivery capability/gate, default off, rather than silently interpreting a shadow run as active prompt mutation.
- [ ] A PS4 shadow preview can build/count hypothetical frames without sending them, acknowledging delivery, changing turns, writing memory, dispatching actions or interrupting playback. Active PS4 enriches already requested turns; initiative still belongs to PS6.
- [ ] Update native/companion contract validators, reserved integration normalization, build/source pins/manifests, examples and phase status docs together. Missing capability/version support disables only that enrichment and preserves safe ordinary conversation.

**Exit:** enabling conversational enrichment is explicit and independently verifiable; upgrading an existing shadow config cannot quietly change Luna's behavior.

### File work map

Paths below are relative to the repository root. New modules are the selector/projection already scoped by the PS design, not another architecture.

| Files / existing seam | Remaining work |
| --- | --- |
| `native/intelligence/EntityAnchors.cs`, `IntelligenceIntegration.cs`; `native/promoted-characters/RuntimeEntry.cs`, `PromotedCharactersIntegration.cs`, `ActivityDispatch.cs` | Shared anchors/host epoch, captured actor association, truthful supported situation/owner evidence. |
| `lsa-essential-e1-candidate/src/perception/contracts.mjs`, `native/intelligence/IntelligenceChannel.cs`, ACT/P1 contract peers as needed | Closed version/capability negotiation and retirement/reset propagation. |
| `src/perception/intelligenceClient.mjs`, `shadowRuntime.mjs`, `observationStore.mjs`, `salienceEngine.mjs` under the candidate | Bounded read/ack service, authenticated character situation, matching revision joins; reuse ranker/store machinery. |
| New `src/perception/knowledgeSelector.mjs`, `knowledgeProjection.mjs` under the candidate | C-04 frozen frame, lane selection, qualification, allowlists and byte budgets. |
| `src/openai/openaiConnection.mjs`, `runSequentialTurn.mjs`; `src/context/turnSnapshot.mjs` under the candidate | Freeze with P0, finalize accepted input, reuse across provider paths/retries, exact delivery acknowledgement. |
| `src/characters/characterService.mjs`, `sessionProfiles.mjs`, `characterAuthority.mjs` under the candidate | Frozen canon/manual-memory inputs and existing precedence, single serialization instead of independent prompt append. |
| `src/openai/decide.mjs`, `src/context/essentialDecision.mjs`, `tools/buildCandidate.mjs`, bootstrap/config/native-support/event-contract peers under the candidate | One request renderer, safe stock-context seam/fallback, source pins/manifests, explicit rollout and passive evidence. |
| Existing P0/P2/perception/salience/transport/build tests and native intelligence/host harnesses | Cross-side contracts and end-to-end request cases in section 7; preserve action/playback/Gemini regression coverage. |

## 6. What is required now versus gated later

| Dependency | Needed for baseline PS4? | Treatment |
| --- | --- | --- |
| C-02 exact actor/observer join; C-13 cross-system run/epoch fences | **Yes**, for active observer-specific perception. | Implement using existing host/anchor ownership; safe empty perception if unavailable. |
| C-14 profile/situation source | **Yes** for full character-aware salience. | Deliver supported fields; retain explicit unknowns for unsupported activity/recognition. |
| C-06 truthful physical owner | Required when projecting owner/mode conclusions. | Fix the actual evidence seam; ACT2's merge did not implement the proposed owner token automatically. |
| C-01 source-time utterance receipts | **No** for direct typed/mic turns plus non-speech observations. | Required before claiming nearby/overheard player speech. Keep speech hearing off; accepted STT alone proves no other observer heard it. |
| C-05 dialogue-action receipts | **No** for baseline perception/manual canon. | Required for action self-knowledge and before ACT4/PS5 uses dialogue-action outcomes. |
| C-07/C-08/C-15 TimelineGuard/Profile v2/SubjectRef | **No** for current manual authored canon. | Required before automatic experiential recall/write, durable protagonist-specific relationships or commitments. Do not pool future experiences across saves/protagonists. |
| PS6/PS7 admission, reservation and social exchange | **No**. | Leave future lanes/consumers empty; no autonomous turns or group routing in PS4. |
| Reliable direct damage callbacks | Producer-specific gate. | Use existing qualified sampled evidence where supported; never upgrade it to attacker/weapon attribution from an unavailable callback. |

There is no need to wait for every future phase before conversations improve. Conversely, adding one observation paragraph while leaving unrestricted stock context beside it does not complete PS4.

## 7. Implementation order and acceptance

1. **Land C-02/C-13 and the private actor association**, with native/companion contract tests and retirement/reconnect cases. Establish C-14's supported character view; fix C-06 where owner truth is consumed.
2. **Land the frozen C-04 frame, selector and projection**, extending P0/P2 and replacing all OpenAI narrative paths with the allowlist. Cover safe fallback first, then observations/manual recall, then supported ACT/radio contributors.
3. **Wire exact acknowledgements and rollout gates**. Preview in shadow, then actively enrich requested turns under the explicit gate.
4. **Run the existing companion/native/build matrix and targeted GTA acceptance**. Record source, payload hash, configuration and whether each gate was observed. Existing historical test totals are not fresh validation of PS4.

Required acceptance cases for that implementation:

| Case | Required evidence |
| --- | --- |
| Visible injury versus heard gunshot versus behind-wall/unseen outcome | Request contains only that actor's qualified claims; heard sound never becomes identified shooter/death. |
| Promoted and ordinary observers; two actors with different knowledge | Exact actor join; no promotion/session fabrication; one actor's facts never appear in the other's request. |
| Backend-known but unrecognized participant | Anonymous description; no other profile/private memory/relationship donated. |
| Authored canon, selected memories, relationship and exact trait tags | Existing canon precedence and pin priority preserved; real character view changes salience. Unparsed prose is not a policy tag. |
| Four or more selected memories; large multilingual profile/history | Documented deterministic exclusions, valid Unicode, measured UTF-8 total/lane bounds, no canon duplication and safety reserve honored. |
| Delayed STT/model, editor edit, new event/revision, provider retry | Frozen input/revision stays stable; newer knowledge waits for next turn. |
| Supersession, handle reuse, retirement, reconnect and world reset | Stale frames/joins fail closed; no successor receives old facts or acknowledgement. |
| Typed, mic, internal/special, nonstreaming, streaming and early TTS | Same projection seam; current input once, committed history only, special events do not become fake player speech. |
| Hidden canaries injected into every raw ingress | Absent from captured final request, including generated system text, actor/listener/world/integrations, contextText and internal event. |
| Existing Essential actions and changed P/V targets | Capability declarations remain valid; P0/time-of-use fences still reject rebound targets; one action dispatch. |
| Failed request/projection/storage, stale decision key, retry | Safe basic context; correct exact-key consumer outcome; no false delivery or response-entitlement consumption. |
| Shadow/off, active PS4 and stock Gemini | Shadow has no delivery/effects; active enriches an existing turn; Gemini route/lifecycle regression passes. |
| Radio stop/song change/wrong station/unknown ID; ACT acceptance versus completion | Contributions expire/qualify correctly; no guessed song, fabricated preference or false arrival/completion. |

For conversational benefit, inspect the actual request and run the paired GTA prompts: ask one NPC about an event it witnessed and another about the same event it could only hear or did not witness; ask a promoted actor a question relevant to a selected manual memory. A useful, appropriately qualified reply is behavioral evidence; a request hash/counter proves wiring only. Preserve the existing successful PlaybackEnded history rule throughout.

## 8. Validation performed for this update

- Fresh main/branch/PR inspection and exact commit ancestry checks; PR #16 and ACT0–ACT2 are in audited main. Radio v2 is five commits ahead and unmerged.
- Existing `node tools/runTests.mjs` on audited main: **407 passed, 0 failed, 0 skipped**. An initial sandboxed run hit loopback/filesystem permission errors; the permitted rerun passed. This is current-main companion regression evidence, not PS4 or GTA validation.
- Existing corpus validator before changes: **37 documents, 17 decisions, 15 contracts; 12 entry/domain documents checked**, all valid. After indexing this update: **38 documents**, same decision/contract totals and 12 checked navigation documents, all valid. Documentation whitespace and pinned source-path/line references were also checked.
- No runtime implementation, provider call, build/deployment or GTA acceptance was performed by this update. Remaining checkboxes above are intentionally open.

The next work is implementation of the already settled C-04 contract and its concrete joins, projection and consumers. The research already describes the architecture; the production request still needs to use it.

[corpus]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/research/README.md
[decisions]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/research/DECISIONS.md
[contracts]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/research/system-contract-register.md#c-04-turnknowledgeframe-single-knowledge-assembler
[convergence]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/research/system-convergence-architecture.md
[roadmap-act]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/ROADMAP.md#act0--contracts-registry-and-metadata
[roadmap-ps]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/ROADMAP.md#L375
[act01-status]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/ACT0-ACT1-status.md
[act2-status]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/ACT2-status.md
[ps3-status]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/docs/PS3-deterministic-salience-status.md#bounds
[bootstrap]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/bootstrap.mjs#L94
[shadow]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/shadowRuntime.mjs#L119
[connection]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/openai/openaiConnection.mjs#L56
[character-service]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/characterService.mjs#L60
[profiles]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/sessionProfiles.mjs#L68
[profile-store]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/characters/profileStore.mjs#L137
[history]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/memory/dialogueHistory.mjs#L61
[decide]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/openai/decide.mjs#L14
[request]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/context/essentialDecision.mjs#L53
[anchors]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/intelligence/EntityAnchors.cs#L42
[enrich]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/PromotedCharactersIntegration.cs#L286
[salience-situation]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/salienceEngine.mjs#L126
[salience-order]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/salienceEngine.mjs#L341
[salience-ack]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/perception/salienceEngine.mjs#L359
[act-owner]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/native/promoted-characters/ActivityDispatch.cs#L145
[activity-facts]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/src/activities/activityFacts.mjs#L11
[build-hook]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/7e54b17b53f2786f3e9294e546db6b560fb5f6a7/lsa-essential-e1-candidate/tools/buildCandidate.mjs#L108
[radio-v2]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/tree/ad6cad61a0108f40e9ed2e738be756c63ab05350
[radio-projector]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/ad6cad61a0108f40e9ed2e738be756c63ab05350/lsa-essential-e1-candidate/src/perception/radioContextProjector.mjs#L62
[damage-update]: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/569ed9e14909400a8503adb105ae312d657c48d0/docs/research/damage-callback-delivery-20261006.md
