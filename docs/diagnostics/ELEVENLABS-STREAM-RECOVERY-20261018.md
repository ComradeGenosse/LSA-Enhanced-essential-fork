# October 18 ElevenLabs streaming recovery: evidence and acceptance

## Exact runtime evidence

Archive: logs-20261018-143658-7e4629.zip.
Run: e1-run-20261018T142853Z-cd8b2b76-8980-4408-97dc-2abf3b4943cb.jsonl.
Turn: turn-1792334136873-10, NPC 0003e602, generation 9, session 5.

2026-10-18 14:35:41.996 UTC: native playback started. At 14:35:42.774 UTC ElevenLabs
reported elevenlabs_invalid_audio after 11 generated chunks, 8 forwarded chunks and
83,202 bytes forwarded; elapsed provider wall time 1,032 ms. The turn ended in
tts_error without an assistant history commit. A subsequent player mic turn
(turn-1792334147583-11) succeeded with 76,800 PCM bytes and native playback_ended:
completed, proving at least one successful recovery in the installed build.

### Root cause confidence

The existing logs do not distinguish per-frame base64 rejection, odd final PCM16
sample, empty stream or byte-accounting mismatch: all map to elevenlabs_invalid_audio.
Thus the exact rejected frame cannot be reconstructed. It is incorrect to blame
ElevenLabs provider output from this evidence. The code does contain strict
framing defects (nonfinal empty audio marker fatal; canonical unpadded base64 fatal)
which are now corrected, while preserving rejection of empty *whole responses*.

## Existing contracts preserved

Text-to-Dialogue WS, per-turn socket, model/voice and pcm_24000 remain unchanged.
Continue handing aligned PCM16 chunks to the existing awaited native callback.
Do not restart paid speech after text submission or partially played audio.
Native Essential remains the playback/lip/owner authority; runner host.failTurn
and its native playback evidence gate remain the only history-commit authority.

## Diagnostics

Bounded elevenlabs_stream_stage events: format_selected, socket_open,
empty_audio_marker, pcm_forwarded (first), provider_final, socket_cleanup.
Failure summary stage distinguishes message_decode, provider_rejected,
audio_decode, pcm_alignment, empty_stream, pcm_accounting, provider_timeout,
native_pcm, socket_error, socket_closed, request_send, interruption and pcm_limit.
No raw audio, keys, provider response bodies or dialogue are logged.
First PCM and native playback completion remain separate independent events.

## Offline verification

Run in lsa-essential-e1-candidate:
node --test tests/elevenlabs-provider.test.mjs tests/ea8-elevenlabs-provider-safety.test.mjs tests/ea118-elevenlabs-retry-safety.test.mjs tests/tts-and-history.test.mjs
npm test

Focused tests replay 83,202 bytes of valid PCM followed by invalid bytes,
validate recovery in a subsequent new speech turn, interruption, overlapping
turns, native callback failure, empty/truncated/timeout/close and strict base64.

## GTA acceptance still required

On the exact deployed DLL/companion: trigger a test-only late PCM failure;
confirm native turn cleanup, microphone immediately captures again and NPC
replies without old PCM; verify spontaneous speech and interrupted mouth/audio;
ensure failed speech has no assistant history success. Compare first PCM latency
with the Oct 18 observed 200-255 ms range for successful nearby turns.
Do not report this acceptance based on Node or simulated-native tests.
