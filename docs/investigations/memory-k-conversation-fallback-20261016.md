# Memory K conversation reliability and safe fallback — source investigation

**Investigated:** 2026-10-16  
**Repository:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Integration baseline:** PR [#138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138), commit [`158c5884d0c6befc0bdc35539c952ea9f5e06556`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/commit/158c5884d0c6befc0bdc35539c952ea9f5e06556)  
**Hotfix reviewed FIRST:** PR [#201](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/201), head [`65676470fbf30e26333ebefbe46aa815c7fb4266`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/commit/65676470fbf30e26333ebefbe46aa815c7fb4266), **open / not merged into #138** at audit time  
**Scope:** Player text and PTT/microphone foreground turns, Memory K M2, H1, H2/M4, M5, legacy WS6/M8, P2 SQLite, PS4 knowledge projection, and the OpenAI reasoning request. No code modified or GTA run in this investigation.

## 1. Question, objective, and evidence standard

**Question:** Can an optional Memory K failure deprive the player of Nathan's normal Luna response? Where, exactly, and which errors should instead degrade to a memory-free conversation?

**Target behavior:** If an *optional learned-memory* dependency fails before any irrevocable response, Nathan should still receive the player's speech/text, retain his *verified* character identity and system prompt, and answer through the normal Luna action/voice pipeline **without leaking revoked memories or claiming nonexistent memories/commits**. This is not a mandate to answer when STT failed, the player provided no audio, the session was superseded, the NPC's actual identity is unverified, or privacy revocation makes already-sent content unsafe.

Evidence classification:
- **Confirmed in source:** Explicit throw/abort or synchronous check with a traceable path to terminal failure. Does **not** imply it happened in a particular GTA session.
- **Reported live:** PR #201 describes six `player_mic` sent requests cancelled with `knowledge_request_stale` / `memory_stale` at `watch` after STT and HTTP admission. This report was inspected **via PR description**, not independently reproduced from its underlying raw log archive here.
- **Potential:** Real code path but a runtime configuration, timing, or input is required; no live incidence established.
- **Intentional safety gate:** Should not be replaced by an unconditional fallback.

## 2. Actual foreground pipeline and failure boundary

For both player text and microphone turns:

1. `OpenAIConnection.beginTurn()` captures actor/target, identity, character, knowledge inputs; microphone capture is started separately.
2. `endRealtimeInput()` rejects absent PCM; launch then calls `runSequentialTurn()`.
3. `runSequentialTurn()` calls `host.prepareTurn()` **before STT**. `OpenAIConnection.prepareIdentity()` calls `runtime.waitForMemorySource()` ahead of `identityService.prepare()`.
4. Only then does microphone input go to STT (`transcribe`) and get its accepted transcript. Typed text already exists.
5. Player RAM input is committed, original accepted-input proof minted, and M2 durable SQLite capture *awaited* if configured.
6. If the durable receipt exists, optional H1 history, H2/M4 factual recall, M5 commands, and legacy features are prepared.
7. `finalizeKnowledgeFrame()` builds the PS4 model-facing context and `createKnowledgeDelivery`; it may choose the baseline, memory frame, or optional perception frame.
8. `prepareAsync()` checks evidence. `watch()` installs invalidation callbacks. A model attempt calls `prepareAsync()` again.
9. Non-streamed `requestJson()` or streaming request verifies **the already-composed body** (`verifyBeforeRequest`), invokes `beforeRequest`, then starts the HTTP fetch.
10. On successful Luna output, knowledge delivery checks again. The runner validates actions, synthesizes TTS, sends audio, and awaits native playback acknowledgement.
11. Any unhandled error/abort reaches the common `runSequentialTurn` catch: discards the assistant result, signals `host.failTurn`, marks terminal, and **does not retry with the baseline prompt**.

Sources: [connection turn/launch](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/openaiConnection.mjs#L289-L380), [preparation before STT](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L199-L275), [model request and terminal catch](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L393-L397), [failure cleanup](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L497-L529), [HTTP boundary](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/request.mjs#L32-L71), [streaming boundary](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/streamDecision.mjs#L39-L52).

**Critical architectural point:** Ordinary Memory K *read failures are often caught*, but admission, final prompt assembly, request validity and identity preparation are not universally fail-open. An exception or controller abort at those boundaries terminates the whole turn.

## 3. Findings and source-of-truth paths

### F01 — Native memory-source wait can reject a turn before STT (P0; confirmed)

- **Source:** [`essentialGlue.mjs`, `waitForMemorySource`, lines 550–570](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs#L550-L570); [`waitForMemorySource.mjs`, lines 1–13](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/memory/waitForMemorySource.mjs#L1-L13); [`openaiConnection.mjs`, lines 348–357](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/openaiConnection.mjs#L348-L357).
- **Exact condition:** A captured promoted profile, `memory.dialogue.player` activation on, an intelligence runtime, and a confirmed timeline lead to an awaited native owner/lease readiness check. `waitForMemorySource` polls up to `min(5000 ms, remaining turn deadline)`. On failure it throws `memory_source_unavailable`.
- **Effect:** The throw leaves `prepareTurn()` before STT and goes to terminal error; **not** a plain memory-absent Luna request. A user may mistakenly think microphone capture was not detected, even though capture might have completed.
- **Proposal:** Differentiate *missing optional memory write proof* from *missing actual NPC identity*. On the former, set memory source unavailable and proceed with STT and a sanitized non-memory frame. On the latter, preserve identity-safe refusal. Emit `memory_bypass` (stage `pre_stt`, reason `native_memory_source_timeout`) and `input_ready`/`stt_started` separately.

### F02 — Global SQLite change fence is broader than relevant memory (P0; confirmed root cause; PR #201 **partially addresses**)

- **Source:** [`sqliteFoundation.mjs` `readFence`, lines 215–220](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-shared-brain/src/characters/sqliteFoundation.mjs#L215-L220), [`sqliteProfileStore.mjs` `memoryReadFence`, lines 37–41](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-shared-brain/src/characters/sqliteProfileStore.mjs#L37-L41); consumers: [H1](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/memory/h1ConversationHistory.mjs#L149-L173), [H2](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/memory/h2FactualRecall.mjs#L231-L275), [M5](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/memory/m5IndependentCommands.mjs#L87-L107).
- `readFence` includes connection-level `SELECT total_changes()` and SQLite `PRAGMA data_version`, plus host authority generation. Writes unrelated to the evidence used by this model turn can invalidate it.
- **Before PR #201:** `sendCurrent()` depends on equality with that strict fence, including **after request submission**. The PR #201 author links this to six live `watch/memory_stale` cancellations after successful STT and HTTP admission.
- **After PR #201 (proposed, not merged):** strict validation is retained before sending; an alternate in-flight fence avoids cancellation from *ordinary same-connection SQLite writes*, while preserving privacy/source/global-profile invalidations.
- **Still open:** A benign mutation before request or during a retry can still trip a strict read/verification check. Also audit *every* mutation path to ensure an in-flight change that actually alters admitted recalled material triggers a monitored privacy/source generation.
- **Proposal:** Merge PR #201 only after checking all writer classifications, live-relevant H1/H2/M5/M8 tests, and its CI. Do not simply disable all send fences.

### F03 — Post-send watcher and success gate abort instead of degrading (P0; confirmed, partly intentional)

- **Source:** [`knowledgeDelivery.mjs`, `currentReason`, `watch`, `prepare`, `verifyBeforeRequest`, `beforeRequest`, `success`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/context/knowledgeDelivery.mjs#L13-L86), wired in [`essentialGlue.mjs` lines 456–477](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs#L456-L477); [runner installs watcher](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L270-L275).
- Any stale `memoryStamp`, recall/opinion references, PS4 perception input, host state, or frame revision may cause a `knowledge_request_stale` error. `watch()` cancels **after `sent===true`**, `success()` rejects results that became stale, and no normal Luna baseline retry exists in the terminal catch.
- **Necessary:** If a real forget/correction/purge or identity revocation occurred after the prompt was sent, do not deliver a now-unsafe answer. Never replay an already-sent or partly spoken response.
- **Unnecessary:** Treating all internal SQL churn as if it revoked the relevant evidence (PR #201's main fix).
- **Proposal:** Classify invalidation reasons; let *benign in-flight writes* pass only with verified safety, and add a separately reviewed fresh-request recovery **only if no audio/action was committed and all old memory-bearing input is discarded**.

### F04 — Single combined gate invalidates H1 + H2 + M5 (P1; confirmed; missing partial degradation)

- **Source:** [`independentForegroundMemory.mjs` lines 1–54](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/memory/independentForegroundMemory.mjs#L1-L54).
- H1, H2 and M5 prepare independently and may be absent. Once combined, `verifyPrepared()` verifies all admitted contributors; one failed check latches `invalidated=true` for the combined prepared object.
- **Effect:** A bad H2 read can discard otherwise valid H1; a failed M5 durability check can poison optional history/recall. Before request admission, a safe reduced frame would be preferable. After admission, already-sent proof must not be reinterpreted casually.
- **Nuance:** A stale M5 *success* must never be advertised as a durable commit. Fallback is **no claim / explicit uncertainty**, not "saved" or "forgotten".
- **Proposal:** Pre-send independently suppress the failed contributors, reassemble from presently verified inputs once (bounded); do not preserve a stale composite stamp. Stop and explicitly report source invalidation if no safe source remains.

### F05 — Final verification happens after body construction and throws (P1; confirmed)

- **Source:** [`knowledgeDelivery.mjs` lines 31–77](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/context/knowledgeDelivery.mjs#L31-L77), [`request.mjs` lines 43–51](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/request.mjs#L43-L51), [streaming counterpart](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/streamDecision.mjs#L43-L51).
- `prepare()` can sometimes prune stale memory **before** send. But `verifyBeforeRequest()` explicitly says the body is already composed and must not be silently pruned; a failed final check throws and kills the turn.
- **Effect:** There is no controlled "discard composed request, rebuild without learned memories, verify again, then send" transition.
- **Proposal:** A **single pre-HTTP** reconstruct-and-verify fallback owned by the runner/provider request builder (not silent mutation of an already serialized body); identical protection in structured streaming and non-streaming.

### F06 — Optional memory consumes the same deadline as STT / model / TTS (P1; confirmed waits; impact requires timing test)

- **Source:** [`runSequentialTurn.mjs` deadline lines 90–96, M2 and memory awaits lines 230–275](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L90-L96), [M2 append/join](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs#L169-L234), [P2 writer queue](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-shared-brain/src/characters/sqliteProfileStore.mjs#L108-L115).
- `recordM2Player()` and `prepareLiveTurnMemory()` are awaited. Errors are largely caught, **but waiting for them is not free**. The provider-work deadline begins before identity, memory source, STT and those reads. The `waitForMemorySource()` ceiling alone is up to five seconds.
- **Effect:** A memory stall can exhaust budget before Luna/TTS has meaningful time. This is a plausible cause of silence even when no `knowledge_request_stale` is thrown; **not proven** without timing telemetry.
- **Proposal:** Measure durations at each stage, bound *optional* foreground memory to a small slice of remaining time, and continue cleanly when that budget expires. Do not time out/drop a write after it has been permitted to make a durable privacy change; wait for a verifiable outcome before reporting success.

### F07 — PS4 initial context render is not universally exception-isolated (P1; potential)

- **Source:** [`essentialGlue.mjs` `finalizeKnowledgeFrame`, lines 383–450](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs#L383-L450), [`knowledgeRenderer.mjs` frame/budget checks](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/context/knowledgeRenderer.mjs#L75-L196).
- The initial `base=renderKnowledge(...)` and optional `memoryBase=renderKnowledge(...)` are **not** enclosed in a protective catch, although later optional perception preview rendering is. `renderKnowledge` has legitimate byte/input limit exceptions.
- **Effect:** An unexpected learned-memory/profile/context projection problem could propagate out of `finalizeKnowledgeFrame` and fail the turn. Some exceptions (e.g. an oversized *current user message*) are not memory-caused and must not be misclassified or hidden.
- **Proposal:** Isolate the optional memory-rendering step. If it fails, render one sanitized base frame retaining only permitted context and a verified identity. Record the precise *stage* and coarse reason, but never text. Preserve normal rejection for non-memory-invalid input or corrupt core contracts.

### F08 — Promoted-persona identity proof can reject the turn (P0 for reliability, **safety guard to preserve**)

- **Source:** [`openaiConnection.mjs` `prepareIdentity`, lines 349–371](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/openaiConnection.mjs#L349-L371), [`characterService.mjs` `prepareTurn`, lines 93–127](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/characters/characterService.mjs#L93-L127).
- A known authored NPC whose persistent identity cannot be resolved triggers `identity_unavailable`, intentionally preventing the system from substituting a generated persona.
- **Effect:** Nathan might not respond, but this is **not just optional memory failing** and cannot safely be bypassed by asking Luna to impersonate Nathan.
- **Proposal:** Separate diagnostics (`character_identity_unavailable` versus `memory_source_unavailable`); only allow fallback after the *same promoted NPC* has been freshly verified. Optional profile projection exceptions are already handled conservatively.

### F09 — User-initiated pause revokes in-progress generations (intentional; preserve)

- **Source:** [`learnedMemoryPause.mjs` lines 31–37](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/memory/learnedMemoryPause.mjs#L31-L37), [`essentialGlue.mjs` `pauseLearnedMemory`, lines 714–725](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs#L714-L725).
- Pausing learned memory explicitly aborts active matching turns, including potential in-flight requests. An aborted response with learned memory must **not** be resurrected after pause. New turns can be memory-free after the previous work has been retired.
- **Proposal:** No blind retry inside the revoked generation.

### F10 — STT/PTT, transport, TTS, native playback can fail independently (not Memory K)

- **Source:** [`openaiConnection.mjs` microphone checks, lines 178–225](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/openaiConnection.mjs#L178-L225), [`runSequentialTurn.mjs` terminal mapping, lines 7–49](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L7-L49), [TTS/authorization/playback](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L310-L490).
- No PCM, mic overflow, empty transcript, STT service error, bad Luna decision, TTS failure, audio authorization rejection, and player-superseded turn are **different root causes**. A memory fallback does not solve them. UX4 selection/input routing is upstream of most of this and was **not audited here**.
- **Proposal:** Use separate telemetry for `mic_open`, `pcm_bytes`, `stt_success`, `memory_preflight`, `model_sent`, `tts_first_pcm`, `native_playback`. Do not attribute all missed replies to Memory K.

## 4. PR #201 assessment — fixes, incomplete coverage, risks

**PR #201 reviewed before this write-up**, still open and unmerged into PR #138 when checked. Its change is **not equivalent to universal fallback**:

| PR #201 change | Confirmed code behavior | Audit judgement |
| --- | --- | --- |
| New `memoryRequestFence` in P2 store | Combines host authority generation, **global** P2 profile snapshot revision, explicit privacy mutation generation, and SQLite `PRAGMA data_version` for external writers. Strict `memoryReadFence` still exists. | Good targeted distinction for ordinary same-connection writes while HTTP request is already admitted. |
| `memoryCurrent(stamp,{requestSent})` in PS4 | Uses `sendCurrent()` before HTTP admission, `sendCurrentInFlight()` when `sent` is true. | Addresses main H1 in-flight false-cancellation route. |
| H1/H2/M5 and legacy WS6 additions | Expose in-flight current check and bounded invalidation reason. Combined H1/H2/M5 uses all contributors. | Sensible interfaces; need real multi-capability coverage. |
| `memoryCause` telemetry | Allowlisted cause values, not raw memory text, IDs, or fence values. | Useful and privacy-aware. |
| Two new tests (`memoryRequestFence.test.mjs`) | A typed H1 turn survives a same-connection no-op SQL UPDATE; a typed H1 turn is cancelled after an actual `commitCommand('forget')`. | Correct narrow regression direction; **not** full mic/streaming/M8/H2/M5 coverage. |
| CI | GitHub Actions runs were still mostly **queued or in progress** when first checked; no all-green conclusion. | Do not treat PR as release- or GTA-validated. |

**Open review questions to resolve before integrating #201:**

1. **Legacy M8 opinion gate remains strict after send.** [`liveTurnMemory.mjs` on #201, `opinionCurrent`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/65676470fbf30e26333ebefbe46aa815c7fb4266/lsa-essential-e1-candidate/src/memory/liveTurnMemory.mjs#L163-L175) still delegates to strict `sendCurrent()`. [`knowledgeDelivery.currentReason`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/65676470fbf30e26333ebefbe46aa815c7fb4266/lsa-essential-e1-candidate/src/context/knowledgeDelivery.mjs#L13-L16) separately evaluates opinion freshness after the relaxed `memoryCurrent` check. **Conditional risk:** if an admitted legacy M8 opinion is present, unrelated SQL churn can still trigger `opinion_stale`. Prove with an M8-on case before labeling this fully solved.
2. **Retries after admission still rerun strict `verifyPrepared`.** [`runSequentialTurn.mjs` provider attempt preparation](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs#L99-L119) and [`knowledgeDelivery.verifyBeforeRequest`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/65676470fbf30e26333ebefbe46aa815c7fb4266/lsa-essential-e1-candidate/src/context/knowledgeDelivery.mjs#L31-L43) can revalidate the strict fence on a model retry. Check that benign writes between attempts cannot still end the turn, without permitting a materially modified body to be resent.
3. **Mutation-completeness audit needed for privacy fence.** [`sqliteProfileStore.mjs` on #201](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/65676470fbf30e26333ebefbe46aa815c7fb4266/lsa-shared-brain/src/characters/sqliteProfileStore.mjs#L374-L393) makes generic `withP2SqliteTransaction()` default `privacyMutating=false`, and increments privacy generation for `withTimelineSqliteWrite()` plus `commitCommand()`. Audit all privileged memory deletion, correction, restore, suppression, curation and inspector paths: any same-connection path that changes already-admitted evidence **without** incrementing privacy generation would become invisible to the relaxed in-flight fence. This is a *required proof obligation*, not a claim that such a bypass has been observed. The inspector currently routes through M5 services ([`inspectorAdministration.mjs`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/158c5884d0c6befc0bdc35539c952ea9f5e06556/lsa-essential-e1-candidate/src/memory/inspectorAdministration.mjs#L11-L53)).
4. **The new benign-write test is intentionally narrow.** It uses `UPDATE dialogue_journal SET content=content`, ensuring the data is unchanged. Add one authentic unrelated M3/M6 write, a privacy-changing M5 restore/correction, and one counterexample that really mutates an admitted source through a supported API.
5. **No pre-STT fix or fallback in #201.** It changes in-flight request validity, not `waitForMemorySource`, awaited M2 capture, PS4 rendering, identity rules or the terminal runner.
6. **Overbroad false cancels remain possible.** Global `snapshot.revision` and global `privacyGeneration` can cancel Nathan due to a different NPC's privileged edit. Conservative privacy is appropriate until scoped proof is available; classify it rather than immediately weakening it.

**PR #201 source links:** [full patch/PR](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/201/files), [new fence/diagnostics](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/65676470fbf30e26333ebefbe46aa815c7fb4266/lsa-shared-brain/src/characters/sqliteProfileStore.mjs#L40-L65), [two regression tests](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/65676470fbf30e26333ebefbe46aa815c7fb4266/lsa-essential-e1-candidate/tests/memory/memoryRequestFence.test.mjs).

## 5. Safety contract for any "just ask Luna normally" fallback

A fallback must preserve these invariants:

- **Keep the player input, not stale knowledge.** Use only the final accepted typed input or STT transcript and a *new* sanitized model allocation; do not forward the previous request body, learned-memory lanes, unverifiable facts, obsolete M8 opinion, or source receipts.
- **Preserve the genuine Nathan identity.** The correct, verified promoted NPC, profile persona and voice may remain. Do not substitute a different or fabricated NPC because profile/native ownership is unavailable. Distinguish authored canon from learned/suppressed material; respect privacy pause.
- **Never claim a durable memory command succeeded without verified commit.** Memory operations are not silently replayable model calls; retrying must not perform the same side effect twice.
- **Before HTTP submission:** one bounded fallback that rebuilds the complete model body from verified inputs and verifies it again. This is where fail-open is most feasible.
- **After HTTP submission but before audio/action:** unrelated writes should not invalidate a valid request (PR #201's purpose); for actual forget/correction/owner change, stop stale delivery. Any *new* memory-free Luna request requires its own authorization, complete context re-creation and one-generation/once-only semantics; implement separately.
- **After action/audio begins:** no automatic replay or second voice line; honor native cancellation and delivery ledger. If the player interrupts, starts a new conversation, or pauses memory, retire the old turn.
- **Never convert provider outages or absent mic input into "memory failed."** A fallback to the *same* unavailable Luna/STT/TTS service cannot solve those failures.
- **Retain existing privacy source checks on writes and reads.** A "best effort" storage write may fail silently, but it must not introduce deleted memories via RAM conversation history or report a false confirmation.

## 6. Proposed minimal, staged implementation

**Slice A — Hotfix verification, highest urgency (PR #201).**
- Check all CI; review fence propagation H1/H2/M5 and conditional legacy M8, retry semantics, scoped/untracked privacy mutation paths.
- Keep strict pre-send fence and real forget/source revocation cancellation.
- Add a small number of targeted regressions (normal M3 write, H2/M5, M8-on if enabled, and a real privacy correction).
- **Do not merge merely because the two H1 tests pass.**

**Slice B — Fail-open before model request (new small runtime PR).**
- Replace `memory_source_unavailable` from optional M2 source readiness with `memory.disabledForTurn` only where verified P1/Nathan identity still exists; **do not skip identity verification**.
- Put one bounded `buildSanitizedNoLearnedMemoryFrame()` behind the PS4 assembler. If memory preparation, source, or optional memory render fails, rebuild and continue to Luna, not directly to `host.failTurn`.
- Reverify the *entire rebuilt body* before fetch; both JSON and streaming variants. Emit `memory_fallback` with allowlisted reason, stage and whether HTTP was sent, without text/IDs/fences. Keep `turnDeadlineMs` and not another unbounded retry.

**Slice C — Deadline and contributor isolation (follow-on PR).**
- Add coarse timings for memory wait, M2 durable append, H1/H2/M5 prep, final validation, request admission, first PCM.
- Budget optional memory work against remaining deadline; avoid starving STT/Luna/TTS. Ensure already-admitted privacy writes aren't cancelled halfway and then falsely reported.
- Permit H1-only or H2-only verified frames when another optional consumer is unavailable **before** request admission; never reuse unverified partial snapshots.
- Address optional M8/post-send retry interactions verified in Slice A.

**Defer:** Automatic second Luna HTTP request after a real post-send privacy revocation, or after any speech chunk/action started, until explicit authority and no-replay design is proven. It is not the prerequisite to making typical normal chats reliable.

## 7. Minimal regression/acceptance matrix

No broad new test suite necessary. Use focused existing original-runner/P2 SQLite harnesses and one live GTA confirmation.

| Scenario | Required outcome |
| --- | --- |
| PTT has real PCM, M2 native memory source never ready, Nathan's P1 owner still valid | STT runs and a single memory-free Luna reply can complete; log bypass reason. |
| No PCM / empty STT | Existing input failure, **not** a fabricated Luna answer. |
| M2 capture or H1/H2 preparation unavailable | No memory contribution, but normal action/TTS turn completes; no fake memory claim. |
| Unrelated M3/M6 same-connection write after HTTP admission | Valid response completes (PR #201). |
| Genuine forget/correction or verified-owner revocation after HTTP admission | Old memory-bearing request cancelled; no stale speech, no automatic replay. |
| H1 ready, H2 fails before HTTP admission | Explicitly verified H1 may be used, or sanitized no-memory body completes. |
| M5 save/forget fails or readback unavailable | Do not claim success; normal dialogue or an honest failure response if identity/current input valid. |
| M8-on in-flight unrelated write | No false `opinion_stale` cancellation; genuine opinion source revocation remains blocked. |
| Retry after benign write versus changed request body | No unnecessary cancellation, but no different/revoked body resubmitted under previous request hash. |
| Model stream already spoke/issued native action, then privacy revocation | Stop unsafe output; never duplicate voice/action; original ledger outcome remains accurate. |

**Live diagnosis:** On a new native test build, pair one microphone and one typed turn with the same question. Compare `capture_started/capture_stopped/input_ready`, STT admission/outcome, `memory_*` diagnostics, `knowledge_request_stale` (reason, stage, `requestGatePassed`, `memoryCause`), Luna HTTP send, TTS first PCM, and native playback. This separates UX4/PTT routing, Memory K, provider failures and playback. The PR #201 description's six late-session cancellations are **not** proof that *all* missed replies had that cause.

## 8. Done criteria and investigation boundaries

1. Every optional-memory failure **before first Luna HTTP request** results in either (a) one verified, sanitized no-memory request, or (b) an explicit, classified core/identity/input failure. No silent indefinite wait.
2. PR #201's benign-write test and genuine-forget rejection both pass, plus scoped H2/M5/M8 and retry checks where activated.
3. Suppression, correction, privacy pause, session supersession, owner revocation, and partial speech never leak or replay obsolete memory.
4. Telemetry distinguishes mic/STT vs memory vs provider/TTS/native and labels intentional privacy stops; no private text/IDs/full prompts in diagnostics.
5. CI and live GTA validation are reported separately. **This document and its PR are documentation-only; they do not establish CI green or an actual GTA fix.**

**Audit limitations:** This was a static examination of the pinned GitHub code plus PR #201 metadata/diff and initial CI state. No raw October 16 log archive was independently re-parsed in this document, no tests were run by this investigation, and no GTA install was changed. Config-gated issues and timing interactions need instrumented verification. See links to exact pinned commits above rather than relying on moving branch line numbers.
