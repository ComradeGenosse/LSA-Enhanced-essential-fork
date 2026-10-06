# ACT2 status — player-assigned basic activities

Updated October 6, 2026. Branch `feature/act2-player-assigned-basic-activities` has been reconciled onto current `main`, includes ACT0/ACT1 underneath it, and has now been built, hash-deployed to the GTA Enhanced install, and exercised in GTA. The integrated ACT0→ACT2 stack was merged to `main` on October 6, 2026 via PR #18 (`b2221917`). Post-review hardening is included after the original `eb786c3` implementation.

ACT2 is the first player-assigned activity path. It reuses the ACT0 registry and the ACT1 pipe, lease, receipt, and supersession machinery. Essential still performs the NPC action. ACT does not own a second GTA task scheduler.

## What shipped

Player menu intents, and only these:

| Menu label | Intent | Capability | Essential command |
| --- | --- | --- | --- |
| Follow me | `accompany` | `follow_person` | queue `followtarget` with the exact player anchor |
| Wait here | `hold_position` | `hold_position` | queue `waithere` |
| Sit here | `sit_here` | `sit_on_ground` | queue `sitonground` |
| Resume previous activity | `resume_previous` | `resume_ambient` | queue `resumeactivity` |

The F11 Current NPC page, for a promoted character, now has Assign Activity, Pause Activity, Resume Activity, Cancel Activity, Activity Status, and Activity history. Assign opens a page with only the four activities above and uses the existing second-select confirmation. Pause and cancel may be bound as gestures. Resume, assign, status, and history may not.

The command catalog is `contracts/commands.v2.json`. The loader embed, `CommandCatalog.ContractSha256`, and `COMMANDS_CONTRACT_SHA256` are the same SHA-256 `07e0ad837bcbce8b6ff088a0b57ae6aad94e23cdbb5ac4a6bc4668a20b15d754`.

Companion modules: `intentTemplates.mjs`, `activityValidator.mjs`, `goalStore.mjs`, `activityFacts.mjs`, `activityEngine.mjs`, `activityRuntime.mjs`. Native modules: `StepRunner.cs`, `CompletionAdapters.cs`, `PlaceTable.cs`, `ActivityWorld.cs`, and `ActivityDispatch.cs` on the P2 owner fiber. The pipe worker is still transport-only.

## Config

| `activities.mode` | Behavior |
| --- | --- |
| absent, anything else, `off` | No ACT client and no native session |
| `shadow` | ACT1 observer only. `step.begin` is still rejected |
| `on` | ACT2 pipe frames and StepRunner are constructed |

`on` is not the default and is not applied by upgrading a config that omits it. Example configs stay `off`. `activities.dialogue` is forced false.

Admission also requires `activities.passedProbes` to include every probe on the capability row (`Q1`+`FR1`, `Q1`+`F1`, `R1`, or `K1`). The default list is empty, so `mode: "on"` alone still answers `capability_disabled`. Putting a probe id in that list is the local switch for a GTA experiment. It is not a record that the probe passed. The native hello advertises the four ACT2 capabilities only while mode is `on`; later capabilities stay false.

Both the companion `e1` config and `LSA.PromotedCharacters` `activities.mode` must be `on` for a live assignment. The companion list of probes is what admits the menu command.

## Lifecycle that is implemented

- One running activity per character, at most four characters, one replan slot unused (ACT3), at most one retry, three resumes, and eight executions.
- A repeated `(capability, reason)` fails the activity. Accept timeouts retry once, then stop.
- Goal deadline is 60 minutes. The wall backstop is 2 hours. Mode holds keep their registry `holdMaxMs` (30 minutes, or 10 minutes for sit).
- Pause detaches the current execution and keeps a RAM resume token for 120 seconds. Resume preflights again and mints a new `executionId`.
- Cancel uses `cancel_if_current`. Follow cancel calls `NpcActions.ClearFollowFlags` and `FollowBehavior.StopFollowTarget`. Sit cancel calls `ComplianceBehavior.StopSitOnGround`. Wait and ambient-resume have a supersede cancel with no stop API, so ACT drops ownership without clearing tasks it did not issue.
- P2 Follow, Wait, Dismiss, and Despawn preempt the activity before P2 applies its own command. Dismiss, despawn, and retirement detach that incarnation. A later summon is not given the old execution.
- Reflex, scripted state, and directed interaction pause. A second reflex cancels. Mission and directed-interaction pauses are explicit-only.
- Lease loss applies each execution's `onLeaseLoss` policy. ACT2 uses `cancel_if_current`, refuses new work after TTL expiry, and requires a fresh hello/reconnect before control can be reacquired. Nothing resumes across a new native run.
- Handler acceptance is not completion. Hold, follow, and sit reach `MODE_ESTABLISHED` only from mode flags. `resume_ambient` reaches `PHYSICALLY_COMPLETED` only from strong continuity evidence.

## Deviations from the October 4 research

- ACT1 normalized `activities.mode: "on"` to `off`. ACT2 keeps `on` as the execution switch. `shadow` and `off` are unchanged.
- For a mode step whose `until` is not yet satisfied, `already_satisfied` enters holding and does not dispatch. It does not mark that step done. A wait that is already established therefore survives resume instead of ending immediately.
- The command schema has one target. Activity commands use `current`. The character page is not a second assign surface.
- ACT2 templates all use `onComplete: "stay"`. Finishing an activity sets the encounter mode to idle, restores the saved P2 vehicle-seat / control-retention policy values, and does not reissue P2 follow or wait. A P2 preempt restores nothing because the P2 command that follows becomes authoritative.
- Production cannot honestly set strong resume-ambient arrival from the public continuity memory fields, which have no position. Without memory, the adapter can report wandering as mode establishment only. `R1` remains open, and a resume can still end on `complete_timeout`.
- `hold_position` does not insert an ACT3 walk-back when the actor is away from `here`. That case ends instead of chasing.
- No `[CURRENT ACTIVITY]` block is injected into Luna.

## Post-review hardening

A focused review of the original `eb786c3` ACT2 implementation found live-integration issues that the isolated offline tests did not exercise. They are fixed on this branch:

- lease heartbeats and execution frames now share one monotonically increasing client sequence, reset on reconnect;
- the companion sends the first lease immediately after hello;
- `ActivityRuntime` continuously ticks `ActivityEngine`, so retries, defer windows, auto-resume, duration/until clauses, pause expiry and wall/game deadlines advance in production;
- the activity game-time baseline is taken from native receipts/facts rather than the zero-valued deadline placeholder;
- native lease expiry applies `onLeaseLoss`, rejects new work, and cannot be revived by a late heartbeat without a fresh hello;
- actor release validates the held physical lease;
- native ACT2 execution frames are independently validated against exact closed schemas before StepRunner sees them;
- ACT ownership and temporary P2 policy changes are established before queue publication, and failed dispatch rolls them back;
- saved seat/control-retention policy values are restored on normal ACT ownership end;
- `hold_position` now stores the captured `here` XYZ and rejects a resumed/displaced actor beyond the 6 m ACT2 bound instead of silently redefining “here”;
- player-distance timeout is scoped to `follow_person` rather than incorrectly ending Wait/Sit when the player walks away;
- ACT2 actor facts and diagnostics now read the live StepRunner rather than the ACT1 shadow machine;
- actor facts continue while an ACT physical lease is held even if the current native step is detached for pause, so reflex/scripted-state recovery stays evidence-driven;
- paused activities remain visible through companion lifecycle state, so F11 Resume remains usable after the native execution detaches;
- Activity Status and Activity History now return bounded reply bodies and display real state/history in the F11 HUD;
- regression definitions now cover unified client sequencing, the runtime tick loop, owner-before-dispatch, strict frame rejection, hold-anchor displacement, lease-expiry cancellation/fresh-hello fencing, and paused F11 state.

## Verification

Recorded on this branch after the ACT0/ACT1 head was fetched at `5d11ee9`. The pre-change companion suite was 370 passed. Native activity tests were 108, lifecycle 67, intelligence unit 70, intelligence integration 43, P2 offline 39, runtime 34, ps-host continuous passed, and the UX input suite passed before the ACT2 edits.

| Check | Result |
| --- | --- |
| `node tools/runTests.mjs` | **377 passed**, 0 failed on the original `eb786c3` implementation; rerun required after post-review hardening |
| `native/activities/tests` | **137** assertions passed on `eb786c3`; new lease/schema/ownership/anchor assertions were added and require rerun |
| `native/promoted-characters/lifecycle-tests` | **67** assertions passed |
| `native/enhanced/input-tests` | **372** assertions passed on `eb786c3`; paused-activity F11 coverage was added and requires rerun |
| `native/promoted-characters/runtime-tests` | **34** assertions passed |
| `native/promoted-characters/ps-host-tests` continuous | passed |
| `node tools/buildCharactersAddon.mjs` | production runtime built on `eb786c3`, `gtaRuntimeTest: false`; rebuild required after hardening |
| `node tools/buildCandidate.mjs` | candidate built on `eb786c3`; rebuild required after hardening, GTA pending |

Source scans reject `TASK_`, broad ped-task clearing, `CancelAll`, exclusive-control release, and `SetControlledBrain` in the ACT2 execution files. Queue dispatch is confined to `ActivityDispatch.cs`.

## October 6 deployment / GTA validation

The rebased ACT2 stack (`1d6454e` before the documentation commits) was pulled locally with ACT0/ACT1 underneath it, built, and installed into GTA Enhanced. The deployment reported 83 installed files with staged-payload hash parity; active config/credential files were preserved and no files were deleted. The companion and native addon builds succeeded. A later GTA run exercised the integrated ACT stack sufficiently to accept ACT0/ACT1/ACT2 for merge.

This is **stack-level deployment/runtime verification**, not proof that every focused capability probe below was observed. Any unanswered probe remains open and must stay documented as such. The full regression suite was not rerun as part of the initial deployment step, so historical suite counts are not rewritten as fresh results.

## Open GTA gates

The integrated ACT0→ACT2 stack has now passed deployment and GTA runtime smoke testing. The focused capability probes below remain **open questions** wherever their exact evidence was not captured. Merge/deployment therefore must not be read as an automatic pass for Q1/F1/K1/R1/FR1/M1, nor as permission to remove the existing default-off and probe-allowlist safety gates.

| Probe | What to record |
| --- | --- |
| Q1 | Queue dispatch from this host matches bridge dispatch for `waithere`, `followtarget`, `resumeactivity`, and `sitonground`, including callback name, count, and thread |
| F1 | `followtarget` keeps the exact player anchor for the execution lifetime |
| K1 | `sitonground` reaches the sit mode flag; handler `true` alone is not enough |
| R1 | `resumeactivity` ends on remembered ambient behavior, or on control release after that memory is reached, without ACT restoring a stale task |
| FR1 | An owned actor with `StayUnderLsaControl` is not far-released inside the activity bubble |
| M1 | A mission flag or cutscene pauses the activity and ACT does not keep tasking |

ACT1 probes Q2, PT1, X1, and M1 are still open as well. They do not block this code, and they do block calling ACT2 production-enabled.

## Known limitations

- Wait and ambient-resume cancel do not clear the Essential mode, because the registry gives them no stop API.
- Resume-ambient physical completion is not claimed from handler acceptance.
- Activities are RAM only. A reconnect does not resume them.
- The activity is not described to the model.
- No approach, vehicle, cover, item, navigation, commitment, or Scene Director behavior.

## Readiness

The hardened/rebased stack has now been built, deployed, and exercised in GTA. The deployment used the rebased ACT2 head containing ACT0/ACT1; the staged payload hash check completed successfully and the companion/native addon builds succeeded. The historical per-suite counts above remain historical unless a later full regression run explicitly supersedes them.

The integrated stack is merged and available for ordinary GTA testing, but individual physical capabilities remain deliberately gated. Keep `activities.mode` explicit and keep `activities.passedProbes` limited to capabilities whose focused GTA evidence has actually been captured. The six probe questions above stay open until that evidence exists; merging ACT2 does not silently close them.
