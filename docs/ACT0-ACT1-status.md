# ACT0 / ACT1 status

Updated October 6, 2026. Branch `feature/act0-act1-contracts-shadow-observer` has been reconciled onto current `main` as the base of the ACT2 stack. ACT0/ACT1 have now been built, deployed to the GTA Enhanced install, and exercised in GTA as part of the integrated ACT2 validation. Post-review hardening is included after the original `ff8c8be` implementation.

ACT0 freezes the activity vocabulary. ACT1 observes existing Essential and P2 actions and correlates their lifecycle. ACT does not dispatch NPC actions, call task natives, or add player controls.

The integrated ACT stack has now completed a physical GTA deployment/runtime test. That establishes deployment and runtime-smoke confidence for ACT0/ACT1, but it does **not** retroactively answer the focused ACT1 evidence questions below unless that exact behavior was observed and recorded.

## What shipped

### ACT0

- `contracts/activity-capabilities.v1.json` promotes the October 4 v0 draft. Capability ids, intents, enums, evidence classes, preconditions, execution paths, and exclusions are unchanged. Row `notes` and excluded-entry notes were removed. SHA-256 `31ed6e6d47a7222929b3645401d6e046676ed7f21a65f5643a68e002a3ee6486`.
- Companion validators in `lsa-essential-e1-candidate/src/activities/contracts.mjs` and `capabilityRegistry.mjs`.
- Native `ActivityContracts.cs` and `CapabilityTable.cs`, with the same SHA pin.
- `tools/native-metadata --activities` wrote `lsa-essential-e1-candidate/docs/activities-native-metadata.json` from the pinned Essential DLL `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`.
- `tools/verifyActivitiesContract.mjs` checks that SHA, the companion/native pins, and every Essential member the registry names.

Excluded families and `phase: "never"` rows cannot be enabled. `activities.mode` other than `shadow` stays off, so a registry row that could be enabled in a later phase still cannot execute.

### ACT1

Shadow mode correlates P2 follow/wait, model/Essential callbacks, reflexes, and player commands that replace an action. The pure machine records `REQUESTED → VALIDATED → DISPATCHED → HANDLER_ACCEPTED` and the terminal outcomes `SUPERSEDED`, `DETACHED`, `FAILED`, and `TIMED_OUT`. Control loss and stale incarnations detach or reject. Mode capabilities are not marked physically complete.

The pipe is `LSA.Activities.v1`. ACT1 traffic is `hello`, `lease`, `actor.facts`, and `diagnostics`. `step.begin` is a frozen contract shape and is rejected by the session.

Default remains off. `activities.mode: "shadow"` is the only switch that constructs the observer. P2's update catch does not see an ACT exception: a contained fault counts toward the breaker, and an escaping fault disables ACT for the run.

The known PS callback map now keeps Essential's canonical names `followtarget` and `waithere`. The old `follow` / `wait` callback tokens classify as `other`.

## Post-review hardening

A focused review of `ff8c8be` found several ACT1 transport/lifecycle issues. They are fixed on the same branch:

- the named-pipe worker is now transport-only; it parses/copies bounded frames but never mutates `ActivitySession`, `StepMachine`, a ped, `NpcState`, or receipt state;
- client frames are pumped into the session only from P2's owner/update fiber;
- the callback ring is lock-protected, and callbacks now enqueue only the ped reference, callback payload, and source-time `Game.GameTime`; encounter/incarnation resolution happens later on the owner fiber;
- transport reconnects reset sequence state without permanently poisoning the session, and disconnect/invalid-frame handling detaches old shadow executions;
- the companion preserves counters across same-native-run reconnects but resets them when `nativeRun` changes;
- diagnostics are no longer startup-only: receipt counter changes are emitted at a bounded four-per-second cadence;
- `callbackDropped` reports the actual callback ring rather than an unused monitor;
- the three-fault circuit breaker now uses a rolling 60-second window, increments `breakerTrips`, and logs one bounded trip line;
- ACT1 remains shadow-only and still contains no NPC dispatch or raw TASK path.

The ACT native test helper now pumps the production owner-fiber transport path, and regression cases were added for reconnect after a sequence failure, reconnect after a rejected `step.begin`, live receipt diagnostics, callback/breaker diagnostics, and native-run counter reset.

## Verification

| Check | Result |
| --- | --- |
| `node tools/runTests.mjs` | **370 passed**, 0 failed on the original `ff8c8be` implementation; rerun required after post-review hardening |
| `native/activities/tests` | **104** assertions passed on `ff8c8be`; post-review tests added, rerun required |
| `native/promoted-characters/lifecycle-tests` | **66** assertions passed on `ff8c8be`; breaker assertions added, rerun required |
| `native/intelligence/integration-tests` | **43** assertions passed, including canonical callback names |
| `native/intelligence/tests` | **70** assertions passed |
| `native/promoted-characters/runtime-tests` | **34** assertions passed |
| `native/promoted-characters/ps-host-tests` | continuous, stop, and failed passed |
| P2 and identity offline tests | 39 and 19 assertions passed |
| `node tools/testActivitiesInterop.mjs` | real same-user named pipe passed on `ff8c8be`; helper now exercises owner-fiber pumping and must be rerun |

`LSA.PromotedCharacters.Runtime.dll` was not rebuilt here because `RphReferencePath` was unset. The production integration sources, including the new shadow partial, compiled in the lifecycle harness and the bridge runtime harness.

## Deviations from the October 4 research

- `activities.mode: "on"` normalizes to `off`. Only `shadow` starts observation. That keeps ACT2 execution unreachable.
- There is no `StepRunner.cs`. ACT1 observation is `ActivityCommands.cs` plus `StepMachine`. Nothing in those files calls `QueueNpcAction`, `NpcActions`, or a task native.
- The live session accepts companion `hello` and `lease` only. Later frame types stay in the validators.
- A sequence gap or companion restart voids executions with the existing reason `lease_lost`.
- `PHYSICALLY_COMPLETED` remains in the receipt enum. The shadow machine will not enter it, and telemetry will not record that token.
- N9 executor aliases (`WaitHere` beside `waithere`, `FollowTarget` beside `followtarget`, and the other researched pairs) are code next to the registry, not new JSON fields.
- Pinned metadata shows `VehicleBehavior.StopFollowTargetVehicle(Ped, NpcState)` returns `Boolean`. The registry's cancel string was not changed.
- `actor.facts.isDriver` is false in this phase. Injury and in-vehicle are read with non-task natives. Driver seat waits for an ACT2 vehicle anchor.
- The PS action vocabulary change stays on perception frame version 1. Bumping that version would reject every current intelligence hello.
- The capability document records `promotedFrom` and `repositoryHead` `bc3b2027b0b2eb6a3c1a7dcb326587f9af781696`.

## Open GTA gates

The branch is now deployed and GTA-runtime verified at the integrated stack level. The focused probes below remain **open questions** where their exact evidence was not captured; deployment/runtime verification must not be read as an automatic pass for each probe.

| Probe | What to record | What it settles |
| --- | --- | --- |
| Q2 | One command per path: queue `waithere`, queue-special `takecover` and `resumeactivity`, wrapper `UseScenario`, immediate `ExitVehicle`, deferred `FollowTarget`. Log every callback with name, phase, managed thread id, and game time, plus the count per command. | Exact callback names, counts, and thread. Pins the alias map before any later phase acts on it. |
| PT1, observation half | Owned character in follow, wait, sit, or cover while the player marks and talks, typed and with the mic, with and without a `DO` in the reply. | Whether a player turn changes flags, tasks, or command callbacks. ACT1 only observes. |
| X1 | A second `DO` during a long action. | Whether supersession sees the replacement command, flags, tasks, and deferred-exit logs. |
| M1 | The same observation during a cutscene and with the mission flag set. | Whether stock tasks still run, and that ACT only records the scripted state. |

## Not in this branch

ACT2 execution, F11 activity controls, pause/resume/cancel UI, deterministic plans, Luna proposals, Scene Director behavior, navigation extensions, commitments, and any second NPC scheduler.


## Post-review verification note

The later integrated ACT2 stack supplied the missing real deployment/runtime evidence: the ACT code was built, installed, and exercised in GTA. The historical per-suite counts above remain the recorded offline evidence for this branch unless a later run explicitly supersedes them. Focused ACT1 probe questions remain open where the required callback/thread/lifecycle evidence was not specifically captured.
