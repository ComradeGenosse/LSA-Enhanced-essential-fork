# E2/E3 implementation plan

Prepared October 1, 2026 from the E2/E3 goals, plan review, and the current repository source.

Repository: [ComradeGenosse/LSA-Enhanced-essential-fork](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork). Inspected baseline: `888d9fbff3fb79dee7e1e9b85b746d1b44c9bc51`.

This document supersedes the earlier E2/E3 implementation instructions. The goals remain unchanged. E2/E3 is not implemented yet; this request produces a plan only.

## 1. Outcome and fixed boundaries

E2 introduces separate reasoning, transcription, and speech providers, stable session voice profiles, and optional bounded acting guidance. E3 introduces one conservative retry around eligible provider operations within the original deadline.

Preserve these owners and behaviors:

- Essential allocates and validates `pedId`, `turnId`, `generationId`, and `sessionNonce`; performs stock action dispatch; authorizes native playback; and reports interruption/completion.
- E1.1 adapts provider output to that lifecycle. Only a matching successful `PlaybackEnded` permits assistant-history commit.
- Accepted player text/transcripts remain durable. `special_event` remains internal context.
- Stock Gemini retains its existing transport, ownership, audio, resume, and action behavior.
- No whole-turn retries, automatic provider fallback, native generation replacement, action replay, permanent NPC identity, voice cloning, or streaming redesign.
- Builds/tests remain offline and isolated from GTA. Live API execution and deployment/launch require their respective explicit instructions.

Keep `src/integration/nativeDelivery.mjs` unchanged unless a documented interface defect makes a minimal adaptation unavoidable. Do not alter the old/custom LSA 2.1 project or active game installation.

## 2. What the source actually does

Paths in this document are relative to `lsa-essential-e1-candidate/` unless stated otherwise.

| Responsibility | Existing implementation |
| --- | --- |
| Runtime construction/service injection | `src/integration/essentialGlue.mjs`: `createRuntime()` |
| Session lifecycle, input snapshots, supersession | `src/openai/openaiConnection.mjs`: `OpenAIConnection` |
| Sequential turn/provider deadline/history/publication | `src/openai/runSequentialTurn.mjs` |
| Reasoning request and strict JSON parsing | `src/openai/decide.mjs`, `src/context/essentialDecision.mjs` |
| Stock role/capability/action validation | `src/context/decisionValidator.mjs` and existing native bridge |
| STT WAV upload | `src/openai/transcribe.mjs`: `transcribePcm()` |
| TTS PCM framing | `src/openai/speak.mjs`: `speak()` |
| Single-request JSON/audio HTTP helpers | `src/openai/request.mjs` |
| Native acknowledgement observation | `src/integration/nativeDelivery.mjs` |
| Source-pinned stock adapter hooks/build | `tools/buildCandidate.mjs`, `patches/essential-hooks.json` |
| Configuration | `src/config/e1Config.mjs`, `e1.config.example.json` |
| Telemetry and reports | `src/observability/*.mjs`, `tools/summarizeRun.mjs` |

Current order:

```text
runSequentialTurn starts its provider-work timer
  -> STT for microphone input
  -> accept input transcript; commit player input once
  -> reasoning; parse strict decision
  -> stock decision validation
  -> stage assistant history
  -> emit stock output_transcript, including any validated action
  -> TTS request
  -> first usable onPcm callback requests native authorization once
  -> await matching acceptance; hand tagged PCM to native
  -> generation_complete; one required native stream-end handoff
  -> clear provider timer; wait under separate playback watchdog
  -> matching successful PlaybackEnded commits assistant history
```

The import verification recorded **106 passing offline tests**, zero failures/cancellations/skips, and a passing pinned build. Repeat the baseline at implementation start rather than assuming the count or inspected commit is still current.

### Retry consequence of this order

`output_transcript` reaches the stock action handler before TTS. Therefore:

- Dialogue-only turns may retry TTS before its first usable PCM callback, while no other effect has started.
- For `validated.actionCount > 0`, close retry eligibility immediately before routing `output_transcript`. Conservatively treat even final-only actions such as RequestBackup as action-bearing from this point; do not infer that delayed dispatch makes replay safe.
- Close TTS retry eligibility immediately before the first usable PCM callback enters native authorization, not after that callback succeeds. Rejection, timeout, or a throwing consumer cannot reopen eligibility.
- Ordinary transcript publication and durable player-history acceptance do not authorize replay of those publications. Later provider requests may retry only inside their own unpublished stage boundary.

Do not move stock actions, authorization, or history staging to manufacture a retry opportunity. If lifecycle ordering changes later, review this effect matrix again.

## 3. Delivery sequence

Implement E2 first and freeze a passing offline checkpoint. Then implement E3 in small commits. Keep API/GTA validation as separately recorded release gates; deferred external checks do not block independent offline implementation and never count as passes.

### Step 0 — Verify the baseline

1. Inspect repository instructions, current commit, working changes, and the actual modules listed above. Preserve unrelated edits.
2. Run `node tools/runTests.mjs` and `node tools/buildCandidate.mjs` from the candidate directory. Record results, stock/native fingerprints, and Node version.
3. Confirm the action/authorization ordering above against the current stock harness and native bridge. Record any deviation before implementation.
4. Confirm service injection, session bind/close semantics, and current error/telemetry contracts.

Exit gate: an identified clean baseline or documented pre-existing edits, passing baseline regressions, and a written side-effect map. Investigate baseline failures before changing behavior.

### E2A — Introduce provider seams without behavior changes

Add:

```text
src/providers/providerContract.mjs
src/providers/providerStack.mjs
src/providers/openai/reasoningProvider.mjs
src/providers/openai/transcriptionProvider.mjs
src/providers/openai/speechProvider.mjs
tests/provider-contract.test.mjs
```

Wrap the existing OpenAI functions; preserve their request construction and existing injected `fetchImpl`. Construct one provider stack in `createRuntime()` for the OpenAI route. Preserve the `services.decide/transcribe/speak` seam used by the sequential runner and existing test doubles.

Define explicit provider identity and capabilities, plus these result contracts:

| Provider operation | Result |
| --- | --- |
| Reasoning `decide()` | Existing strictly parsed Luna decision, with its unchanged dialogue/command schema |
| Transcription `transcribe()` | Existing accepted transcript string |
| Speech `synthesize()` | Existing `{ bytes, chunks, discardedTrailingByte, sampleRate, channels }` audio result |

The native stock validator remains outside reasoning. A strictly parsed decision is not yet a role/capability-authorized GTA action. Providers never publish native events, allocate identities, stage/commit history, authorize audio, or dispatch actions.

Pass explicit immutable identity/input snapshots. Declare model-compatible voice/instruction/speed capabilities, input limits, cancellation/reader cleanup, and awaited PCM callbacks. PCM stays headerless signed little-endian PCM16, mono, 24kHz.

Keep top-level `config.provider` as the existing `openai` versus stock `gemini` switch. Do not instantiate the OpenAI stack, require its capabilities, or migrate Gemini into these interfaces when the selected route is Gemini. Additional provider implementations are out of scope.

Exit gate: unchanged legacy request/output behavior; baseline suite passes; unknown OpenAI-stage configurations fail clearly; Gemini regressions pass.

### E2B — Resolve one immutable voice profile per native session

Add `src/voice/voiceProfile.mjs`, `src/voice/voiceResolver.mjs`, and `tests/voice-profile.test.mjs`. Modify `src/openai/openaiConnection.mjs`, `essentialGlue.mjs`, configuration, and the speech adapter.

Resolve after the first valid `beginTurn()` bind if constructor identity is incomplete; otherwise resolution may occur at construction. Store one frozen profile on the connection, reuse it for every turn, and copy its reference into the turn snapshot. Neither `refreshContext()` nor a later turn may reroll it.

Profile:

```js
{
  profileId,           // safe preset identifier/config digest, not native identity
  provider: 'openai',
  model,
  voice,
  speed,
  instructions,
  assignmentVersion: 1
}
```

Define a versioned hash of canonical, unambiguous `pedId + sessionNonce` bytes into an ordered voice pool. Exclude turn/generation/context from the key. Profiles live for that session only. Teardown for an old nonce cannot erase a replacement session's state.

Configuration migration:

- Missing/null `speechVoices` derives `[config.ttsVoice]`; preserve the currently configured voice rather than adding a nova override.
- An explicit pool must be non-empty, duplicate-free, and supported by the configured model.
- `voiceAssignment` is `deterministic-session`; `ttsSpeed` defaults to `1.0`.
- Freeze model, pool version, voice, speed, and instructions for active sessions. Changed settings apply to new sessions.
- A singleton pool preserves legacy sound. Demonstrating variety requires at least two supported voices. Hash collisions are expected; uniqueness for every NPC is not promised.

Exit gate: repeat turns/context refresh preserve the profile; independent sessions resolve deterministically; handle reuse/delayed close remain isolated; legacy voice settings work.

### E2C — Add bounded acting guidance

Extend the existing `speak()` request to accept the resolved profile. Preserve exact `input: decision.dialogue`; add model-supported `voice`, optional `speed`, and optional `instructions` fields. Preserve the existing awaited chunk framing and result shape.

Start with trusted templates limited to 512 Unicode code points: natural conversation, grounded delivery, emotion implied by the supplied dialogue, no announcer exaggeration, and no added/repeated/paraphrased wording. Do not interpolate raw world/player instructions or add emotion fields to Luna's decision schema.

`actingEnabled` defaults to false for request compatibility. Explicit acting configuration requires a model that supports instructions. Unsupported combinations fail clearly without silently changing the model. Validate finite speed against provider-supported bounds; the documented OpenAI range is 0.25–4.0.

Enforce exact text at the request boundary. Audible wording and performance are live quality checks, not deterministic guarantees. Preserve current odd-byte framing behavior, including the existing reported trailing-byte discard; changing that compatibility policy requires a separately documented defect and regression case. Do not split/truncate dialogue to bypass limits.

Exit gate: legacy TTS requests remain equivalent when acting is disabled; configured profiles reach synthesis; unsupported capabilities fail before requests; PCM/native lifecycle regressions pass.

### E2D — Freeze the E2 checkpoint

Run the full offline suite and pinned build. Add provider/config migration/profile/teardown/acting tests, update architecture and GTA smoke documentation, and commit the E2 checkpoint.

With separate live authorization, exercise existing API smoke plus at least two supported voices and acting-enabled speech; listen for stability and wording. With separate deployment/launch instruction, check repeated same-NPC turns, context refresh, two NPCs, and disconnect/reconnect in GTA.

Record each external gate as passed, failed, or deferred. E3 may begin after the passing offline checkpoint. Full E2 release acceptance requires the external gates to pass too.

### E3A — Define errors, attempts, and one executor

Add:

```text
src/reliability/errorClassifier.mjs
src/reliability/retryPolicy.mjs
src/reliability/abortableDelay.mjs
src/reliability/providerExecutor.mjs
tests/reliability.test.mjs
```

The runner owns exactly one executor wrapper around each raw provider request. Providers and HTTP helpers never retry themselves. The present transport uses injected fetch, not an OpenAI SDK; retain that simplicity and disable hidden retries if a client is introduced later.

Extend `ProviderRequestError` with bounded normalized metadata: category, operation, provider, HTTP status, allowlisted provider error code, and normalized Retry-After. Preserve existing public terminal reasons. Inspect error responses internally under a small byte/time cap (initially 16KiB); discard bodies and headers after extraction and never log them.

Handle the separate multipart STT fetch path as well as `requestJson/requestBytes`. Preserve cancellation/timeout provenance through JSON parsing. Preserve PCM consumer errors as consumer errors: the current generic audio catch must not turn a throwing native callback into a retryable network error.

Policy:

- At most two actual external requests per stage: one original and one retry.
- Allow temporary 408/429/500/502/503/504 and explicitly identified transient transport failures only while the boundary is open.
- Quota/billing/access errors, missing credentials, bad requests, refusals, invalid decisions/transcripts/responses, consumer failures, native rejection, stale/terminal jobs, and overall deadline expiry never retry.
- Inspect 429 provider codes/types; a status alone is insufficient. Unknown classification fails closed.
- Honor valid Retry-After as a minimum. Parse delta-seconds/HTTP-date safely; use bounded backoff with injected jitter when absent/invalid. Skip a retry if the server minimum exceeds the configured delay cap or remaining budget; never shorten it.

Give each attempt a local token/closed flag distinct from native identity. Compose a child signal from the original turn signal and optional attempt timeout. Close/abort the failed attempt before backoff. Guard all late results, PCM, and provider telemetry against the attempt token as well as the native generation. Cleanup cannot hang job retirement or replace the original failure.

Exit gate: request counts, classification, signal propagation, jitter/server-delay handling, late callbacks, and cleanup pass deterministic injected-clock/transport tests.

### E3B — Integrate the original shared deadline

In `runSequentialTurn()`, capture `deadlineAt = performance.now() + providerWorkDeadlineMs` at the existing provider-work start. The same deadline covers STT, reasoning, TTS, all attempts, backoff, native authorization, and native stream-end handoff; do not move the existing start/end boundaries.

Before starting an attempt or publishing output, verify the full identity, current generation, nonterminal job, root/attempt signals, attempt token, stage publication boundary, and remaining budget. Recheck after every await/backoff.

Pass only remaining time to reasoning/audio HTTP helpers; provide equivalent composed-signal timeout handling for STT/body reads. An optional attempt timeout may leave retry time; a full-budget attempt does not. Root cancellation, supersession, and total deadline expiry never become retryable attempt timeouts. A Promise race must also retire the attempt and suppress late output.

Keep the existing completion watchdog separate after stream-end; elapsed playback may exceed the provider deadline without triggering a provider retry.

Initial validated retry configuration:

```js
retry: {
  enabled: true,
  maxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 3000,
  honorRetryAfter: true,
  jitter: 'bounded',
  minAttemptBudgetMs: 1000,
  attemptTimeoutMs: null
}
```

Validate booleans, finite numeric bounds, attempt cap 1–2, and delay ordering. `enabled: false` or `maxAttempts: 1` means one request with the same guards/deadline. Treat timing defaults as initial values to validate, not latency guarantees. A valid server delay above 3000ms suppresses retry under this initial cap.

Exit gate: retries reduce later stage budgets; cancellation/backoff/body stalls are bounded; expired attempts cannot publish; playback watchdog behavior remains unchanged.

### E3C — Integrate STT and reasoning

Snapshot each operation's accepted inputs once. Reuse the same PCM bytes, context/history, source, configuration, and profile across its attempts. Keep copied binary inputs private and immutable by contract; do not attempt to freeze a nonempty typed array.

For STT, keep `input_transcript` publication and player-history acceptance outside the executor closure. For reasoning, keep stock validation, staging, `output_transcript`, action routing, and authorization outside it. Only one accepted final result leaves either executor.

Keep an empty/invalid successful transcript, refusal, or invalid parsed/native decision terminal. An automatic retry must not become semantic repair. Repeating an ambiguously failed provider request can incur extra remote work/cost; local publication guards do not guarantee exactly-once remote execution.

Exit gate: STT/model recovery, one transcript/history commit, no semantic retries, immutable inputs, and same-generation late-attempt suppression pass.

### E3D — Integrate TTS under the real effect boundary

Keep a monotonic turn-local retry-eligibility flag in the runner, informed only by accepted E1.1 state. Do not create a second native state machine.

1. Immediately before `output_transcript`, close eligibility if `validated.actionCount > 0`.
2. Wrap only the speech provider request. Native authorization, actions, generation/turn completion, and history changes stay outside the retry closure.
3. On the first usable PCM callback, verify attempt/current-turn guards and close eligibility synchronously before entering the existing authorization path.
4. Authorization remains once; a rejection, timeout, or throwing consumer is terminal. Once callback/native handoff starts, no speech retry is possible.
5. Empty chunks or incomplete sample carries alone do not start a native handoff. A fresh speech invocation gets fresh tail/counters; failed-attempt audio is never combined with retry audio.
6. Failure follows existing cleanup/discard semantics. It cannot undo an already executed action or synthesize a new stream/end event.

Exit gate: dialogue-only TTS transient failure before usable PCM can recover; action-bearing/authorization/partial-audio/consumer failures never retry; all lifecycle completion counts remain correct.

### E3E — Telemetry and reports

Extend both event/field allowlists and scalar validation, not just event names. Current filtering would otherwise discard new profile IDs, voice names, provider stage IDs, and retry reasons.

Add `voice_profile_assigned`, `speech_provider_selected`, `provider_retry_scheduled`, `provider_retry_started`, `provider_retry_recovered`, `provider_retry_exhausted`, and `provider_retry_skipped`.

Allow bounded profile/provider/voice identifiers, finite speed, attempt/maxAttempts, delay/remaining budget, normalized status/code, and enumerated skip reasons. Keep existing native identity correlation and telemetry schema compatibility; evolve the schema explicitly if a breaking change is unavoidable.

Expose counts by stage, recoveries, exhausted attempts, suppressed retries, added latency, and incomplete traces. Cancellation/deadline/nonretryable/side-effect suppression is not retry exhaustion. Count only attempts actually started. Stale attempts cannot publish normal usage/timing events after closure; any deliberate late-event diagnostic must use a bounded explicit event.

Never log instructions, dialogue, transcripts, prompts, audio, raw responses/errors/headers, keys, or endpoint URLs. Telemetry failure must remain unable to alter lifecycle behavior.

### E3F — Regression and release gates

Add focused provider retry tests and extend existing native lifecycle, stock controller, TTS/history, observability, and config tests. Use fake transport/native/clock inputs; normal tests make no live requests.

Required cases:

- STT/model temporary errors recover once; 429 quota/billing and invalid/refused outputs do not retry.
- Retry-After short/long/date/invalid values, bounded jitter, remaining-budget exhaustion, attempt timeout versus root abort, and HTTP-200 body stalls.
- Late transcript/decision/PCM/telemetry after a timed-out attempt, including when the native generation remains current.
- Dialogue-only pre-PCM TTS recovery; action-bearing and final-only action turns suppress it; authorization/PCM consumer/partial-audio failures remain terminal.
- No duplicated action route, authorization, required stream-end, terminal summary, or assistant/player commit. Early pre-audio failures do not invent stream-end events.
- Session voice stability, configuration migration/capabilities, ped reuse, delayed close, immutable request inputs, sample framing, and cleanup.
- All existing stock Gemini ownership/controller regressions and source-pinned build/native checks.

Run the full offline suite and build after each meaningful integration milestone. Record actual totals; do not require the expanded suite to contain exactly 106 tests.

API gate, when authorized: run existing normal smoke, multi-voice/acting listening, and a controlled injected failure around the live request path where practical. Identify injected faults separately from observed provider failures; do not induce quota failures/rate-limit abuse.

GTA gate, when deployment/launch is instructed: repeated same-NPC turns, two NPCs, long speech, interruption, rapid supersession, PTT, wait/follow, final-only actions, reconnect/handle reuse, and Gemini regression. Inspect sanitized logs for stale retries, duplicated effects, incorrect history, and wrong-NPC speech.

## 4. Completion report and remaining decisions

At implementation completion report architecture delta, actual files changed, replaced code, tests/results, pinned build evidence, API/GTA gates passed or deferred, remaining runtime unknowns, and updated architecture/smoke documentation.

The following remain validation choices, not reasons to expand scope:

- Supported multi-voice pool and acting quality for the configured TTS model.
- Useful retry delay/attempt caps based on measured stage latency.
- Actual in-game action timing and playback behavior under failures.

The accepted conservative action-bearing TTS rule is explicit. Relaxing it later requires a new lifecycle safety review; this implementation must not silently substitute a weaker stage-only interpretation.

## 5. API references

- [Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech): model-dependent voices and PCM format.
- [Speech API reference](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create): input/instruction/speed capabilities; instructions are unsupported for `tts-1`/`tts-1-hd`.
- [Rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits): server delay minimum, bounded retries, jitter, and nested client retries.
- [Error codes](https://developers.openai.com/api/docs/guides/error-codes): temporary throttling versus quota/billing/access failures.

These were checked during the October 1 review. Confirm capabilities again if implementation changes the configured models or API client.
