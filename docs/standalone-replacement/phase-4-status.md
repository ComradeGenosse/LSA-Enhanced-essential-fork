# Phase 4 — independent native audio streaming (first implementation)

**Branch:** `feature/standalone-phase4-audio-escrow`, stacked on Phase 3 PR #43. **State:** initial native PCM protocol and offline fixture; NOT GTA-deployed or verified audible. The complete replacement must not load Essential.

## Implemented

- `NativeAudioRegistry`: native-only audio authority minted **only after** a current native-confirmed turn has a staged AI text reply. Issues a separate `LeaseKind.Audio` claim and a fresh stream ID, audio lease ID and generation, all bound to host run, world epoch, actor incarnation and exact turn. No Node-created actor/audio lease.
- Signed 16-bit little-endian **mono 24,000 Hz** PCM, explicitly bounded to 3,000 bytes per chunk, 64 sequential chunks and 192,000 bytes per stream (4 seconds). At most four active streams and under 768 KB of retained raw PCM, with physical byte copies not caller-backed buffers. This deliberately declines longer TTS output rather than silently dropping audio; streaming drain/backpressure is a follow-up.
- Native owner-fiber IPC adds `audio.open`, `audio.chunk`, `audio.end`, `audio.cancel`. Strict host/session/world/transport/seq/request ID checks remain in force. Each audio command validates actor incarnation, turn, lease and generation and rejects missing, repeated or out-of-order chunks. Untrusted Base64 must decode canonically and respect frame bounds.
- `audio.end` verifies exact chunk count and total PCM bytes, then responds **`sealed_not_played`**. `buffered_not_played` and `audio_authorized_not_playing` are likewise honest. Sealing is not a playback or history receipt. Duplicate EOS, additional PCM after EOS and stale cancellation fail closed.
- Actor expiry, actor ABA, turn cancel, world reset, transport reconnect or shutdown purges all PCM and retires its lease. No audio calls on IPC background worker or output effects from this first slice.
- `stageNativePcm` validates and partitions Node PCM bytes into bounded sequential frames, performs exact native open/chunk/EOS and best-effort cancellation on any failure. Production has **no enabled TTS-to-device bridge** yet.

## Tests

- Native core deterministic tests: input format, no unstaged/audio-before-confirmation, wrong actor/lease, identity replay, out-of-order chunks, invalid PCM alignment, EOS length/count mismatch, cancellation, deep copy, separate lease on retry, hidden handle+address ABA, and no false audible claim.
- Node tests: strict PCM bounds and chunk ordering, 192 KB max, abort before/after start, backpressure cancellation, and `sealed_not_played` result.
- Windows CI builds the real `net481` host against a **published RAGE Plugin Hook SDK**, exercises existing typed-turn fixtures, then runs a dedicated **separate .NET Framework process ↔ Node PCM escrow fixture**. No game, hardware audio or paid TTS request runs in CI.

## Remaining Phase 4 implementation / acceptance

1. Independent TTS PCM production adapter and **continuous playback queue with drain**, not just short bounded escrow. Verify precise buffer credits and mid-sentence abort over a genuinely bounded memory budget.
2. An actual native output backend that routes the correct NPC's audio to a speaker in game, with spatialization, device handling and independently verified *started / audible / completed / interrupted* callbacks. Prior `IAudioOutput` remains an interface, not a real GTA implementation.
3. Only exact physical playback completion (not Node byte/IO/EOS acknowledgment) may commit an NPC utterance to durable history or enable lipsync success. These operations are **not implemented or claimed** yet.
4. Real GTA Enhanced RPH plugin startup, physical actor decorator/ABA validation, spatial audio and lip-sync tests cannot be validated from CI. Native physical actor adoption remains disabled.

**Go for further Phase 4 engineering; NO-GO for GTA deployment/cutover.** Existing Essential-based GTA installation and `main` remain untouched.
