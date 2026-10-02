# E5/E6 structured streaming and early TTS

E5 adds an opt-in Responses SSE adapter for one strict JSON decision envelope:

```json
{"mode":"dialogue_only","segments":[{"text":"..."}],"command":""}
```

`mode` is first by schema order. The decoder never parses the growing response as JSON. It scans the bounded response for a closed segment object, parses that complete object with duplicate-key rejection, validates its exact shape/text/length, freezes it, and only then makes it available. The terminal response must be `response.completed`, its completed assistant text must equal the received deltas, the whole JSON object must parse strictly, and the reconstructed `{dialogue, command}` must pass the existing Essential decision and stock action validators. Refusal, missing terminal, oversized/malformed data, duplicate keys, or a late command in `dialogue_only` fails the turn.

E6 uses the same model response and native identity. Only an initial `dialogue_only` mode can feed early TTS. A single consumer synthesizes segments in order; there is no speculative PCM queue or concurrent TTS. Action-bearing (`buffered_action`) responses remain behind the complete decision and stock validation barrier. The final `output_transcript` is emitted once after the completed response and validation. Aggregate PCM is capped at 6 MiB by default, before native authorization/forwarding. The native authorization is requested once on first PCM, the matching Essential acceptance is awaited before PCM is forwarded, and exactly one `generation_complete` and one `turn_complete` close the aggregate stream. Assistant history commits only after matching successful `PlaybackEnded`.

The complete JSON envelope is intentionally retained for terminal reconciliation. The complete-segment decoder is based on the previously exercised Phase 10B design, whose consumer tests held the model terminal event until after TTS had started. The reported Phase 10B GTA run (13 turns, 11 with audio/acknowledgements; largest observed PCM gap about 2.98 seconds) is useful evidence that Essential's logical audio stream can remain open across segment gaps. It does not verify this E1.1 code path or the current configured Luna endpoint. The current native DLL is unchanged.

Both switches default off in the checked-in `e1.config.example.json`:

```json
"structuredStreamingEnabled": false,
"earlyTtsEnabled": false
```

The controlled live GTA test configuration is separate and currently enables both flags.

Structured streaming alone keeps E5 behind the ordinary final-decision/TTS barrier. Early TTS requires structured streaming and is only honored for `dialogue_only`. The live GTA test config currently enables both flags; the repository example stays off. Change no native configuration or DLL. `tests/streaming-decision.test.mjs` and `tests/openai-transport.test.mjs` cover framing, segment validation, cancellation, PCM limits, buffered actions, and protocol failures. `tests/stock-controller-lifecycle.test.mjs` additionally runs two delayed segments through the actual patched stock controller and native lifecycle bridge: first PCM is observed before model completion, both chunks retain the same native identity and order, there is one stream-end handoff, and assistant history waits for matching `PlaybackEnded`.

The gated smoke passed against the current live install's configured `gpt-6-luna`: the first locally validated dialogue-only segment arrived at about 1.05 s, before `response.completed` at about 1.19 s. The first attempt revealed that the provider emits `response.output_text.done`; the adapter now validates that event against accumulated deltas. The smoke reports lengths/timing only and does not print the generated dialogue.

To repeat the exact configured Responses model check without connecting to GTA, run:

```powershell
$env:LSA_E5_LIVE_API_SMOKE = '1'
node tools/streamingApiSmoke.mjs
```

That explicit gate makes one billable request and prints only mode, segment lengths/timing, terminal timing, and whether the command was empty; it does not print the API key, prompt, or generated dialogue. The live install now has both flags enabled for a controlled GTA test; the checked-in example remains default-off. In-game validation should confirm first NPC audio precedes model completion, segments remain ordered with one logical stream, late refusal/failure interrupts that exact generation, and assistant history commits only after native playback completion.

## Current implementation status

E5 is **implemented and live-API validated** for the configured Luna streaming path. E6 is **implemented and validated through the patched stock-controller/native-lifecycle harness**, but physical GTA acceptance remains open.

The current complete regression result is **149 tests, 0 failures** ([test output](e5-e6-test-results.txt)), including the `84df8e30` model-failure/PCM16 hardening and the production telemetry repair described below.

The repaired E1 source-tree SHA-256 is `78dc5318bb79b945d683498531788523ee0cb426c4c4716e07db2474cf0027d9`. Compare source-tree and installed file hashes when checking a deployment; the launcher bundle hash alone does not identify changes to separate E1 modules.

## First GTA runs: telemetry integration regression (2026-10-01)

The latest run, `e1-run-20261001T233519Z-a12d1e0c-5b87-48d5-895d-dc4f92ddf9bf.jsonl`, contains six turns: four microphone and two typed. All four STT requests succeeded; all six model requests returned HTTP 200 and locally validated their first dialogue segment. Every turn then failed with `invalid_response` before any TTS request, native audio authorization, or playback. The preceding E5/E6 run shows the same first-segment failure on its three turns that reached the model.

The E6 segment callback called `metrics.setDetail()` and `metrics.mark()`, neither of which exists on the production `TurnMetrics` or disabled-logging metrics object. The first call threw before the segment was queued for TTS. The stream adapter then mislabeled that local callback error as invalid model output. Earlier E6 integration tests passed because they constructed the runtime with `telemetry: null`; the standalone live Responses smoke also did not exercise this production callback.

The callback now uses the existing `count('segmentCount')` API. Validation timing already comes from `stream_segment_validated`, so no additional timing API is needed. The unused alternate callback was removed. Local segment-delivery errors now report the safe `segment_delivery_failed` code, distinct from malformed provider output, without recording dialogue or exception content.

The stock-controller E6 test now uses the real telemetry class and was observed failing before the fix with the same zero-TTS signature, then passing after it. Microphone tests cover real and disabled logging with early TTS enabled and disabled. Additional real-telemetry regressions verify that late model refusal cancels a pending TTS reader and that a partial PCM16 tail fails without final stream completion or assistant history commitment. The full offline suite passes **149 tests, 0 failures**; see [current test output](e5-e6-test-results.txt).

## Repaired build: GTA verification run (2026-10-01)

Run `6b07b57a-e36d-494a-89df-10e5c487564e` covers 13 microphone turns against one NPC/session. All 39 STT, model, and TTS requests returned HTTP 200. All 13 turns received native audio authorization and playback. Ten completed and committed assistant history once after native completion; three were interrupted with native reason `cleared`, retained player history, and discarded the assistant response. The user confirmed hearing replies and deliberately interrupting some turns. There were no dropped or malformed records, sequence gaps, retry events, provider failures, or duplicate native stream-end handoffs.

Eight dialogue-only turns entered segmented TTS 103–183 ms before the model-finished event. Their first PCM arrived 127–651 ms after model completion; playback began after model completion on all 13 turns. The other five responses contained actions and correctly held TTS behind final model and stock decision validation. Every response contained only one dialogue segment. The run verifies the repaired live audio path and safe action buffering, but does not demonstrate audible early playback or a multi-segment stream gap. From mic release to native playback start, median latency was 2.57 seconds (range 2.04–4.99 seconds); this includes STT and excludes recording duration.

The same-session RAGE Plugin Hook log confirms vehicle entry and seated state, resumed ambient driving, vehicle following, and a `WaitHere` action. The JSONL records five stock action dispatches, each once. See the [full run review](../../docs/E6-GTA-verification-2026-10-01.md) for per-turn timings, lifecycle checks, limitations, and the next acceptance test. Physical multi-segment ordering/gap behavior, typed input, multi-NPC isolation, and injected provider-failure behavior remain unverified in this run.
