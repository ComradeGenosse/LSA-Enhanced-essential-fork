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
