# Perception → conversation pipeline investigation (October 11, 2026)

Branch `investigate/perception-pipeline-20261011`, based on PR #41 (`ad6a8da`).
This is an **offline** investigation and fix set. It has not been deployed and
nothing here is physically validated in GTA. One GTA acceptance session
(section 6) is still required.

Evidence came from the Oct 10/11 `LSA-troubleshooting-logs-*` archives, the
installation backups' `RagePluginHook.log` files, the live
`20261011T142101Z` session, the deployed build manifests, the pinned
Essential DLL (`9b6de42d…`, decompiled read-only) and the public
RagePluginHook 1.124.0 SDK package.

## 1. Confirmed root causes

### 1.1 Spontaneous gunfire speech: PS2 replay ledger saturation

`EpisodeCorrelator` kept every native signal ID for **10 minutes** and refused
every new signal (`dedupe_capacity`) once **1024** IDs were held. A connection
that delivered more than 1024 signals therefore dropped every later signal
silently, gunfire included. You can see this per connection in the companion
logs as `received − ps2Dropped = 1024` exactly:

| Run | Signals received | PS2 dropped | Accepted |
|---|---|---|---|
| 2026-10-11 14:22–14:24Z (live) | 1080 | 56 | 1024 |
| 2026-10-11 14:57–15:00Z | 1224 | 200 | 1024 |

The 14:57Z run is the reported failure: 393 PS3 decisions, 0 eligible and
repeated `no_ps3_response_candidate`. The gunshot came after saturation and
never became an observation. On Oct 10, Director speech worked because it
happened early in short connections, and reconnect churn kept clearing the
ledger.

**Fix:** The ledger keeps entries for 60 s, which is twice the 30 s signal
admissibility window that ShadowRuntime already enforces. Under capacity
pressure (2048 entries) it evicts the oldest entry instead of rejecting the
newest signal. Every PS2 loss is now counted by reason (`ps2Drop*`).

### 1.2 Radio: the optional sound-name read aborted the whole sample

On RPH 1.132, calling `GET_CURRENT_TRACK_SOUND_NAME` **by name** threw
`ArgumentException` (HRESULT `80070057`) on every sample. `ReadRadio` aborted
before it read `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID`, which is the radio v2
catalog key, so no radio edge was ever produced. In the same runtime,
Essential's own `RadioContextProvider` reads the station and the audible text
ID by **universal native hash** and succeeds.

**Fix:** Each radio native is bound by hash first (`0xF6D733C32076AD03`,
`0x34D66BC058019CE0`, `0x50B196FC9ED6545B`, `0xE9EA16D6E54CDCA4`) and falls
back to the name. After 3 consecutive failures a route moves from hash to name
to retired, for the current world epoch only.

- **Station:** required. If it is retired, radio sampling stops. It never
  reports a fabricated "off".
- **Sound name, play time:** optional. A retired read becomes 0.
- **Text ID:** optional. If it is unavailable, the event is station-only and
  the catalog reports the track as unknown.
- A transient failure (before retirement) still aborts that one sample, so
  the tuple cannot flap.

### 1.3 Build: PR #41 does not compile against the pinned RAGE SDK

RagePluginHook 1.124.0 declares `CallByName<T>/CallByHash<T> where T : struct`,
so `CallByName<string>(…)` fails with **CS0453**. Offline tests passed because
`GameStub.cs` declared `CallByName<T>(string, params object[])` without the
constraint. The DLL that was actually deployed came from an uncommitted local
patch: its native source hash was `07ee5399…`, while PR #41's is `1e1c5dc2…`.

**Fix:**
- String reads use the SDK's non-generic `Type` overloads.
- `GameStub` now mirrors the SDK: `NativeArgument`, value-type constraints,
  `CallByHash`, and route-specific failure injection.
- A new CI step, `tools/native-sdk/compileProductionNative.mjs`, compiles the
  **production** plugin and loader against SHA-256-pinned NuGet references
  (RPH 1.124.0, RAGENativeUI 1.9.3, DamageTrackerLib 2.0.0, .NET 4.8.1
  reference assemblies). Verified offline: it fails on PR #41 with CS0453 and
  passes on this branch.

## 2. Contributing and latent defects fixed

4. **Owner-fiber stall wiped perception.** Essential's on-screen text entry
   blocks the shared RPH owner fiber. The native log showed
   `last_update_age_ms=2630` during text input, and the GTA pause menu does the
   same. The companion's 3 s silence rule then reset all PS2/PS3 state and
   churned the pipe. Typed turns then arrived 1.5–1.9 s after the reset and the
   capture failed with `anchor_expired`: at 18:27:06Z on Oct 10, and at
   14:22:25Z on Oct 11 with `missingReason=lease_expired` and
   `resetReason=reset_initialization`.

   **Fix:** a bounded stall.
   - After 1.5 s of silence the lease clock pauses, so anchors and situations
     neither expire nor renew.
   - After 60 s of silence the stream is torn down exactly as before.
   - The PS6 pump refuses to act while stalled (`native_owner_stalled`), and
     player priority stays wall-clock fresh (1.5 s).
   - PS4 capture freshness uses the same bounded window.
   - Native logs `[PS] owner_stall_resumed`.

5. **The Director pump spent evidence on pacing vetoes.** The pump marked a
   decision as attempted *before* admission. Logs show 17
   `not_admitted / scene_or_speaker_cooldown` outcomes, and each one spent a
   valid decision permanently. A 128-entry, 10-minute memory could also
   fail-close the pump.

   **Fix:** a read-only `pacingVeto` pre-check that is identical to
   `reserve()`'s synchronous gates. Cooldown, rate limit and active ticket now
   *defer* the decision (`deferred_*`) while its evidence is still fresh. The
   seen-memory now lasts 60 s, which is 6× the candidate TTL. Admission
   ledgers remain authoritative.

6. **Latent PS3 cliff.** `SalienceCache` kept one ledger entry per evaluated
   observation for 10 minutes and forced `response:none /
   suppression_capacity` on every new decision once 1024 entries existed. The
   logs show 2–3 observations/s, so once fixes 1 and 4 stop the constant
   resets, an ordinary long session would reach this.

   **Fix:** a ledger entry lives for its observation's lifetime plus a 60 s
   acknowledgement grace. Observation IDs are random and never reissued.
   Ten-minute *family* suppression and fail-closed capacity are unchanged.

7. **Native PS3 signal receipts.** The 256-entry table ignored the *newest*
   receipts once full, and it recorded ambient observers that can never
   redeem a receipt (challenges are only issued to owned observers).

   **Fix:** record owned observers only, and evict the oldest entry. Eviction
   can only cause a fail-closed `signal_missing`.

8. **Permanent 512-entry cliffs.** The companion's `retiredTickets` and the
   native `poisonedTickets` each stopped all Director leases after 512
   entries. Both are now bounded LRU sets. Ticket IDs are single-use UUIDs.

9. **Misleading native log.** `director_admission_veto stage=ps3_current
   reason=grant_missing` was printed on every C-06 read, including occupied
   playback stages where the 2 s PS3 grant expires legitimately. Oct 10 had
   16 such lines next to successful deliveries. The PS3 detail is now logged
   only when it is the actual first veto.

## 3. Reviewed and not changed

- **PR #41 retained-target idle.** The logic is sound. A retained selection
  of the *exact* speaker counts as conversation-idle only when every one of
  these independent proofs is idle:
  - the stable re-read,
  - original backend quiet and the player-turn source,
  - mic, text and controls input,
  - Essential turn and playback,
  - owner,
  - reflex,
  - script safety.

  A different or changing target still vetoes, and so do any player input,
  playback, stale or invalid ownership, expired grants and source
  generations. *Hypothesis only:* identity uses CLR wrapper reference
  equality, like the rest of the anchor system. `EntityAnchors.Retain`
  retires on a wrapper mismatch, and 111 turn-actor captures produced zero
  `lifetimemismatch` retirements, so wrappers appear canonical in practice.
  If GTA shows `conversation_busy` while Nathan is the selected target, the
  hardening would be handle + memory-address identity, as in
  `DrainDirectorCorePlayback`.
- **Another NPC selected vetoes Director speech.** This is conservative by
  design.
- **Damage callbacks carry no bystander witness evaluation.** Bystander
  gunfire witnessing comes from the `IS_PED_SHOOTING` sampling (top 9 sources
  every 50 ms) and the line-of-sight budget (8 per Update).
- **Radio hearing requires the same vehicle.** Exterior hearing is
  `radio_exterior_unverified`.
- **ObservationStore per-observer cap (128) is fail-closed.** It was not hit
  in the logs. It is now visible as `ps2DropObservationRejected`.
- **Strict frame validation.** One malformed frame causes a sequence-gap reset
  and a reconnect, by design. This branch adds **no wire changes**, but native
  and companion must still ship as one matched build (the native source hash
  is verified at build time).

## 4. Diagnostics guide

All new lines are rate-bounded and use closed vocabularies. They contain only
counts, fixed tokens and `trace=<10 hex>`, which is the first 40 bits of
SHA-256(`lsa-trace-v1:`+random signal ID). The same code appears in the GTA log
and in the companion log. No refs, Ped handles, transcripts, audio, model
content or song text are logged.

Native `RagePluginHook.log`:

- `[PS] event_trace kind=firing|death|injury_state trace=… owned_witness=… witnesses=n`
  - Logged when the signal is sent; at most 8 owned and 4 other lines per 10 s.
  - `owned_witness` is the best outcome across owned observers. Values:
    `witnessed`, `self`, `out_of_range`, `los_budget`, `not_live`,
    a WitnessPolicy reason (`visual_blocked_or_outside_cone`,
    `different_interior`, `auditory_out_of_range`, `acoustic_path_blocked`, …),
    `read_failed`, `not_evaluated`, `no_owned_observer`.
- `[RADIO_PROBE] … routes=station/sound/text/playtime trace=…`
  - Values for each route: `hash`, `name` or `unsupported`.
- `[PS] radio_native_route native=… route=…`
  - Logged once when a route moves to its fallback or is retired.
- `[PS] radio_read_failure stage=… type=… route=… count=… hresult=…`
- `[PS] owner_stall_resumed gap_ms=… count=…`
- `[PS] director_admission_veto stage=… reason=… [detail=ps3 failure] [trace=…]`
- `[PS] director_handoff … [trace=…]`
- `[PS] shadow … radio_routes=… event_trace_suppressed=… owner_stalls=count:maxMs`

Companion `logs/e1-run-*.jsonl`:

- `perception_trace`: `traceCode`, `signalKind`, `producer`, `receipts`,
  `selfReceipts`, `qualified`, `ownedQualified`, `ownedObservers`,
  `ps2` (`accepted|unwitnessed|duplicate|dropped`), `ps2Reason`,
  `observations`, `ownedObservations`,
  `ps3Owned` (`urgent|eligible|none|not_evaluated`), `ps3Reason`.
  At most 20 owned and 6 other events per 10 s.
- `radio_trace`: the same fields plus
  `catalog` (`known|unknown|mismatch|off|stopped|invalid`).
- `director_gate`: adds `native_owner_stalled` and
  `deferred_scene_or_speaker_cooldown|deferred_rate_limited|deferred_ticket_already_active`.
- `director_candidate`: adds `traceCode` and `urgency`.
- `intelligence_status`: `stage=owner_stalled|owner_resumed`, with `durationMs`.
- `companion_shadow` (every 10 s) adds:
  - `ps2OwnedWitnessed`, `ps2DedupeEvicted`, `ps2Drop*`,
  - `ps3OwnedDecisions/Eligible/Urgent`,
  - `radioChanged/Stopped/Known/Unknown/Mismatch/Off/Observations/OwnedObservations`,
  - `nativeRadio*`, `nativeWitness*`,
  - `ownerStalls`, `ownerStallMaxMs`,
  - `traceEmitted`, `traceSuppressed`.
- `knowledge_frame_projected` adds `captureEventRadio`, `selectedRadio` and
  `radioQuestion` (a boolean: was this a direct radio question).

How to tell the six failure cases apart:

| Question | Look for |
|---|---|
| Gunshot Nathan never witnessed | native `event_trace owned_witness≠witnessed` (reason); companion `perception_trace ownedQualified=0` |
| Witnessed, rejected by PS3 | `perception_trace ownedObservations≥1 ps3Owned=none ps3Reason=…` |
| Valid candidate rejected by Director | `director_gate deferred_*`/`native_owner_stalled`, or `director_candidate status=not_admitted/native_rejected/stale_* traceCode=…` joined to native `director_admission_veto … trace=…` |
| Admitted turn failed in generation/playback | `director_candidate status=incomplete_intake/not_delivered`, `director_handoff` stage/code, native `director_handoff stage=native_playback` |
| Radio native unsupported/invalid | `radio_native_route`, `radio_read_failure … route=…`, `[RADIO_PROBE] routes=…`, companion `nativeRadioFailures` |
| Valid radio signal missing from Nathan's context | `radio_trace catalog=known ownedObservations≥1`, then the turn's `knowledge_frame_projected`: `captureEventRadio=0` means it was lost before the turn; `radioQuestion=false` means it was not selected by design; `radioQuestion=true` with `selectedRadio=0` means a selection defect |

## 5. Offline verification

- **Node suite:** 790 tests, 789 pass, 0 fail, 1 skipped (same counts as
  the baseline). Four existing tests were updated because their expectations
  changed on purpose:
  - 3 s silence no longer wipes state; leases age in native-active time.
  - The telemetry projection has new keys.
- **Production native plugin and loader** compiled against the real pinned
  SDKs on this branch. The same gate reproduces CS0453 on PR #41.
- **Native test projects** compile against the SDK-faithful stub. Running them
  needs Windows named pipes (PipeSecurity ACL), so they run in Windows CI, not
  under Mono.
- **Trace codes** are identical in JS and C#.
- **Ad-hoc smoke run:** after 2,100 earlier ambient signals, a witnessed
  gunshot gives an owned PS3 decision of `eligible` with
  `safety_nearby_threat` (the old code dropped it). A 10 s owner stall keeps
  all state; more than 60 s of silence resets.
- No new regression tests were added in this branch (at the owner's request,
  to limit usage).

## 6. One-session GTA acceptance

1. Build both layers from the same commit. Check that `intelligenceSourceSha256`
   matches between the native and companion manifests. Keep the existing
   radio and Director opt-ins.
2. **Radio:** with Nathan as a passenger and a known song playing, check:
   - `[RADIO_PROBE] … text_id≠0 routes=hash/…`;
   - companion `radio_trace catalog=known ownedObservations=1`;
   - when you then ask "what song is this?": `radioQuestion=true` and
     `selectedRadio=1`.

   Then change station, turn the radio off, and exit the vehicle.
3. **Typed turn:** type for more than 5 s right after a witnessed event. Check
   for `owner_stalled`/`owner_resumed`, no `resetTimeouts` increase, and a
   non-empty capture.
4. **Gunfire:** play long enough to pass 1,100 received signals, then shoot
   near Nathan. Check that:
   - `perception_trace` has `ps3Owned=eligible` or `urgent`;
   - `director_candidate` shares the same `traceCode` as the native
     `event_trace`;
   - speech plays (`delivered`).

   Repeat during the cooldown window: you should see `deferred_*`, then an
   attempt.
5. Check that active mic, typing, playback and another selected NPC still
   veto Director speech.

## 7. Requires real GTA evidence

- Hash routes on RPH 1.132 / GTA Enhanced 1.0.1158.16, and whether
  `GET_CURRENT_TRACK_SOUND_NAME` works by hash.
- That a text-entry stall stays under 60 s in normal use, and that the native
  owner fiber resumes right after entry.
- Director speech end to end on the exact installed payload, including
  PR #41's retained-target path.
- Witness geometry and line-of-sight budget behavior in dense scenes. The new
  traces will show this.
