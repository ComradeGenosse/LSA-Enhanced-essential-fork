# October 18, 2026 — native playback completion stall

## Reconstructed evidence

Source: `logs-20261018-152211-345a33.zip` (the last E1 run JSONL and RAGEPluginHook.log).

| EDT | Event | Verified detail |
| --- | --- | --- |
| 11:19:54.240 | `native_playback_started` | turn `turn-1792336789316-12`, generation 12, session nonce 3 |
| 11:19:56.285 | `elevenlabs_tts_timing_summary` | 142,080 PCM bytes, 12 chunks, 2,960 ms |
| 11:19:56.286 | `native_stream_end_handoff` | accepted by original backend for the same turn |
| 11:19:56.286 | `playback_watchdog_armed` | 60,000 ms; no native drain acknowledgment |
| 11:20:41.846 | `native_playback_ended` | `cleared` / `interrupted`, rather than completed |
| 11:20:41.846 | `assistant_history_discarded` | no false successful speech |

The 45.560-second unresolved interval is **after** upstream EOS handoff.
The preceding turn (`turn-1792336787027-11`) received a normal `completed` native receipt.
The logs cannot distinguish native buffer starvation from a missed native completion callback,
nor establish whether three seconds of audio was audibly heard.

## Additional static reverse-engineering from the exact pinned native DLL

The uploaded `LosSantosAlive(7).dll` SHA-256 is
`9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`,
identical to the repository's pinned Essential DLL.

Decoded CLI method bodies establish this native path (numeric names denote
obfuscated methods, not reconstructed source identifiers):

- `NpcPlaybackCoordinator.MarkStreamEnded` (MethodDef 0x060013FD) writes
  `NpcAudioTurn.StreamEnded`, independently of actual buffer drain.
- Coordinator `m5132` (0x0600140C) tests exact-turn
  `NpcSpatialAudio.HasBufferedAudioForTurn` (0x0600147D),
  `StreamEnded`, `PlaybackStarted`, `EstimatedPlaybackEndAt`,
  `LastChunkAt`, and timing guards present in IL (350 ms, 450 ms,
  15,000 ms). Their exact higher-level branching is obfuscated.
- Its completion checks are invoked by `m5131`, via a dedicated thread
  loop `m5194` created by the coordinator during Initialize.
- Native clock helper `m5153` → `Rage.Game.get_GameTime`.
- `NpcSpatialAudio.HasBufferedAudioForTurn` delegates to the live mixer
  object's exact-turn buffer query. It is distinct from
  `IsAudibleAudioPlaying` and must not be replaced with a silence guess.
- `GeminiBridgeClient.m5468` reads the complete identity and invokes
  `NpcPlaybackCoordinator.MarkStreamEnded`; the original backend's
  accepted EOS handoff alone does not prove `StreamEnded=true` inside
  the native coordinator.

The October 18 PS host logs show game ticks and updates advancing throughout
the stall. That makes a global GTA update freeze unlikely, but it does not
prove the *audio coordinator's separate worker* was running or that
`HasBufferedAudioForTurn` was false.

**Unresolved causal distinction:** native `StreamEnded` could remain false,
the mixer could continue reporting buffered audio, or the coordinator worker
could fail to process an otherwise eligible completion. A static DLL inspection
cannot decide which occurred at 11:19:56.

## New bounded native playback audit

The existing promoted-character voice-presence observer was in
`mode=shadow`, `level_log=off` during the October 18 reproduction.
The repo already has public getters for `NpcSpatialAudio.IsAudibleAudioPlaying`
and `HasBufferedAudioForTurn`, and already subscribes to exact native
`PlaybackStarted`/`PlaybackEnded` events.

This PR adds an automatic *diagnostic only* `[VP] playback_pending_audit`
event for lingering exact native turns: **after 8 seconds**, no more than
one sample per 5 seconds, maximum 12 samples per turn, only for an active
promoted-character observer in `shadow`/`on` mode. Nothing is polled for
ordinary short speech when level logging/mouth animation are disabled.

Each sample records bounded flags from existing side-effect-free public
getters: `speaking`, `audible`, `turn_buffered`, `read`, `rms`,
plus generation and observed elapsed time. A pinned-layout **read-only**
probe additionally consults `NpcAudioTurn.StreamEnded`,
`PlaybackStarted`, `CompletionEmitted`, `Cancelled`, and native game
time fields under the coordinator's own lock using nonblocking
`Monitor.TryEnter`. It verifies field tokens/types and exact
ped/turn/generation identity and examines at most 64 turns. Missing fields,
lock contention, version mismatch, or errors emit an explicit unavailable
status, never a fabricated state.

Use companion EOS timestamps and these native samples together:

| Native audit | Interpretation |
|---|---|
| `stream_ended=0` long after companion EOS | investigate bridge delivery/rejection of `MarkStreamEnded` |
| `stream_ended=1 turn_buffered=1` after expected drain | mixer/drain or device-consumption path remains outstanding |
| `stream_ended=1 turn_buffered=0 completion_emitted=0` with elapsed game-time beyond expected end | coordinator worker/check or another completion guard is blocking |
| `completion_emitted=1` but companion has no `native_playback_ended` | event-to-bridge/ACK correlation loss |
| `native_turn=layout_unavailable` / `lock_busy` | indeterminate; the probe cannot establish the cause |

**These are hypotheses for triage, not automatic success criteria.** A response
can legitimately run longer than eight seconds. Neither silence nor
time alone commits dialogue history; this audit never alters playback.

## Why this candidate is limited

The native PCM queue, stream-ended/drain detection and `npcPlaybackEnded` emitter are
implemented inside the pinned binary `LosSantosAlive.dll`. There is **no native PCM queue
getter or buffer-drain status** in the verified protocol-v3 bridge contract. The separate
C# promoted-character addon is an observer and cannot authoritatively commit Essential
speech delivery. Adding a fake completion callback based on elapsed time or detected
silence would corrupt RAM history, emotional continuity and Memory K.

The companion can still safely retire its **original backend turn** if a callback never
arrives. Previously the fallback waited a minimum 60 seconds, even for a 2.96-second
clip. This change calculates an upper **failure recovery window** from the actual
forwarded PCM duration + conservatively reserved entire-duration-after-EOS slack.
The new default is 10 seconds minimum and 12 seconds grace, while respecting explicit
configuration. For the reproduced clip that is 14.96 seconds after EOS.
This does **not** prove native playback finished or fix a broken DLL drain event.

On timeout, exact-turn original state and endpoint readiness are read without mutating
either, and `failMatchingTurn` is invoked through the existing pinned backend path.
The terminal outcome is `playback_ack_timeout` / UNKNOWN and assistant text is
not accepted as spoken. The original turn retirement request is logged; its acceptance
does not certify native playout buffer deletion.

## Diagnosis in subsequent logs

Filter by the exact four-tuple `pedId`, `turnId`, `generationId`,
`sessionNonce`; use the same-run monotonic `elapsedMs`, never cross-process wall
timestamps as an ordering authority.

1. `pcm_first_forwarded`, `pcm_delivery_summary`: payload size and first PCM.
2. `native_playback_started`: first native playout receipt.
3. `native_stream_end_handoff`: producer EOF reached Essential, **not** buffer drained.
4. `playback_watchdog_armed`: total forwarded PCM duration, estimated remaining duration,
   timeout window, and whether native start was acknowledged.
5. `native_playback_ended`: native terminal reason; only `completed` with full receipt
   fields permits speech-history acceptance.
6. `playback_watchdog_fired` and `native_playback_recovery`: missing native callback
   and read-only original turn status, not an invented completion.
7. `native_playback_retirement_requested`: whether the existing original-turn terminal
   transition accepted the cleanup request. It does **not** prove native buffer drain.

Only bounded turn diagnostics are logged; no audio payloads, transcripts, credentials or
per-frame samples are added.

## Verification and remaining acceptance gates

Scoped offline tests cover policy behavior for short and long PCM, missing/duplicate
and wrong-generation receipts, next-turn recovery and history non-commit. CI runs
companion audio/lifecycle tests, JS candidate packaging and the native compile with
pinned references. Passing these proves only the companion changes are safe offline.

**Blocker before merging as a full native completion fix:** Instrument or obtain
authoritative native protocol-v3 playback queue/EOS/drain evidence and verify that
`npcPlaybackEnded(completed)` fires promptly after actual audible drain in GTA V
Enhanced. If the DLL suppresses this callback, the repair belongs at that source,
not in a fabricated companion ACK. The accepted replacement DLL must be compiled
and GTA-tested against the pinned RPH/Essential dependencies.

GTA acceptance: three-second ElevenLabs response, measured completion ACK after
actual drain, owner cleanup, immediate next microphone interaction, uninterrupted
long-form speech, rapid player interruption, and renewed Director spontaneous speech.
