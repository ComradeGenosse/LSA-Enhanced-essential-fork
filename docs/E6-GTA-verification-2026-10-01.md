# E6 GTA verification review — October 1, 2026

Run: `6b07b57a-e36d-494a-89df-10e5c487564e`. Log: `e1-run-20261001T235805Z-6b07b57a-e36d-494a-89df-10e5c487564e.jsonl`.

The repaired response/audio path works in this run. All 13 microphone turns reached native audio authorization and playback. Ten completed; three ended with native reason `cleared` and were classified as interrupted. The user confirmed hearing replies and deliberately interrupting some. There were no STT, model, TTS, authorization, or watchdog failures.

E6 synthesis overlaps the model on eligible dialogue-only turns, but this sample does not demonstrate speech playing before model completion or a multi-segment utterance. Every response contained exactly one segment.

## Observed results

| Check | Result |
|---|---|
| Log integrity | 774 records; continuous sequence; no malformed lines, truncated tail, or dropped records |
| Input coverage | 13 microphone turns; one NPC, one session; generations 1–13 |
| Provider operations | 13 STT + 13 model + 13 TTS; all HTTP 200 and finished; no retries |
| Native audio | 13 authorizations accepted, 13 playback starts, 13 stream-end handoffs, 13 playback ends |
| Completed history | Ten replies committed once, after matching native playback completion |
| Interrupted history | Turns 1, 3, 4: assistant replies discarded; player input retained |
| Dialogue-only early TTS | Eight turns started segment synthesis before the model-finished record |
| Buffered action path | Five action turns began TTS after model completion and stock decision validation |
| Segment count | One per turn; 15–80 characters |
| PCM accounting | 1,872,000 bytes total (39.0 seconds of 24 kHz mono PCM16); each turn aligned and below the limit |
| Lifecycle checks | No duplicate authorization/end/terminal/history commit and no ordering violation among recorded lifecycle events |

## Latency and the E6 performance limit

On the eight dialogue-only turns, TTS requests started 103–183 ms before the model-finished record. First forwarded PCM still arrived 127–651 ms after it. Native playback began after model completion on all 13 turns.

From microphone release/input readiness to native PlaybackStarted, nearest-rank median was 2.57 seconds; range 2.04–4.99 seconds. These timings exclude the player's recording duration and include STT.

Across all 13 turns, median STT request time was 0.66 seconds, model request time 1.44 seconds, TTS time to first byte 0.48 seconds, and native authorization 15 ms. These are separate stage distributions and should not be summed as an exact median total.

Inference: one short segment leaves only about 0.1–0.18 seconds of model work to overlap, while first TTS audio takes longer to arrive. The early scheduling path is working, but this run supplies no evidence of a dramatic audible latency reduction or of playback across segment gaps. No sequential comparison with matched prompts was performed.

## Actions and native corroboration

The stock route accepted FollowTarget (turn 3), EnterDriverSeatOfTargetVehicle (5), ResumeActivity (9), FollowTargetVehicle (10), and WaitHere (12), once each. All five remained behind the final model/stock validation barrier. Action acceptance alone does not establish completion of every world action.

The same-run RagePluginHook log adds native evidence: vehicle entry completed and the NPC was confirmed seated; ambient driving resumed; vehicle following started; and WaitHere interrupted ambient driving. It also records the ped being marked at 19:59:01. The JSONL source remains `player_mic`, so it cannot separately count ordinary Talk versus marked-ped Talk.

## Turn detail

| Generation | Outcome | Path | Segment chars | TTS head start (ms) | Release to playback (s) |
|---:|---|---|---:|---:|---:|
| 1 | playback_interrupted | early dialogue | 80 | 119.2 | 3.30 |
| 2 | completed | early dialogue | 57 | 102.6 | 3.15 |
| 3 | playback_interrupted | buffered action | 19 | -1.5 | 2.57 |
| 4 | playback_interrupted | early dialogue | 52 | 114.7 | 3.12 |
| 5 | completed | buffered action | 15 | -1.4 | 2.32 |
| 6 | completed | early dialogue | 67 | 129.8 | 2.41 |
| 7 | completed | early dialogue | 40 | 109.3 | 2.28 |
| 8 | completed | early dialogue | 47 | 182.8 | 2.04 |
| 9 | completed | buffered action | 26 | -0.7 | 4.99 |
| 10 | completed | buffered action | 32 | -0.9 | 2.15 |
| 11 | completed | early dialogue | 31 | 141.3 | 3.02 |
| 12 | completed | buffered action | 25 | -0.7 | 2.39 |
| 13 | completed | early dialogue | 40 | 137.0 | 3.03 |

Positive head-start values mean TTS began before the model-finished record; negative values mean it began afterward.

## Remaining acceptance checks

Normal in-game voice response, single-segment early TTS scheduling, buffered actions, native playback completion, history commitment, and interruption cleanup now have live evidence. There is no new provider/code failure evident in this sample.

The next controlled test should produce a dialogue-only reply with at least two complete segments, allow one utterance to finish, then interrupt another during its first segment and follow up. Confirm first native PCM before model completion, serial segment order, any inter-segment gap staying within one authorization/stream, one final handoff, and no stale PCM/history in the following generation.

Typed input, two-NPC identity isolation, disconnect/reconnect, and injected late provider failure were not exercised in this run. The earlier Phase 10B stream-gap evidence and offline E6 tests remain separate supporting evidence. Do not mark the entire E6 acceptance gate complete from these 13 single-segment microphone turns.

All telemetry lifecycle checks are limited to recorded events: PCM chunk identities and individual PCM gap timing are not emitted per chunk. Thirteen `late_event_ignored` records contain no original event type; they do not by themselves establish stale audio delivery or a new defect.

The current installed E1 manifest identifies source tree `78dc5318bb79b945d683498531788523ee0cb426c4c4716e07db2474cf0027d9`, the deployed telemetry repair. The run header records the pinned bundle and DLL hashes; it does not separately record the E1 source-tree hash.
