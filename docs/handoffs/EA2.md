# EA2 — Runtime speech integration handoff

**Base:** PR #60 commit `8c33082a34e9c6f7db514c9d631135a610b788de`.
**Branch:** `feature/ea2-runtime-speech-integration-20261011`.
**Scope:** `src/openai/runSequentialTurn.mjs`, `src/providers/elevenlabs/speechProvider.mjs`, new `src/voice/emotion/resolveSpeechDelivery.mjs`, dedicated tests. Paths are under `lsa-essential-e1-candidate/`.

## Implemented

- One native-identity-bound, synchronous EA2 resolver per turn. Works at both early streaming segment synthesis and final/buffered synthesis, including player text, STT and ticket-bound spontaneous director turns. Does not re-synthesize validated text after successful early segments.
- Delivery is a separate optional `services.speak({ dialogue, delivery })` field. Legacy schemas, stock commands, output_transcript, staged history, memory and native audio authorization remain untouched.
- Resolver is a *trusted injectable* adapter, not an alternate LLM. Absent EA1/EA0 integration, runtime defaults to neutral; off mode has no resolver work or telemetry. The in-memory budget accepts at most two taggable decisions per turn by default; it binds segment sequence, actor identity, source and native-current lease.
- ElevenLabs WebSocket accepts a trusted EA0 renderer at provider construction and applies its output **only for experimental mode**, with a second exact single-approved-tag check. Off/shadow send unmodified `inputs[0].text`. PCM16 mono 24k, async PCM forwarding, per-turn socket, close, cancellation, deadlines, security and credits handling retain their original transport code.
- Categorical `acting_decision` and `acting_tts_delivery` telemetry; optional `acting_tts_first_pcm_delta` only for explicit offline A/B benchmark inputs. No evidence IDs, raw dialogue, player text or secret values in these new events.
- Mock WebSocket tests for off/shadow parity, explicit experimental tagging, tag injection rejection, PCM transport and budget; real runSequentialTurn lifecycle tests for early/buffered/director/text/STT/cancellation.

## Required integration (separate agent/reviewer)

1. **EA0 config and renderer**: `config.expressiveDelivery` must be added by Agent A. The EA2 provider has an optional constructor argument `renderSpeech` and currently defaults to null. Wire `renderElevenSpeech` in `providers/providerStack.mjs` via `createElevenLabsSpeechProvider({config, WebSocketImpl, renderSpeech:renderElevenSpeech})`. This file is intentionally untouched here because the integration agent owns composition. Rendering must accept `{dialogue,delivery,enabled:true}` and return exactly `[approved-tag] + ' ' + dialogue` or original dialogue. New EA0 sanitizer transformations will require a jointly reviewed safety check in `speechTextForSocket` if the result is more than one prefix added.
2. **EA1 deterministic selector and evidence**: inject `services.emotionalActing = {resolveDelivery, getSceneEvidence, getActorTraits}` from trusted runtime composition, with each getter checking exact current identity/epoch and PS verified observation evidence. `resolveDelivery` is called synchronously with `{identity,segmentText,sequence,source,nowMonotonicMs,currentSceneEvidence,actorTraits,priorEphemeralMood,config,lunaHint}`. EA2 does **not** inspect global PS events and never treats a report as witnessing. If no verified current owner evidence, EA1 must remain neutral.
3. **EA3 optional Luna hint**: `segment.delivery` is passed to EA1 as `lunaHint` *only when it is a known enum*; it is never passed to the provider directly. A single `decision.structuredSegments[0].delivery` is supported in the buffered path. EA3 still owns the separately gated strict schema/decoder/validation migration.
4. **EA4 optional mood**: adapter may implement `readMood({identity,turn})`, `onSpeechCompleted({identity,turn,delivery})`, `retireTurn({identity,turn})`. The adapter must enforce owner/epoch/generation/TTL and must discard on cancellation; this module does not persist mood or mutate profiles. Calls are best-effort synchronous and cannot block speech.
5. **Safety/quality gate**: EA0+EA1 composer should preserve `mode='off'` default, compare shadow WebSocket bytes, confirm exact tag allowlist/sanitization, measure early PCM latency and native audible playback in GTA. In this independent PR **no emotional acting is enabled** until both renderer and trusted scene resolver have been wired.

## Notes

- The provider's exact-prefix defense is deliberately conservative. If EA0 strips suspicious raw model-supplied stage directions from *TTS-only* input, coordinate a reviewed extension rather than accepting arbitrary renderer strings.
- Telemetry evidence category and age are `unknown` until EA1 exposes a separately validated bounded category/age bucket. Never log source evidence IDs or contents.
- Tests are no-network node:test mocks; GitHub workflow currently targets selected base branches, so a PR against #60 may not automatically run the workflow. Integration reviewer should execute `cd lsa-essential-e1-candidate && node --test tests/ea2-speech-delivery.test.mjs tests/ea2-turn-lifecycle.test.mjs tests/elevenlabs-provider.test.mjs` and full `npm test`.
