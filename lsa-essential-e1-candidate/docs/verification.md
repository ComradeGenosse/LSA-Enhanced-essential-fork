# E1.1 implementation and verification report

This focused hardening pass and live API smoke update the existing `lsa-essential-e1-candidate` workspace. Stock Essential and the pinned DLL remain reference inputs. No live GTA installation was changed. The live OpenAI smoke ran outside GTA with a simulated native endpoint.

Candidate status: **offline E1.1 and configured OpenAI API path passed; GTA/runtime validation remains outstanding**.

## Offline results

The package `test` script: **95 passed, 0 failed, 0 skipped, 0 cancelled**, including a complete normal rerun after the live smoke. Full output: [test-results.txt](test-results.txt). This environment has no `npm` executable, so the same package script was invoked with Node's built-in `node --run test`; it ran without an artificial keepalive.

The suite covers provider/work timeout versus playback watchdog, the referenced provider and request timeout behavior for otherwise handle-free pending operations, long PCM with later matching `PlaybackEnded`, missing and late acknowledgements, source and history semantics for typed/microphone/special-event turns, exact-field special-event deduplication that preserves partial/unrelated context, separate player and assistant commits, terminal reason classification, completion/cancel/timeout races, TTS/native failure, and retained bounded history. The stock harness executes the actual extracted `ib()` typed controller and `kb()` special-event controller through native turn allocation, the OpenAI adapter, decision/TTS, coordinator, stream-end and `PlaybackEnded`. It also covers rapid turns, stale TTS, action timing, exact interruption during long playback, PTT hydration/drain, Gemini isolation, and terminal failure mapping before versus after audio submission.

Metadata checks accept the pinned artifact and reject altered bytes even when its JSON still claims the correct DLL hash, a wrong DLL fingerprint, missing required capability, and duplicate native capability. The AST patch fails closed on a duplicated lifecycle registration hook. All tests use provider doubles; no tests are skipped. The in-process runner is used because this Windows sandbox rejects `node --test` child-process spawning.

The build remains deterministic and writes only to the candidate `dist/` directory. All 25 exact AST edits match the pinned Essential bundle, the patched source parses, and the candidate manifest marks GTA runtime validation false. The live smoke is a separate opt-in command and is not imported by build or unit tests.

- Upstream bundle SHA-256: `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2`
- Stock DLL SHA-256: `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`
- Native metadata SHA-256: `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23`
- Built bundle SHA-256: `ba37447903d56473fc8d98ad93b6683cc31765a328a302230c7fa75cebeed2c4`
- E1 source-tree SHA-256: `774057b9ac3fdec0f2419281eefe6a5b9d2abd7f0be9c3153e3d0f72d25265c5`
- Release payload SHA-256: `01dc3113856987096168cf9b3d7404b68fae98ee6131dfe43b374c23d3a0af0b`

## Live OpenAI API smoke

The explicitly opted-in smoke used `https://api.openai.com` and the configured `gpt-6-luna` (low effort), `gpt-transcribe`, and `gpt-4o-mini-tts` (`nova`) settings. It made no automatic retries, model substitutions, or provider fallback. Sanitized request-level evidence and the resulting dialogue/audio/history checks are in [E1-API-SMOKE.md](../E1-API-SMOKE.md) and [E1-API-SMOKE.json](../E1-API-SMOKE.json); the generated 24 kHz PCM and WAV are under the ignored `outputs/api-smoke/` directory.

The standalone TTS probe returned 148,800 aligned PCM bytes (3.10 seconds). The transcription probe returned the known phrase exactly. The end-to-end PTT path then transcribed the fixture, obtained a completed and validated Luna decision, generated 93,600 PCM bytes (1.95 seconds), received simulated authorization and one stream end, and completed one matching simulated `PlaybackStarted`/`PlaybackEnded` lifecycle. The report confirms user history existed before playback while assistant history was staged, then both appeared once after matching completion. A local stock-validator failure probe also rejected an unsupported action without a network request.

The first standalone Luna attempt returned HTTP 200/completed but the local E1 path raised an unclassified `TypeError`; its raw error was intentionally not retained. The later full pipeline using the same configured model and production decision path passed. This initial attempt is recorded here for transparency; the final evidence is the successful end-to-end pipeline, not the standalone first attempt.

## Reviewed behavior kept intact

Essential remains the only allocator/authority for native ped, turn, generation, playback authorization, tagged audio, stream end, exact interruption, actions, and world context. The OpenAI branch still bypasses Gemini owner maps and generic audio replay. Existing Gemini ownership, recovery, and completion behavior remains unchanged. Action validation continues through the stock current catalog/parser and dispatch stays at stock timing with exact-generation guards.

## Remaining GTA/runtime verification

The live smoke establishes OpenAI endpoint compatibility for the configured requests outside GTA. It does not establish actual DLL/server version matching, physical speech duration in GTA, native audio playback, acoustic interruption behavior, or in-game action/world effects. Those require the manual acceptance items in the [GTA smoke checklist](gta-smoke-checklist.md); none were run here.
