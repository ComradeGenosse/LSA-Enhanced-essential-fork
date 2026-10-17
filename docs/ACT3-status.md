# ACT3 status — rich short-range NPC physical activities

Branch `feature/act3-rich-npc-physical-activities`. Code complete and offline-tested; **nothing here has been run in GTA and nothing is enabled by default.** Every ACT3 capability needs a local opt-in and a GTA probe before it counts as validated.

ACT3 reuses the ACT0–ACT2 machinery unchanged in kind: the capability registry, the `LSA.Activities.v1` pipe (transport only), lease/epoch fencing, owner-before-dispatch, the receipt state machine and supersession observation. Essential remains the only thing that performs NPC actions. ACT3 adds no task controllers, no raw GTA task natives and no second queue. `contracts/activity-capabilities.v1.json` is untouched (SHA-256 `31ed6e6d…6ee6486`).

## How a step is executed and judged

1. The companion plans a closed template (never model-supplied steps) and resolves each step's anchors right before that step's preflight. Anchors are C-02 `ActTarget` captures; no raw handles cross the pipe.
2. Native preflight re-proves the anchors, ownership, and the state preconditions. It answers `alreadySatisfied` or a typed reason.
3. Dispatch goes through the existing Essential queue command (or the existing `NpcActions.UseScenario` wrapper). A handler returning `true` is only `HANDLER_ACCEPTED`.
4. A completion adapter reads named Essential state flags, GTA reads (seat, speed, heading, distance) and, for approach, Essential's own `ApproachFinished` event. Only a strong adapter verdict becomes `PHYSICALLY_COMPLETED`. Mode capabilities (`stop_and_face`, `scenario_here`, `take_cover`, `begin_driving`) can only reach `MODE_ESTABLISHED`; the runner refuses completion for them.
5. Cancel and lease loss use only the stop APIs the contract row registers. Rows with cancel path `none` (`exit_vehicle`) detach; they never fake a stop.

## What is implemented

Ten capabilities are implemented natively and advertised by `EssentialActivityWorld.Supports`. Advertising is by capability, so anything not listed below is not offered in the `hello`.

| Capability | Essential path | Completion evidence |
| --- | --- | --- |
| `stop_and_face` (mode) | queue `stopandfacetarget` | `StopAndFaceTargetMode` + same target + actor heading within 45° of the target. Flag alone is only progress |
| `approach_person` (finite) | queue `approachperson` | `MovementBehavior.ApproachFinished(ok)` for this actor and target, after dispatch, and distance ≤ 2.5 m. Proximity alone never completes |
| `walk_away_from` (finite) | queue `walkawayfromtarget` | real distance from the anchored target ≥ 40 m |
| `exit_vehicle` (finite) | queue `exitvehicle` | actor no longer in a vehicle |
| `enter_vehicle_seat` (finite) | queue `enterdriverseatoftargetvehicle` / `entertargetvehicle` / `enterbackoftargetvehicle` by seat | actor seated in the *anchored* vehicle and the requested seat. Intent flags are never occupancy. Wrong vehicle → `vehicle_mismatch`, taken seat → `seat_unavailable` |
| `begin_driving` (mode) | queue `startdriving` | driver, then vehicle speed ≥ 1 m/s for establishment. No completion |
| `scenario_here` (mode) | wrapper `NpcActions.UseScenario`, closed scenario map from the contract | scenario-active read; no completion. An active follow is stopped first through its registered stop APIs |
| `take_cover` (mode) | queue special `takecover` | `TakeCoverMode` flag held |
| `grab_item` (finite) | queue `grabitem`, closed item map | held item name equals the requested item |
| `clear_held_item` (instant) | queue `clearhelditem` | nothing held |

Menu-less intents that now plan, through `engine.assign` and the existing editor-server `activity` operation (`assign` with `intent` and `slots`). No F11 menu, UX or character-service changes were made.

| Intent | Plan |
| --- | --- |
| `scenario_here` (`smoke`, `drink_coffee`, `phone`, `lean`, `stand_idle`, `clipboard`, `binoculars`) | `scenario_here` |
| `approach_and_face` | `approach_person` → `stop_and_face` |
| `board_vehicle`, `ride_along` | `enter_vehicle_seat` on the player's vehicle (`ride_along` refuses `driver`) |
| `exit_vehicle_and_hold` | `exit_vehicle` → `hold_position` (ACT2) |
| `leave_scene` | `walk_away_from` → `resume_ambient` (ACT2) |
| `take_cover_and_hold` | `take_cover` |

Safeguards that are tested, not just documented:

- **Local per-capability gate.** `activities.act3Capabilities` (default absent) must list each ACT3 capability, on top of `mode: "on"`, the native `hello`, and that row's `activities.passedProbes`. This exists because probe `Q1` is shared with ACT2, so ACT2's probe opt-in can never enable ACT3 by accident. A multi-step plan needs every step enabled.
- **Ownership and priority.** Admission is `player_ux` / `player_direct` only; dialogue, commitment, recovery and director sources stay closed until ACT4+. A lower-priority proposal is rejected with `activity_busy` and never displaces a higher-priority live activity. Native owner-before-dispatch, foreign-callback supersession and `p2_control` handling are unchanged and covered for the new capabilities.
- **Stale targets.** Anchors are re-proven at preflight, at dispatch, and every tick. A retired target or vehicle ends the step with `target_retired` / `vehicle_invalid`, and a changed target is `target_changed`. Late receipts from a finished step are counted stale and ignored.
- **Multi-step plans.** Each step resolves its own anchors; a step that is already satisfied advances the plan instead of completing it.
- **Typed refusals.** `sit_bench` and a missing scenario → `unsupported_combination`; non-player people/vehicle slots → `unsupported_combination`; blocked intents → `capability_unavailable`. Nothing is silently substituted.

## Blocked / not implemented (not faked)

| Item | Why |
| --- | --- |
| `follow_vehicle` | `followtargetvehicle` has no verified completion or ownership model. Not advertised |
| `give_item`, `take_item` | `parser_only` in Essential, no transfer completion signal. Not advertised |
| `scenario_at` (and intent `scenario_at`) | needs a place anchor and arrival tracking (ACT6 territory). Not advertised, intent blocked |
| `sit_bench` scenario | `PROP_HUMAN_SEAT_BENCH` needs a prop target; refused as `unsupported_combination` |
| `begin_driving` as a menu intent | no ACT3 intent maps to it; it is reachable only as a native capability for ACT4+ |
| `grab_item` / `clear_held_item` as intents | the closed `INTENTS` vocabulary has no item intent. They are native capabilities ready for later plans |
| `move_to_and_hold`, `go_to_place`, `vehicle_trip`, `hang_out_with` | need arbitrary walk/drive-to (ACT6) or a social planner (ACT5) |
| Smoking prop | Essential has no cigarette item; `smoke` is the scenario only |

## Needs GTA validation before enabling

Enable one capability at a time in a local config, never together:

```json
"activities": { "mode": "on", "passedProbes": ["Q1", "..."], "act3Capabilities": ["stop_and_face"] }
```

`passedProbes` holds at most 12 ids, so the vehicle-seat probes (`V1`–`V4`, `SVE1`) and the item probes (`I1`) have to be opted in as their own experiment. Use the editor-server `activity` operation (`assign`, with `intent` and `slots`), then `status`, `cancel` and `history`.

| Capability | Probes | What to confirm in game |
| --- | --- | --- |
| `stop_and_face` | `Q1` | NPC turns to the player within the heading tolerance; walking away from the NPC does not break it; player command cancels it |
| `approach_person` | `Q1`, `A1` | `ApproachFinished` fires once per approach with `ok=true` near the player, `false` on blocked or missing target, and never from another system's approach |
| `exit_vehicle` | `Q1` | exits from driver and passenger seats; nothing else is cancelled on exit (no stop API exists) |
| `enter_vehicle_seat` | `V1`–`V4`, `SVE1` | each seat enters the *player's* vehicle and reports the right seat; occupied seat gives `seat_occupied`, a vehicle moving at ≥ 1 m/s is deferred as `vehicle_moving`; other vehicles are never entered |
| `begin_driving` | `Q1` | only as driver; establishes on real movement |
| `scenario_here` | `S1` | each scenario in the closed map plays on foot, an active follow is cleanly stopped first, and a new player command takes the NPC back |
| `walk_away_from` | `Q1` | NPC reaches 40 m or fails with a typed reason; cancel stops only the walk-away |
| `take_cover` | `C2` | cover mode establishes and releases within the 60 s hold limit |
| `grab_item`, `clear_held_item` | `I1` | held-item state matches the contract item names |

Callback spellings for the new queue commands (`EnterDriverSeatOfTargetVehicle`, `EnterTargetVehicle`, `EnterBackOfTargetVehicle`, `GrabItem`, `ClearHeldItem`) follow the canonical method names and still have to be pinned by Q2. A wrong spelling makes our own callback look foreign, which supersedes the step. It can never fake an acceptance.

## Files

- Native: `StepRunner.cs`, `CompletionAdapters.cs`, `CapabilityTable.cs`, `ActivityContracts.cs`, `ActivityWorld.cs`, `SupersessionMonitor.cs`, and in `promoted-characters` `ActivityDispatch.cs`, `ActivityCommands.cs`.
- Companion: `intentTemplates.mjs`, `activityValidator.mjs`, `activityEngine.mjs`, `contracts.mjs` (config gate), `capabilityRegistry.mjs` (alias names), `activityFacts.mjs` / `activityKnowledge.mjs` (phrases for the new intents).
- Verification: `verifyActivitiesContract.mjs` also pins `ApproachFinished` and the `NpcState` flags ACT3 reads.

## Tests

- Native `ActivityTests`: 530 assertions, including `Act3Tests.cs` for contract, adapters, ownership conflicts, cancellation, stale anchors and completion verification of every implemented capability.
- Companion `tests/activities-act3.test.mjs` (17 tests) plus the unchanged ACT0–ACT2 suites. One ACT2 assertion changed: it used `board_vehicle` as an example of a blocked intent and now uses `go_to_place`.
- The production native build compiles against the pinned RagePluginHook, RAGENativeUI and DamageTrackerLib.
- The Windows-only lifecycle tests could not be run in this environment. Memory K original release gates S01–S10 fail the same way on `main`.
