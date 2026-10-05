# GTA PS3 logging session review — October 5, 2026

> **Follow-up note:** this is the first PS3 logging session. Its retained-history admission-drop finding was fixed afterward. The later [combined UX4/PS3 run](ux4-ps3-run-analysis-20261005.md) exercised the fix under real history pressure with zero companion/PS2 admission drops. The direct damage-callback question remains open.

## Conclusion
The corrected PS3 shadow pipeline loaded, initialized, processed live observations, and persisted its new telemetry successfully. This session establishes live PS3 evaluation and JSONL persistence. It does not establish complete PS3 acceptance: companion capacity drops occurred, native damage callbacks were absent, and suppression/consumer acknowledgement were not demonstrated.

## Evidence and session scope
Reviewed the latest RagePluginHook.log plus the operational and dialogue JSONL files named e1-run-20261005T190811Z (operational run f41bfe8d-872d-4cf9-a071-1d26e05fb4db). Operational logging spans 3:08:11–3:10:34 PM EDT. The active bridge closed at 3:10:25 PM, giving approximately 2 minutes 14 seconds of companion runtime. These are the latest files present; no longer session was found.

The operational file contains 182 valid JSON records, consecutive sequences 1–182, and 13 companion_shadow reports. Reports are spaced approximately 10.06–10.09 seconds apart. All three dialogue turn terminal summaries report traceComplete=true and droppedTelemetryRecords=0. Those logging-loss counters are separate from the perception signal drops below.

## Startup and host health
- RPH launched the installed LosSantosAliveServer/server.bundle.mjs. Its logged bundle hash matches the deployed bundle: 7b4d461fe14976cd454be4babc0d84c1b350d4753ff378e681e819a02a934cde. This identifies the bundle; it alone does not hash every external module.
- Two initial intelligence connection attempts closed before the native endpoint became ready. The third connected at 3:08:13.856 and initialized at 3:08:13.868. No further intelligence disconnection occurred during active gameplay.
- The reset counter remained 3 throughout all 13 reports. Source inspection explains this as two socket-close resets plus the accepted hello reset; it is not evidence of three gameplay failures.
- Intelligence, character profiles, session identity, interop, bridge, controls and action registration initialized.
- Final sampled host status: 3,991 update calls and 3,991 completed updates; identity updates likewise all completed. Creation/update thread identity stayed consistent. No host shutdown or identity update failure was reported during gameplay.
- Last native snapshot: 63 anchors, 10 observers; zero native dropped or stale events. Snapshot cadence approximately 200–222 ms in steady state. Native update timings after initial discovery were generally hundreds of microseconds to about 1.1 ms; these sparse samples do not establish frame-time performance for the entire session.
- Missing optional LSPD First Response assembly caused its integration to fail initialization. The main LSA/PS pipeline continued. This session does not verify LSPDFR integration.

## Live PS2 and PS3 results
Last saved companion sample, 3:10:22.827 PM:

| Counter | Value |
|---|---:|
| Received signals | 611 |
| Retained signals (queued) | 182 |
| Companion dropped | 14 |
| Expired signals | 277 |
| Stale / malformed / duplicate / sequence gaps | 0 / 0 / 0 / 0 |
| PS2 correlated | 206 |
| PS2 witnessed observation outputs | 333 |
| PS2 duplicates / dropped | 0 / 0 |
| PS3 decisions | 333 |
| PS3 urgent | 7 |
| PS3 eligible | 30 |
| PS3 memory-stage labels | 25 |
| PS3 suppressed / faults | 0 / 0 |

PS3 decisions equal witnessed observation outputs in every recorded sample. This is strong evidence that live PS2 observations reached the PS3 evaluator without recorded evaluation exceptions. These counters are cumulative evaluations, not necessarily distinct NPCs or unique incidents. Urgent and eligible response classifications are separate; memory staging may overlap either. Memory-stage labels do not represent persisted memories or completed writes.

Native signal counters reached: activity_changed 390, presence_changed 81, location_changed 13, vehicle_state 56, action_callback 1, firing 17, injury_state 17, death 4, vehicle_transition 4. Routine activity produced no eligible/urgent/staged classifications early in the session; those classifications increased once firing/injury/death signals appeared. Aggregate reports cannot attribute an individual urgent decision to a particular event or NPC.

## Finding 1: companion capacity drops
Companion dropped increased from 0 to 14 between 3:09:22 and 3:09:32, then remained 14. There was no accompanying reset, malformed-frame count, sequence gap, stale rejection, or native dropped count.

Source inspection shows ShadowRuntime retains raw signals for up to 30 seconds. It rejects new noncritical signals when 192 noncritical records are retained, and bounds all retained signals at 256 with room reserved for critical signals. Anchor-conflict drops would reset the runtime; that did not happen here. The evidence therefore points to the retained-signal capacity policy, rather than connection or JSONL loss. Ten-second samples cannot reveal the exact peak occupancy or identities of the 14 lost signals.

This matters: the capacity rejection happens before EpisodeCorrelator and PS3 evaluation. Some signals were therefore excluded from downstream processing. Zero ps2Dropped does not contradict this, because that counter is incremented only after signals reach the correlator. The queued metric is a retained TTL history, not a pending work queue waiting to drain. Expired=277 reflects TTL ageing and is not itself an error.

## Finding 2: damage callback path remains unproven
Native ped/player/vehicle damage callback counters stayed zero throughout the session despite firing, injury-state and death activity. DamageTrackerService was logged as started and native diagnostics advertised damage capabilities.

Source inspection shows the callback counters increment at callback entry, before payload validation. Zero callbacks therefore cannot be explained solely by PS2 filtering or rejection of a malformed damage payload. Injury and death can come from sampled state and do not prove the damage callback path worked. The logs do not establish why callbacks were absent, whether the observed injuries involved tracked victims, or whether every damage category was exercised. They also do not prove an assembly-domain or subscription defect; those are investigation targets, not confirmed causes.

A controlled damage probe should distinguish player, tracked NPC and vehicle callbacks while recording the service/assembly/subscription state. This is the most important remaining producer verification.

## Dialogue and action behavior
Three manually initiated capture/turn lifecycles were recorded:
1. STT, reasoning, TTS and native authorization succeeded. Native playback started, then ended with reason cleared/interrupted. Assistant history was discarded rather than committed. A listener replacement followed immediately. This demonstrates interruption cleanup, but the logs alone cannot determine whether the clearing was intended by the player.
2. STT failed with invalid_transcript; the turn cancelled without committing assistant history. Source permits this code for an empty or over-8,000-character transcription. The logs do not distinguish those causes. No HTTP error status was recorded, and a later turn succeeded, so this was not a persistent provider outage.
3. STT, reasoning, TTS and playback completed. followtarget was validated and dispatched once with native acceptance; assistant history committed after playback completion. The RPH log recorded the corresponding on-foot takeover, and the perception layer observed one action callback. Dispatch acceptance does not alone prove sustained following over time.

There were six successful provider attempts and one failed STT attempt. Late events were ignored after listener replacement/session closure. No recorded playback watchdog timeout or PS3 exception occurred. Normal manually initiated dialogue/action behavior coexisted with shadow evaluation; PS3 labels themselves do not authorize dialogue or actions.

## Shutdown and remaining observability limits
The bridge reported session_closed at 3:10:25, identity evidence retired, and intelligence disconnected at 3:10:26. The companion retried once and disconnected again at 3:10:34. This ordering is consistent with endpoint shutdown; the logs do not prove the reason GTA closed or a fully graceful process exit. The RPH file ends at 3:10:17 and there is no final PS3 summary at shutdown.

The final PS3 counters are sampled about 2.4 seconds before bridge closure. They may omit the last few seconds. Current persistent projection omits decision reasons/event categories, acknowledgement outcomes, damage callback counts and drop reasons, even though some of these are available in the richer console/native diagnostics. Suppressed=0 means this session did not demonstrate suppression; it does not prove suppression is broken. Consumer delivered/rejected/expired acknowledgement and stale-decision-key behavior remain offline-tested, not established here. Player-speech witnessing and authenticated relationship/trait context remain gated.

## Follow-up implementation

PR #14 (`fix/ps3-runtime-observability-followups`) addresses the code/observability findings that can be corrected without guessing at GTA runtime behavior:

- Retained raw-signal history no longer gates semantic admission. Valid signals reach PS2/PS3 first; the diagnostic history then rotates noncritical entries or, if all retained entries are critical, skips only the retained copy.
- Harmless retained-history ageing is counted separately from truly expired incoming signals.
- PS2 and PS3 diagnostics remain process-cumulative across intelligence reconnect/reset boundaries, avoiding mixed reset semantics in comparisons.
- JSONL `companion_shadow` records now include retained-history high-water/eviction/skip counters, reset/drop reasons, native drop/stale diagnostics, separate ped/player/vehicle damage callback totals, selected PS3 reason counters, and a final disconnect snapshot.
- The DamageTracker callback implementation itself is deliberately unchanged. Zero live callback counts still require the controlled player/NPC/vehicle damage probe before any subscription/startup fix is justified.

The changed production modules pass Node syntax checks and an isolated logic harness covering retained-history rotation/skip behavior, cumulative reset diagnostics, and the expanded scalar telemetry projection. This is focused verification only; the previous 387-test / 12-native-suite matrix remains the last full-suite baseline until a complete run is performed on the PR branch.

## Recommended next work
1. Investigate native damage callbacks with controlled tracked-victim probes.
2. Add bounded drop-reason/high-water counters and separate retained-history capacity from pre-correlation rejection, if full processing under this load is required.
3. Persist scalar damage diagnostics, decision category/reason counts and a final summary so the next acceptance pass can distinguish those cases directly.

No code, configuration or deployment files were changed during this review. No GTA launch or new tests were run.
