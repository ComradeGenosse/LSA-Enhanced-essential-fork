# E1.1 observability implementation

Status: implemented in the offline E1.1 candidate. The candidate is not deployed to GTA and this work made no live API calls. Instrumentation is passive: Essential remains authoritative for turn identity, playback, actions, and success.

## Runtime behavior

When the native launcher starts `server.bundle.mjs`, the E1 bootstrap opens `logs/e1-run-<UTC>-<runId>.jsonl` before creating the runtime. Tests and imported/embedded runtimes default to no-op telemetry unless explicitly enabled. Logging failures never fail a turn. The queue is bounded, terminal summaries receive reserved capacity, and dropped records are counted so a report cannot claim a complete trace. Defaults are five files, 10 MiB per file, and 100 MiB total. `.env`, credentials, prompts, transcripts, dialogue, URLs, raw response bodies, and audio bytes are excluded. Provider request IDs are hashed before persistence.

Records use schema version 1, monotonic elapsed time, ordered sequence numbers, exact native identity, source, and a strict event/data allowlist. The offline reporter reads JSONL without making network requests and writes JSON and Markdown summaries. It groups by complete native identity, separates completed and non-completed latency percentiles (nearest-rank), reports unknown usage as null, and marks malformed, truncated, dropped, or unterminated traces incomplete.

## Measurements

The implementation records run/bridge lifecycle; turn binding and source; typed input readiness; microphone capture start/stop, duration, bytes, and overflow; STT/model/TTS start, headers, completion/failure, safe request correlation, first TTS byte, response usage when supplied, body-read and chunk-handoff time; decision validation; player/assistant history mutations; action validation and the stock action/transcript handler boundary; native authorization, playback start/end, and stream-end handoff; forwarded PCM bytes/chunks; cancellation/supersession; playback-watchdog setup/expiry; and one terminal summary per generation.

Durations use Node's monotonic clock and represent observed callbacks. Input-ready delay includes all time from turn binding until complete text or microphone input is accepted. Stock hydration does not expose an independent timestamp, so hydration-only duration is not reported. The action acceptance event means the stock handler accepted the routed event; it cannot prove the GTA world action completed. No metric infers audibility or native physical duration from generated PCM size. The reporter labels PCM-derived duration as expected duration; only matching `PlaybackEnded` is completion evidence.

Provider-request IDs are hashed to a short stable SHA-256 prefix. Token usage is reported only when a response supplies it. Cost is not estimated. Failed sink writes are reported with bounded error codes and summaries are marked incomplete through the drop/failure evidence available to the process.

## Source and history

`PLAYER_TEXT` and `PLAYER_MIC` are genuine player input and commit to dialogue history once the accepted input is current. The assistant response remains staged until matching native playback completion. Interruption, provider failure, rejection, timeout, supersession, or disconnect discards staged assistant history while preserving accepted player input. `SPECIAL_EVENT` and system/internal sources remain event context and never become fake player dialogue. Exact duplicated stock event/context fields are collapsed by normalized whole-field equality; arbitrary substring removal is not used. Stock Gemini ownership and audio behavior remain unchanged.

## Code and verification

The contract and rotating sink live in `src/observability/eventContract.mjs` and `src/observability/fileSink.mjs`; run and turn tracking is in `src/observability/telemetry.mjs`; bootstrap and explicit runtime wiring are in `src/bootstrap.mjs`, `src/integration/essentialGlue.mjs`, and the OpenAI turn/provider modules. The source-pinned AST patch instruments the existing Essential action/transcript route and fails closed when its hook is ambiguous. The offline reporter is `tools/summarizeRun.mjs`; observability regressions are in `tests/observability.test.mjs` alongside controller and lifecycle tests.

Run `npm test` and `npm run build` from the candidate root. The suite uses fakes and local fixtures; it makes no OpenAI requests and does not launch GTA. GTA acceptance remains pending and must inspect actual runtime JSONL logs using the checklist in `docs/gta-smoke-checklist.md`.
