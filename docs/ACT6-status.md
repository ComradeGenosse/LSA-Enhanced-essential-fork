# ACT6 — NPC navigation and travel (integration candidate)

**Base:** `integration/act3-act4-act5-unified-20261017` at `6d0a0ebd` (unmerged ACT3–ACT5). **Branch:** `feature/act6-native-navigation-20261017`. This is a native-execution candidate, **not GTA-accepted**. Source and unit tests cannot prove that GTA V Enhanced actually performed the journey. Do not merge solely on offline tests.

## Implemented paths

- **`go_to_place` → `walk_to`:** owner-scoped destination reference, on-foot preflight, GTA navmesh walk task (`TASK_FOLLOW_NAV_MESH_TO_COORD`), native ped-position/progress samples and bounded stuck/timeout detection.
- **`vehicle_trip` → `drive_to`:** driver/vehicle preflight, on-road destination gate, GTA long-range driving task (`TASK_VEHICLE_DRIVE_TO_COORD_LONGRANGE`), original driver/vehicle identity and movement/arrival evidence.
- **`move_to_and_hold`:** real finite walking step followed by the existing ACT2 hold-position step. Intermediate completion does **not** complete the entire plan.
- **Direct player dialogue:** with ACT5 and the relevant ACT6 capability independently opted in, a closed parser supports phrases such as “go to the waypoint”, “drive us to the airport”, and “walk to Vespucci Beach and wait”; the existing ACT5 publication-bound admission and current-owner checks still apply. Stop-driving/walking cancellation is scoped to the accepted active activity. Generic “that building” and arbitrary coordinate strings are refused.
- All three run through existing ActivityEngine/GoalStore, actor leases, StepRunner, completion adapters, status/ACT4 facts, ACT5 consent, world-change and player-priority fences. No second scheduler or free-form Luna coordinates.
- A handler return is **HANDLER_ACCEPTED**, not physical arrival. The ACT6 adapter requires a task issued under the current ACT ownership, actual progress toward that task's retained destination, and consecutive close-position samples. It checks the same actor, driver and vehicle. `no_progress`, `navigation_failed`, `driver_required`, `vehicle_mismatch` and timeouts remain failure states.

## Destination types / limitations

Supported, native-resolved and retained per actor incarnation:

| Input | Resolution | Failure behavior |
| --- | --- | --- |
| Player map waypoint | GTA waypoint blip, game-provided coordinates, sampled ground height when Z is zero | Missing waypoint or missing ground sample → `place_unresolved` |
| Named landmark | Exact allowlist: airport/LSIA/Los Santos International Airport, Del Perro Pier, Vespucci Beach, Sandy Shores Airfield, Paleto Bay | Unrecognized/ambiguous query → `place_unresolved` |
| Near player | Current authenticated player Ped offset resolved on native fiber | No valid player → `target_invalid` |
| Current position (`here`) | ACT2's already supported captured location | No implicit reroute |

All destinations must pass finite/world-coordinate bounds. Driving additionally requires an actual road at the resolved point. **Known restriction:** a waypoint whose terrain cannot be resolved (even via RPH's distant-terrain ground sampling) fails safe rather than producing guessed Z; resolving distant terrain can temporarily yield the native fiber; named landmark coordinates can be unsuitable for driving if the position is not on the road. `home`, arbitrary `ux_point`/trusted world capture, free-form positions and other non-whitelisted names are not implemented and are refused. No full-route feasibility query is available in the currently bound Essential interface; actual path failure is inferred from lack of progress/timeout, not a proven navmesh route-validation API. Arrival evidence is destination proximity plus dispatch-scoped movement and consecutive samples, not a native route-completed callback.

## Runtime configuration (default **off**)

In `e1.config.json` under `activities`:
```json
{
  "mode": "off",
  "act5": false,
  "act3Capabilities": [],
  "act6Capabilities": [],
  "passedProbes": []
}
```
Enable ACT6 **only in a controlled GTA session** after testing the corresponding native DLL and companion together. The existing `mode: "on"`, native hello support, `act6Capabilities: ["walk_to"]` or `["drive_to"]`, and **all exact capability probes** in the pinned registry must pass. `act5: true` separately enables model suggestions; waypoint-only suggestions require explicit player consent and never bypass ACT admission. Do not assert probe success by merely listing probe strings.

## Offline gates and GTA acceptance procedure

1. Check out this branch's exact companion and native builds together; keep existing settings in backup. Run `node --test tests/activities-act6.test.mjs tests/activities-act3.test.mjs tests/activities-act5.test.mjs` from `lsa-essential-e1-candidate`. Run `dotnet run --project native/activities/tests/ActivityTests.csproj` from repo root where the .NET 4.8.1 reference environment is available, then build `native/promoted-characters/PromotedCharacters.csproj` with the pinned RPH/DamageTracker paths. Run the repository's established contract and integration gates and GitHub CI.
2. In GTA V Enhanced, summon and promote Nathan; enable only walk ACT6 with the exact native owner/lease and completed probes. Place a *nearby* waypoint in a walkable open street; assign `go_to_place`. Capture ACT receipt transitions and on-screen video showing walking to that waypoint. Ensure DISPATCHED and HANDLER_ACCEPTED never claim PHYSICALLY_COMPLETED before progress/arrival.
3. Repeat with far waypoint, no waypoint, inaccessible terrain and unknown named place. Each must fail or time out with the truthful reason and **no substituted destination**. Cancel and supersede during a walk, interrupt with conversation, switch player character, reset world/save/load and disconnect native session. Verify no stale resumed task or duplicate command.
4. Seat Nathan **as driver** of a usable vehicle; put the waypoint on a public road. Assign `vehicle_trip`. Confirm actual GTA driving, original vehicle/driver identity, route progress, stopped vehicle within arrival radius and PHYSICALLY_COMPLETED only after arrival. Test no-driver, destroyed/replaced vehicle, inaccessible road, blocked driving, player takeover, `stop driving`, lost lease and world reset. Verify stop controls affect only the owned task.
5. Assign `move_to_and_hold`, observe travel physically finished before a separate hold step starts, and query Nathan mid-drive, after arrival, after cancellation and after failure. With ACT5 separately consented, verify no proposal executes without player confirmation. Repeat the ACT3 seat/approach/hold and ACT4 status regressions.
6. Save hashes of installed DLL/companion, exact branch SHA, timestamps, video/log receipts, and pass/fail results. **Do not set GTA accepted until these are observed in game**.

## Acceptance status

**Production-path source:** present in this integration candidate. **Offline tests:** see PR CI/results at its exact head. **GTA Enhanced test:** NOT RUN here. **Merge readiness:** blocked on proven GTA walking/driving and native build/CI results, especially remote waypoint resolution, native task signature behavior, cancellation, and route/road access. Native task invocation is present; it is not proof of success.
