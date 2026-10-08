# CGE GTA validation plan

The standard is physical behavior, not merely "native command accepted."

## 1. Evidence

For each phase collect RAGEPluginHook.log, CGE telemetry, exact config, commit SHA, a short visible-behavior note, and video where logs cannot prove animation behavior.

Offline tests never count as proof of physical gaze.

## 2. CGE0 probe matrix

| Case | Gaze visible | Locomotion preserved | Scenario preserved | Releases cleanly | Notes |
| --- | --- | --- | --- | --- | --- |
| stationary on foot |  |  | n/a |  |  |
| walking |  |  | n/a |  |  |
| ambient scenario |  | n/a |  |  |  |
| passenger |  | n/a | n/a |  |  |
| driver |  | driving preserved | n/a |  |  |
| player moves behind |  |  |  |  |  |
| target disappears | n/a |  |  |  |  |
| 150 ms refresh for 30 s |  |  |  |  |  |

Any disruptive case is removed from the CGE1 allow-list.

## 3. CGE1 staged acceptance

### Early 10a — playback-only, C-01 absent

Disable/unavailable C-01 and proximity hearing. Delay provider/STT before actual NPC audio: no player-listening acquisition is allowed. At exact playback start, validate ordinary on-foot speaker/target; Essential's own visible gaze wins and CGE issues zero competing commands. Only a proven gap may use finite supplemental head/eye gaze. Interrupt/end/reset/retire releases its key; a late end for A cannot clear B. Test callback duplicates/missing-terminal watchdog and uncertain ownership. No broad clear, body-turn or fabricated speech/hearing receipt.

Pass gate MP10a with master A23/A24/A41/A42. Stock gaze coexistence proof does not certify an untested supplemental driver.

### Later 10b — source-time player listening

Requires accepted C-01 lifecycle and MP10a. Proximity transcript processing may remain off. The listening cases below apply only to 10b, with A19/A20/A43 and MP10b.


### A — basic listen/respond

1. Select an ordinary human NPC.
2. Start PTT about 2–4 m in front.
3. Move a few steps left/right while speaking.
4. Release PTT.
5. Let the NPC answer.
6. Remain quiet until release.

Pass:

- attention begins close to speech start, not after STT/model completion;
- NPC tracks lateral movement;
- NPC stays engaged while audio plays;
- no visible refresh flicker;
- release occurs after the configured hold;
- no frozen ped/lost unrelated task;
- no refresh after release.

### B — target switch

Talk to A, switch current conversation target to B, then talk to B.

Pass: A stops receiving CGE refreshes before B starts; no handle-only stale association; B acquires normally.

### C — cancellation/interruption

Interrupt/supersede an NPC response through normal LSA behavior.

Pass: matching playback interruption ends NPC-speaking engagement; no long stale gaze; existing LSA cancellation semantics remain unchanged.

## 4. Safety cases

Test death, ragdoll, vehicle enter/exit, excessive distance, world/session transition, save/load or game-clock reset, mission/cutscene gate, and handle reuse if reproducible.

Every case passes only if CGE stops mutation, never broad-clears tasks, never takes down P2/PS, and leaves dialogue/action systems functional.

## 5. CGE2 body-turn acceptance

Whole-body orientation belongs to separately accepted ACT3 `stop_and_face`, never CGE. These historical cases apply only to that ACT handoff after CGE1; they are not a 10a/10b gate.

- Front-to-side around 50 degrees: head only; no needless foot shuffle.
- Side hold beyond enter angle: after dwell, one smooth turn request.
- Threshold oscillation: no twitch loop.
- Behind and stationary: eventually reorient if safety allows; otherwise safely stay head-only.
- Walking/following: do not steal locomotion.
- Driver/passenger: zero body-turn requests.

## 6. Soak

Run a normal play session with repeated conversations and target switches.

Watch for stuck gaze, increasing native calls, refresh spam, epoch leaks, task cancellation, vehicle regressions, P2 follow/wait regressions, PS sampling regressions, and mission/cutscene issues.

## 7. Timing targets

| Metric | Initial target |
| --- | --- |
| actual playback start -> engagement/control decision (10a) | <= 250 ms; command only if proven unowned |
| player speech start -> first gaze command (10b/C-01) | <= 250 ms |
| target movement -> gaze refresh decision | <= 250 ms |
| sustained off-axis -> body turn request | configured dwell +/- one update |
| conversation end -> release start | <= 250 ms |
| release start -> no further refresh | releaseHoldMs + one refresh interval |

These are command/control targets, not claims about GTA animation blend completion.

## 8. Stop conditions

Return active mode to shadow if look-at freezes locomotion, driver control is affected, mission/scripted tasks are cancelled, target switching leaves stale control, CGE failure shuts down another integration, body-turn loops/spins, or recovery requires ClearPedTasks.

A safe head-only system is better than an expressive system that steals task ownership.
