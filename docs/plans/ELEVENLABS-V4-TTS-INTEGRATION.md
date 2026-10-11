# ElevenLabs v4 Turbo TTS — LSA opt-in replacement for local Qwen

**Scope:** New branch stacked on Qwen PR #39, which is stacked on radio PR #46. ElevenLabs becomes the **selected speech provider only when opted in**. It does **not** alter Luna reasoning, OpenAI speech transcription, promoted NPC memories, radio/perception, RAGE native control, spatial playback, audio volume, or other existing providers.

**Status:** Code and no-network tests implemented. A live ElevenLabs key/voice, subscription capabilities, first-audio latency, credits, GTA authorizations, interruptions and real output sound still require **local acceptance**. Do not merge or deploy solely on CI success.

## Why this provider

NVIDIA GPU contention degraded local Qwen inference from ~3.1–3.6× realtime (lighter workload) to ~0.5× when GTA + DLSS + frame interpolation rendered fully. ElevenLabs is cloud TTS and does not use the RTX 5090 for synthesis. It may or may not outperform OpenAI in end-to-end GTA timing; benchmark real voice quality, latency and price.

Official protocol is **Text-to-Dialogue WebSocket** (NOT the older TTS WebSocket, which does not support v4), using:
- `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=pcm_24000`
- initial `voices` + `xi_api_key` message, then an `inputs` message containing `text` and vendor `voice_id`, then `close_socket` to flush short phrases.
- base64 PCM signed 16-bit mono at 24 kHz forwarded to existing native `onPcm`. Any unexpected protocol/error/PCM length fails closed; no MP3 decoding, no resampling, no native changes.
- Dedicated socket per synthesis; cancellation/timeout closes its own connection and cannot cause cross-NPC audio.
- 24 kHz output requires your ElevenLabs plan/voice/model combination to allow that format; unsupported plans fail **explicitly** rather than silently sending wrong-rate PCM.

Documentation sources:
- https://elevenlabs.io/docs/changelog/2026/9/28
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets

## Setup (no secrets committed)

1. Pull the ElevenLabs PR branch and install/build/deploy following **the same companion/native installation process as PR #39**. Node 22 is required for its built-in WebSocket; no new npm dependencies or local Qwen service are required for ElevenLabs.
2. Keep `ELEVENLABS_API_KEY` in your **local ignored `.env`** that the companion loads, or in the companion process environment. Example:

   ```dotenv
   ELEVENLABS_API_KEY=replace_locally_with_your_real_key
   ```

   Never paste a real key into chat, PR, tracked config, diagnostics or the ElevenLabs voice alias mapping. The key needs Text-to-Speech permission and usable credits. The provider transmits it only over the fixed ElevenLabs TLS WebSocket, in the authentication message.
3. In ElevenLabs, choose a voice (including a voice you are authorized to clone/use) and copy its **20-character Voice ID**. This is NOT the voice display name.
4. Edit only your installed/checkout-local, ignored `e1.config.json`:

   ```json
   {
     "speechProvider": "elevenlabs",
     "elevenLabs": {
       "modelId": "eleven_v4_turbo",
       "voices": { "nathan": "YOUR_20_CHARACTER_ID" },
       "speechVoiceProfiles": {
         "nathan": { "genders": ["any"], "ageBands": ["any"] }
       }
     }
   }
   ```

   The snippet is an **overlay**, not a complete replacement config. Replace the placeholder with your actual vendor voice ID. Keep the rest of your existing `e1.config.json`, e.g. `reasoningModel`, `transcriptionModel`, `ttsVolume`, `voiceAssignment`, `intelligence`, native mappings and characters unchanged. If you have multiple NPC voices, give each a distinct **lowercase local alias** and a unique case-preserved ElevenLabs voice ID, and gender/age profiles.
5. Restart the companion to apply provider/credential changes. Keep Qwen stopped if you want to free VRAM; the provider does not start or contact the Qwen sidecar. No fallback sends dialogue to other speech vendors without an explicit config change.

## Voice/acting semantics

- Voice ID mapping uses a **stable local alias** (e.g. `nathan`) instead of overloading OpenAI's `nova` or Qwen registry names. Persistent promoted characters keep old voice assignments intact; a temporary provider switch derives a corresponding active alias without deleting or rewriting the saved original.
- `actingEnabled` may stay true, but **OpenAI natural-language voice instructions are not sent** to v4 Turbo. v4 relies on an expressive cloned/preselected voice and any supported delivery tags **actually present in validated NPC dialogue**. This PR does not add or prompt-inject such tags; test voice expressiveness by ear. Do not assume full Qwen/OpenAI acting parity.
- `ttsSpeed` is not implemented for v4 Turbo; the existing configured `ttsVolume` still operates during shared native PCM forwarding.
- Every Luna speech segment generates its own isolated ElevenLabs request. Natural streaming within each text segment works; no persistent cross-segment WebSocket reuse or experimental source mixing is performed.
- Provider rollback: set `speechProvider` to `faster-qwen3-tts` and restart the Qwen sidecar, or to `openai` to recover the prior cloud voice. Existing P1/P2 identities, character memories and original vendor voice references remain unchanged.

## After first ElevenLabs preview fails (October 11)

First real synthesis attempt returned `elevenlabs_remote_error` without WAV or timings. Independent `GET /v1/voices/{voice_id}` succeeded (HTTP 200); this proves key/voice lookup only, **not** voice synthesis authorization or specific model/audio-format access. Do not repeat paid attempts blindly.

Run **non-billed** diagnostics first:

```powershell
node tools/elevenlabs/preflight.mjs --voice nathan
```

This reads existing private `.env` and ignored config locally and sends only GETs to `/v1/models` and the selected voice endpoint. It prints only model-listed/voice-available booleans and numeric HTTP statuses; no key, dialogue, account metadata or full vendor payload. The model list is evidence of model discovery **only**; it does not guarantee the requested v4 model is enabled for speech or that `pcm_24000` is permitted. The key may allow GET voice but deny synthesis.

The new provider-side error mapper translates nested `error` / `detail` code/status values and limited textual error indicators into fixed buckets:
`elevenlabs_auth_failed`, `elevenlabs_credits_unavailable`, `elevenlabs_model_unavailable`, `elevenlabs_output_format_unavailable`, `elevenlabs_voice_unavailable`, `elevenlabs_rate_limited`, `elevenlabs_request_rejected`, `elevenlabs_policy_closed`, or `elevenlabs_remote_error`. Raw vendor errors are never logged or surfaced. Categories are heuristic diagnoses, **not** proof of an exact provider-side cause.

Only after reading preflight output, optionally rerun one short preview with `--allow-billing`. Real verification is impossible without another synthesis request; it may consume ElevenLabs credits even if the service rejects later in the stream. Do **not** put the credential in a terminal argument or in a GitHub issue/PR.

### Investigate if still generic

Compare the official current [v4 streaming TTD guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd) and [model discovery endpoint](https://elevenlabs.io/docs/api-reference/models/list). If preflight is successful but synthesis still returns `elevenlabs_remote_error`, collect the sanitized category and socket close code (no raw response, credential, dialogue, or voice owner's private information) and ask ElevenLabs support to identify the rejected field/entitlement. Avoid switching to an MP3 output and treating compressed frames as 24k PCM.

## Acceptance plan

1. Run offline tests (never bill ElevenLabs): `node --test tests/elevenlabs-provider.test.mjs`.
2. Test one short, **explicitly billed** preview (requires valid local config, private key and voice ID). From `lsa-essential-e1-candidate`, run `node tools/elevenlabs/voice_smoke.mjs --voice nathan --allow-billing`. It creates ignored `outputs/elevenlabs-smoke/nathan.wav` and prints first-PCM and total synthesis time without disclosing the key or spoken text. Without `--allow-billing`, the tool refuses all external synthesis. Confirm first audio, generated output and timing, then compare the same Nathan line with Qwen/OpenAI and listen (never infer expressiveness from vendor marketing latency).
3. Test one player text turn, one microphone turn, cancellation while speaking, repeated quick NPC requests, character swap, interruption during combat, and one promoted Nathan conversation in GTA. Verify exact owner/turn receipts, TTS volume, E1 observational logging and absence of key/transcript leaks.
4. Record **full turn** time from Luna start to first native playable/audio start, not just vendor-reported inferencing; compare typical, p50 and p90 along with any stutter, voice continuity, credits spent, and monthly expected costs.
5. Only after passing GTA acceptance, merge in stack order (#46 → #39 → this PR) or rebase cleanly onto the final base once those predecessors land.

## Known limitations

- The v4 Turbo Text-to-Dialogue WebSocket currently uses vendor-side buffer thresholds (~40 chars and eight words) and can therefore still delay very short lines; `close_socket` is sent immediately to flush them.
- The backend depends on Internet latency, service health, available paid credits, and your voice's compatibility. No automatic silent fallthrough to OpenAI or Qwen on credit exhaustion.
- PCM format support and 24 kHz access must be verified against the user's plan.
- Vendor cloud speech receives NPC dialogue text; unlike local Qwen, this is not an offline/private-only speech path.
- This PR does **not** claim to replace the standalone project audio/PCM native layer; it integrates with the current LSA E1 provider stack and can be ported to standalone at the provider adapter boundary later.
