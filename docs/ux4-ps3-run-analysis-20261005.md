# UX4 shared Talk + PS3 follow-up run analysis — October 5, 2026

## Assessment
The shared Mouse4 UX4 path worked for three ordinary microphone turns, and the PS3 history-pressure fix was exercised successfully. All three replies completed. Direct native damage callbacks remain unverified and recorded zero invocations. Multi-target cycling, vehicle occupants, interruption races, and suppression/consumer acknowledgements were not established by this session.

## Evidence
Latest operational run: ce1a55c2-718a-4469-aa7f-daee720f965b, file e1-run-20261005T211005Z-ce1a55c2-718a-4469-aa7f-daee720f965b.jsonl. Dialogue trace: e1-run-20261005T211005Z-47551189-61cf-4cc7-8623-bdc805cf7324.jsonl. Native evidence: RagePluginHook.log.

Operational timestamps span 5:10:05–5:12:50 PM EDT. Native updates continue through 5:12:38 PM. There are 227 valid operational records with consecutive sequence numbers and 45 valid dialogue records. Sixteen companion reports were persisted: fifteen periodic reports, spaced almost exactly ten seconds apart, and one final disconnect snapshot. All 74 currently installed deployment-manifest files match the c8df99b hotfix payload. This confirms the current installed files, while the native startup entries independently demonstrate the new shared-input behavior in this run.

## UX4 behavior observed
Harmony input interception logged installed=True. The loader then reported:

`[UX4] talk_target input=ready key=Mouse4 mode=shared_essential`

Three native generations were accepted, with matching loader releases and native stops:

| Generation | Native commit | Loader release | Native stop | Hold-to-start latency |
|---|---|---|---|---:|
| 1 | 5:10:39.269 | 5:10:40.675 | 5:10:40.709 | 284 ms |
| 2 | 5:10:54.758 | 5:10:55.719 | 5:10:55.746 | 276 ms |
| 3 | 5:11:11.167 | 5:11:11.822 | 5:11:11.849 | 268 ms |

Native stop followed loader release by 27–34 ms. There were exactly three server captures, three authorization acceptances, three playback starts, and three playback completions. No extra generic Talk turn was recorded alongside those UX4 holds. This supports successful suppression of duplicate stock Talk input during the observed interactions; it does not prove every input race is covered.

Selection-only events at 5:10:35.208 and 5:10:46.317 did not immediately open the microphone. The next capture began only with a later accepted hold. Selection expiry was logged near its configured eight-second limit. All selection entries reported index=1,count=1. Therefore this run demonstrates selection and repeated holds for one candidate, but not cycling between multiple candidates or choosing a farther NPC over a nearer one.

All three turns remained bound to ped 00041902. Playback completed and assistant history committed once per turn. Each terminal summary reports traceComplete=true and droppedTelemetryRecords=0. No invalid transcription, provider failure, playback timeout or interrupted turn was recorded; all nine STT/model/TTS attempts succeeded. From capture-stop to playback-start, measured delays were 5.165, 3.602 and 3.359 seconds. These are response delays, separate from the 268–284 ms hold-to-microphone latency.

The third turn validated and dispatched followtarget once with native acceptance. A native takeover entry and one action callback followed. This establishes dispatch/acceptance and observed action activity, without proving sustained following or physical completion. Selection logs do not include a ped/decision identity, so telemetry alone cannot independently verify that a visually highlighted NPC was the one addressed; the stable turn identity is useful supporting evidence.

## PS3 and history-pressure results
Final cumulative snapshot:

| Counter | Value |
|---|---:|
| Received signals | 767 |
| PS2 correlated | 196 |
| PS2 witnessed observation outputs | 380 |
| PS3 decisions | 380 |
| Urgent / eligible response labels | 9 / 37 |
| Memory-stage labels | 26 |
| PS3 faults / suppressed | 0 / 0 |
| Companion dropped / PS2 dropped | 0 / 0 |
| Stale / malformed / duplicate / gaps | 0 / 0 / 0 / 0 |
| Incoming signals expired | 0 |
| History evicted / expired / skipped | 147 / 225 / 0 |
| History high-water | 200 |
| Self-danger / player-harm / nearby-threat reason counts | 9 / 17 / 121 |
| Novelty escalation reason count | 3 |

Witnessed observation outputs equal PS3 evaluations in every recorded report. Counts represent cumulative evaluations, not necessarily distinct incidents or characters. Memory-stage labels do not establish persisted memories. Reason counters may overlap; they do not have to sum to urgent/eligible totals.

The earlier run had fourteen companion admission drops under retained-history pressure. Here history eviction first appeared at 5:11:45, rose to 147, and processing continued to 767 received signals and 380 decisions while admission-drop counters stayed zero. Source inspection confirms semantic processing occurs before diagnostic-history retention. This session therefore exercises the fix under real history pressure, rather than merely observing no drops during an idle run. The history remained bounded; its high-water of 200 includes critical records alongside the 192 noncritical retention allowance.

Native host health remained good through the last sample: 5,516 updates called and 5,516 completed, with matching identity update completion and no identity update failure. Observer count reached the supported sixteen-observer limit without a recorded capacity reset. Native sampled drop/stale counters stayed zero.

## Remaining damage issue
Ped, player and vehicle damage callback counters stayed zero in every periodic report and every native sample. Native signal totals nevertheless reached 26 firing events, 36 injury-state events and 11 death events, alongside vehicle-state and transition activity. Those state/shooting producers operate independently of direct damage callbacks.

This reinforces the need for a controlled callback investigation. PS3 safetyPlayerHarm advancing does not prove a player-damage callback fired. The callback implementation increments its counters before payload filtering, so downstream PS2 rejection cannot alone explain the zero invocation counts. These logs do not identify whether the remaining cause is service subscription, assembly/domain identity, tracked-victim coverage, or another producer condition. No change to damage subscriptions should be claimed as validated here.

## Session retirement and shutdown
At 5:12:08.351 the identity binding retired with owner_retired, and a session_closed bridge event followed. Native logs at the same time show dead ped 00041902 released. Source inspection shows bridge_disconnected here is emitted when an individual provider connection detaches, so this entry is consistent with the conversation actor dying. It is not evidence that the entire intelligence channel failed: PS3 reports and native host updates continued afterward.

At 5:12:43.560 the finalSnapshot=true report recorded resetTimeouts=1, then intelligence disconnected and attempted one reconnect. Native logs had stopped roughly five seconds earlier. This ordering is consistent with the factual stream ending around game exit, although there is no explicit graceful process-shutdown record proving the exit cause.

The final report preserves cumulative PS2/PS3/history totals, but timeout reset clears the anchor roster and native diagnostics before the close handler emits that report. Consequently final anchors/retainedSignals are zero and final native diagnostic fields fall back to zero. This is a remaining observability limitation: the final snapshot does not preserve the last native diagnostic state after timeout. Earlier periodic/native samples, rather than those final fallback zeros, support the callback/drop conclusions above.

Optional LSPD First Response integration still failed to initialize because its expected assembly was unavailable. The principal LSA/UX4/PS3 paths continued; LSPDFR behavior is not validated by this session.

## Next acceptance checks
- Controlled damage to player, tracked NPC and vehicle, with service/subscription and callback evidence.
- Two or more selectable NPCs: tap cycling, farther highlighted target, vehicle driver/front/rear passengers, and visual bracket confirmation.
- Release/focus-loss/menu/target-loss races and temporarily disabling UX4 while Mouse4 is held; confirm stock Talk resumes cleanly without duplicate capture.
- Preserve last native diagnostics before timeout reset, or explicitly mark them unavailable in the final snapshot.

No implementation, configuration or deployment changes were made for this analysis. Dialogue text and credentials are omitted from this report.
