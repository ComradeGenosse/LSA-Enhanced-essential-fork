# Vehicle command continuity and ACT6 ownership — October 17

## What is implemented

- The companion classifies only bounded, **whole player utterances**. Common
  conversational forms (“come on, keep going”, “can you pick up speed?”, “go
  faster, man”) are recognized, but story-like remarks or requests containing a
  waypoint remain outside the free-drive classifier. A continuation (“keep
  going”) cannot turn into `DriveEvasively` or a new `BeginDriving` publication.
  “Drive faster,” “speed up,” and “floor it” retain Essential's supported
  `DriveEvasively` faster-driving alias, subject to Essential's current action
  allowlist and verified driver preconditions. This changes the driving style,
  not a numeric speed setting. Slowing down is handled independently.
- A source-qualified ACT6 `vehicle_trip` blocks competing stock driving-mode DO
  publication for that player turn. The original P0 state is checked, followed
  by an ACT5 live activity read under the verified owner **and** its separately
  authenticated host context; `owner.binding` alone omits the host context and
  cannot query the activity-state API. Native owner, lease, capability probes,
  and task evidence still govern actual driving.
- At native ACT6 `drive_to` handoff, the ACT-owned actor uses Essential's existing
  `VehicleBehavior.StopAllVehicleCommands` once, then explicitly clears
  `state.DriveToXWhenBothSeated` **before** the route task is dispatched.
  The pinned DLL's StopAll method does **not** clear that persistent flag,
  so stopping modes alone allows its 3,000-ms free-drive update to overwrite
  ACT6's route. The ACT6 runner never reissues its destination task every tick.
  On task loss, failure, cancellation or arrival, its existing owner-fenced
  cleanup remains authoritative.
- `vehicle_request_classified`, `vehicle_command_reconciled` and
  `vehicle_stock_command_published` report intent/command stages. A publication
  is neither the native handler's success receipt nor a physical motion sample.
  Stock handler outcomes continue through existing C-05 source-verified receipts
  (accepted/failed/unknown). ACT6's StepRunner separately reports accepted,
  established-progress, arrived, interrupted and failed statuses.

## What this change cannot prove

Reverse engineering the exact pinned `LosSantosAlive.dll` (SHA-256
`9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`)
found that `StartDriving` sets `DriveToXWhenBothSeated`, its recurring
`UpdateStartDriving` reads that flag, and the task-issue helper gates
republication on `LastDriveTaskTime` plus **3,000 ms**. There is no
corresponding free-drive flag clear in `StopAllVehicleCommands`. The repository
contains this compiled upstream DLL, not editable, testable Essential vehicle
controller source. The new `vehicle-dll-handoff.test.mjs` pins those exact IL
facts and verifies the native ACT6 flag clear precedes the destination task.

This implements the **ACT6 collision fix** for matching Essential builds; it
does not change the stock free-driving task's own timer. Frequent log entries
indicate that the task is issued repeatedly but cannot alone prove GTA was
visibly interrupted every time. Do **not** extend the binary's timer or suppress
the log and represent that as recovery-based reissue: the proper stock repair
requires editable Essential source, a task-status-aware controller, and in-game
validation (vehicle continuity, task loss/recovery, driver changes).

The ACT6 handoff now uses a supported Essential stop method **plus**
an explicit clear of the unretired free-drive mode flag to prevent its 3-second
handler from reclaiming the ACT6 route. This must be validated in-game with
the exact deployed Essential DLL. The existing ACT6 task-hash evidence is
task-family-level and cannot establish full per-invocation GTA task ownership.

## Acceptance in GTA V Enhanced

1. Install matching native and companion builds. With Nathan seated as driver,
   say “start driving.” Distinguish `DO BeginDriving` handler acceptance from
   actual sustained vehicle speed/position change and the underlying free-drive
   reissue events. If it still reissues every three seconds while cruising,
   capture the original Essential vehicle logs and task status before/after each.
2. Say “keep going” during sustained movement. Confirm no new free-drive
   command is published and no `DriveEvasively` is dispatched.
3. Say “drive faster,” “floor it,” then “drive evasively.” With a verified
   NPC driver and available Essential action, all three may issue the stock
   `DO DriveEvasively` faster/aggressive mode. Verify movement changes and
   avoid claiming a specific numeric speed. “Slow down” must never accelerate.
4. Opt into ACT6 with native drive probes, set a valid waypoint, and request
   “drive to the waypoint.” Verify Essential free-drive cleanup happens once
   before the ACT6 task and that no residual stock task overwrites it at the
   old three-second interval. Observe actual route progress and arrival, not
   merely `HANDLER_ACCEPTED`.
5. Repeat while stopped, with the wrong driver, after a player interrupt,
   after changing vehicle or protagonist, with a failed route, and after “stop
   driving.” Confirm owner/vehicle fencing, no stale task revival, cancellation
   and truthful failure/no-arrival reports.
6. If the underlying stock mode repeatedly resets its own task *without*
   ACT6 involvement, fix that behavior at Essential's pinned vehicle-controller
   source/runtime seam; do not invent a second LSA task scheduler.

The prior ACT6 CI run failed one new companion test because the expected
wording disagreed with the guidance's actual wording. The regression assertion
now matches the functional promise instead, and the live owner read is tested
with a scoped host context, a changed epoch, actor mismatch, terminal activity
and detached native state. CI source/build tests are necessary but are not
physical GTA acceptance. The stock Essential DLL remains external; fixing a
proven native free-drive reissue bug requires its exact source/runtime, which
this PR cannot modify safely.
