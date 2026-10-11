# EA8 — ElevenLabs emotional delivery and provider safety handoff

Date: 2026-10-11. Owner: Agent D / EA8.
Source PR: #68, exact approved parent `4cad39198478d7f03bb8ec6657b674e52fa659dd`.
Branch: `feature/ea8-elevenlabs-delivery-safety-20261011`.
Stack target: `integration/elevenlabs-emotional-acting-ea0-ea4-20261011` (PR #68).
Independent upstream design PR: #60.
**Release status: offline implementation only, NOT approved for live GTA or paid vendor tests.**

## Grounded vendor capabilities (verified 2026-10-11)

- ElevenLabs [Text to Dialogue WS documentation](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd) explicitly permits `eleven_v4_turbo` through `/v1/text-to-dialogue/stream-input`; frames contain `voices`, `inputs:[{text,voice_id,new_turn}]`, and `close_socket` or `flush`. Turbo registers one voice and response chunks have `audio` and `is_final`. This project preserves its existing per-synthesis WebSocket, PCM16 mono 24 kHz, and native callback contract.
- ElevenLabs' [September 30, 2026 official Eleven v4 audio-tag list](https://elevenlabs.io/blog/elevenlabs-audio-tags-list) explicitly names `[scared]` among tense emotions and says v4 Turbo supports inline audio tags through the API. [v4 best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) corroborate `[whispers]`, `[laughs]`, `[sarcastic]`, `[excited]`; the [emotion help center](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-to-produce-emotions) illustrates `[angry]` and `[sad]`.
- Vendor tags are **natural-language hints in speech text**, not a schema-validated `emotion` parameter, hard enum, guarantee of playback style, or feature independent of the voice/training context. No vendor assertion was discovered that `[concerned]` produces a reproducible concerned performance. We specifically do NOT substitute `[anxious]`, `[thoughtful]`, SFX or fabricated concern/fear tags.

## Changed files and commits

1. `lsa-essential-e1-candidate/src/voice/emotion/elevenTags.mjs` — EA0's original six-tag export preserved, new explicit `ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY` mapping `fearful -> [scared]` under opt-in `modelId: 'eleven_v4_turbo'`; no `concerned` tag. Shared `validateElevenSpeechDialogue` checks conservative <=3000 UTF-16 units and rejects unpaired surrogate code units before connecting. `sanitizeElevenSpeechDialogue` neutralizes ASCII/fullwidth/corner/small square brackets only in the TTS copy. Closed factory-brand check preserves canonical data. Renderer defaults to EA0 six-tag behavior unless the verified model ID is explicitly supplied.
2. `lsa-essential-e1-candidate/src/providers/elevenlabs/speechProvider.mjs` — dynamically derives provider allowlist from EA8 verified map, checks model ID, passes explicit Turbo model identifier into renderer, compares against **exactly one** prefix plus independently sanitized original, handles accessor-based input defensively; keeps off/shadow input bytes untouched. Shared text preflight before opening a paid socket. Cancellation and timeout now invalidate synthesis even if `is_final` arrived but the asynchronous native PCM callback has not finished; checks abort between 24,000-byte PCM chunks.
3. `lsa-essential-e1-candidate/tests/ea8-elevenlabs-provider-safety.test.mjs` — new no-network tests for all enum values, fearful/concerned mapping and unsupported model, real branded vs forged intents, raw brackets including Unicode lookalikes, exact byte parity in off/shadow, conservative 3000 budget, Unicode surrogate rejection before socket, buffered vs early direct synthesizer calls, 24 kHz aligned chunk forwarding, telemetry secrecy, final-before-PCM cancellation, malformed and truncated PCM.
4. `docs/handoffs/EA8.md` — this document.

Latest code commit prior to this handoff: `50b9c08ef48582b356f3f25a9d8068e59ea754dc`. Use the PR head for the final exact commit rather than assuming this handoff's earlier SHA is latest.

## Interface changes requested of FINAL integrator (shared EA2 ownership)

**Required for audible witnessed fear:**
`src/voice/emotion/resolveSpeechDelivery.mjs` currently imports the EA0 six-key `ELEVEN_TAG_FOR_DELIVERY` and hardcodes `TAGGABLE` to six values. EA1's valid `fearful` hint is consequently dropped before the provider receives it, even though EA8 now supports `[scared]`. In FINAL integration, replace that import with `ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY as ELEVEN_TAG_FOR_DELIVERY` (or equivalent explicit verified mapping) and extend the `TAGGABLE` set to include `fearful`, **only under the verified `eleven_v4_turbo` experimental gate**. Preserve the 0–8 cap and actual per-turn count; validate no additional tags can bypass the gate. Because the provider receives a trusted branded factory result, no new public model hint or wire field is needed.

**Optional telemetry clarification:** `resolveSpeechDelivery` presently counts intent before the provider independently decides whether it used the tag; this can overstate acted cases on invalid/unsupported models or a text mismatch. FINAL should distinguish `selected`, `eligible`, and `tagged actually sent` using the existing `acting_tts_delivery.tagged` telemetry, without committing mood on mere requested intent. Do not assume telemetry is an audible playback receipt.

**Provider composition invariant:** `providers/providerStack.mjs` must continue to inject EA0/EA8's real trusted `renderElevenSpeech`, not a model-supplied or arbitrary renderer; the actual renderer's WeakSet brand prevents JSON model values from authorizing even an allowlisted prefix. Provider structural validation by itself is only defense-in-depth. Keep native accepted `playback_ended` as the mood/history completion authority.

## Test plan and verification status

- Static JavaScript syntax parse of all three changed `.mjs` files: **PASS** (source fetched from EA8 branch, exports/imports stripped for syntax parse in the available V8 sandbox).
- Actual Node tests **not executed in the current environment**: the repository could not be cloned from this runner (outbound GitHub DNS disabled), and the connector cannot execute `node --test`. Do **not** represent the static parse as a test pass.
- Commands to execute in full checkout:
  ```sh
  cd lsa-essential-e1-candidate
  node --test tests/ea8-elevenlabs-provider-safety.test.mjs tests/elevenlabs-emotional-acting.test.mjs tests/ea2-speech-delivery.test.mjs tests/elevenlabs-provider.test.mjs
  npm test
  ```
  Also run complete EA integration CI Ubuntu/Windows, isolated Python, native/ABI suites against the exact final integration commit. These tests are not GTA acceptance.
- No paid ElevenLabs requests, GET preflight, remote audio generation or GTA tests were made for EA8. **No provider-audible effectiveness is claimed.**

## Remaining billable/GTA acceptance requirements

Operator authorization for 10x paired tagged/untagged Nathan v4 Turbo voice samples using the *same canonical text*, with `fearful` `[scared]`, the six older tags, and untagged `concerned`; evaluate spoken-word integrity, whether tags are spoken aloud, audible naturalness/strength, false sound effects, first-PCM/native-audible latency, credit delta and stutter. Native GTA tests must cover interrupted early PCM, multiple segments, owner changes, off/shadow strict parity, NPC evidence fences, timeline/protagonist ABA, current native accepted playback, rollback. Roll back to `mode=off` on any regression. Any undocumented or unstable tag remains untagged until independently verified.
