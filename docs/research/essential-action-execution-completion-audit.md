# Essential action execution and physical completion audit

Research-only investigation of `ComradeGenosse/LSA-Enhanced-essential-fork` on 3 October 2026. No production gameplay code was changed. No GTA process was launched. Game assemblies were read as PE bytes only.

Machine-readable companions:

- [essential-action-catalog.json](essential-action-catalog.json) — one row per canonical / parser-only action
- [essential-action-execution-completion-evidence.json](essential-action-execution-completion-evidence.json) — pins, proofs, taxonomy
- [action-native-tools/README.md](action-native-tools/README.md) — reproduction

Evidence labels: **PROVEN**, **STRONGLY SUPPORTED**, **INFERRED**, **UNKNOWN**.

---

## 1. Executive conclusions

1. **`NpcActionRegistry.TryExecute(...) == true` proves handler acceptance, not physical completion.** **PROVEN** from deobfuscated `0x6000a91`: normalize name → dictionary lookup → require handler + `NpcState` → `NpcActionHandler.Invoke` → forward that boolean to `IntegrationManager.NotifyNpcActionExecuted` → return it. Exceptions become `false` plus a log line.

2. **`IIntegration.OnNpcActionExecuted(ped, actionName, succeeded:true)` is the same boolean.** **PROVEN** (`0x6000c11` forwards `ldarg.2`, which is the handler result). The callback name is misleading.

3. **Almost every Core\* registrar handler is `call NpcActions.*; ldc.i4.1; ret`.** **PROVEN** from handler classification. Vehicle follow/stop and all PR handlers are the exceptions (computed bool). A void wrapper starting a long-running behavior still reports success.

4. **The only native CLR event that looks like physical action completion is `MovementBehavior.ApproachFinished(Ped, Ped, bool, string)`.** **PROVEN** that the event exists and is raised by `0x60008b3`. **STRONGLY SUPPORTED** that the bool/reason distinguish completed vs failed approach (`TASK_GO_TO_ENTITY`, “ApproachTarget completed”, “target missing”). It carries **no turnId/generationId**.

5. **The activity queue is the best existing long-running completion system.** **PROVEN** fields `NpcActivityQueueItem.Started` / `Completed` plus `NpcState.ActivityInProgress` / `CurrentActivity*`. There is **no** `ActivityCompleted` CLR event.

6. **Stock `wb(...)` returning true only proves a WebSocket `npcAction` send.** **PROVEN**. Server log `ACTION DISPATCHED` is that send. Native `TryExecute` happens later on the plugin side via `BridgeMessageRouter` → `NpcActionQueue`.

7. **Turn/generation correlation is lost for every action except `approachperson`.** **PROVEN**: `P4` attaches `turnId`/`generationId`/`conversationId` only for `approachperson`. `R4` will copy those fields if present, but nothing else populates them. Registry context has no generation fields.

8. **Luna’s model catalog is not the native registry.** Current counts (**PROVEN**):

   | Surface | Count |
   | --- | --- |
   | `INpcActionRegistrar` implementations | 13 (6 core + 7 PR) |
   | DLL registered canonical names | 65 |
   | Stock `Vy` canonical names | 63 |
   | Stock `Nd` parser aliases | 71 |
   | Stock `hv` model-visible tags | 51 |
   | `hv` tags that `h4` can map | 50 |
   | Dead `hv` entry | 1 (`StopDrivingEvasively`) |
   | Catalog rows (registry + parser-only extras) | 70 |
   | High-value latent capabilities documented | 11 |

9. **Vehicle seat “success” is a world postcondition, not a handler result.** Flags `AssignedVehicle` / `AssignedVehicleSeatIndex` / `AssignedVehicleSeatEntryActive` are **intent**. P2 live testing already showed ordering-dependent entry. Treat occupancy of the intended vehicle+seat as the only strong proof.

10. **Combat, follow, hands-up, aim, evasive drive, and accomplice are modes.** They have Stop APIs and state flags. They do not have a single `PHYSICALLY_COMPLETED` until an external outcome (target down, explicit cancel, death). Do not invent one.

11. **A generic `ActionReceipt` can cover request → handler-accepted → cancelled/superseded. Physical completion needs per-family adapters.** Forcing one `Completed` enum will hallucinate success.

12. **Highest-value hidden capabilities** (exist natively, not offered to Luna): `WalkTo`/`DriveTo`, `PerformActivity`(+item), item give/take/use/clear, `approachperson` (which uniquely has `ApproachFinished` **and** turn metadata), `TakeCover`/`ChaseTarget`, directed-interaction start. Do not expose raw `TaskInvoker` or hostage `RoleActionRouter` verbs.

---

## 2. Source / version / hash pins

Checked out and fetched `origin/main` before analysis. This worktree started at that SHA on branch `research/essential-action-completion-audit-20261003`.

| Pin | SHA | Status |
| --- | --- | --- |
| `origin/main` / investigation base | `f53394213f8d7b20868e2cbee88f3cbed63c87eb` | **PROVEN** (`Merge pull request #11` PS0/PS1) |
| `research/session-identity-memory-architecture-20261002` | `ebc42bff7a117705397957a90e6f82674c2b6e26` | ingested, not reimplemented |
| `research/perception-salience-scene-director` | `be6b56294894efb10eb2a07db1aa31eebcba9606` | ingested; this audit answers its action-outcome gap |
| `research/remaining-native-context-audit` | `912ec129f084d412242c8d04e8b42b428ff9f1e6` | decoder precedent reused |
| Essential Hotfix #3 DLL | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` | **PROVEN** match of repo `upstream/LosSantosAlive.dll` to the established pin |
| Stock `server.bundle.mjs` | `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` | **PROVEN** |
| `docs/native-metadata.json` | `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23` | **PROVEN**; also the `buildCandidate.mjs` pin |
| RPH compile-only SDK (from P2 evidence) | `5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0` | prior pin, not re-hashed here |

`buildCandidate.mjs` still hard-codes the same DLL/bundle/metadata hashes. The established Essential pin is **verified, not assumed**.

Installed-machine hashes recorded earlier the same day (PRBridge `712f9491…`, DamageTracker `64816a0d…`, prompt prefixes) were not re-hashed in this session; they are outside the repo.

Roadmap state on this `main`: E1–E6 and P0–P2 implemented; PS0/PS1 merged offline; **CUSTOM ACTIONS / SCENE_DIRECTOR / SALIENCE still planned**. This audit is the action-side prerequisite those phases named.

---

## 3. Complete action architecture

```text
Luna JSON {dialogue, command: "DO …"}
    ↓ validateDecisionShape / validateStockDecision   [E1; target/vehicle/weapon snapshot]
    ↓ stock Cb parser (Nd + w4)                        [REQUESTED → parsed]
    ↓ allowedActionNames = h4(ra(actor) tags)          [VALIDATED against current catalog]
    ↓ Rb / N4 on MODEL_TRANSCRIPT or MODEL_COMPLETE
    ↓ wb → R4 JSON {type:npcAction, action, parameter, target, pedId, …}
         only approachperson gets P4 turnId/generationId
    ↓ WebSocket send to plugin                         [DISPATCHED = send; wb true]
    ↓ BridgeMessageRouter.HandleBridgeTextMessage
    ↓ parse payload (0x600151e / 0x600151d) including optional turnId/generationId
    ↓ NpcActionQueue.QueueNpcAction                    [queued; duplicate/target/state may block]
    ↓ NpcActionRegistry.TryExecute(name, parameter, ped)
         or RoleActionRouter.TryExecute for hostage-scene verbs
    ↓ IActionStateModifier.ApplyActionState (PR)       [optional pre-handler]
    ↓ registrar handler                                [HANDLER_ACCEPTED iff true]
    ↓ NpcActions wrapper / VehicleBehavior / PR helper
    ↓ NpcState flags + optional deferred vehicle-exit executor (0x60002e4)
    ↓ Behavior.Start → RAGE TaskInvoker / TASK_*       [TASK_STARTED]
    ↓ Behavior.Update on Essential tick                [IN_PROGRESS]
    ↓ Stop*/Clear* / newer command / death / exclusive-control release
                                                       [CANCELLED / SUPERSEDED / FAILED]
    ↓ physical world change                            [PHYSICALLY_COMPLETED — rarely signaled]
```

Where the path differs:

| Path | When | Proof |
| --- | --- | --- |
| Registry + Core\* handler | Most civilian/companion verbs | 13 `INpcActionRegistrar`s |
| Registry + PR handler | Arrest/search/ID/FST/pullover/checks | 7 PR registrars; computed bool |
| `BridgeMessageRouter` destination/activity special cases | `walktodestination`, `drivetodestination`, `setdestination`, `performactivity*` | `0x6001523` equality list; **not** in `Register` extract |
| `RoleActionRouter.TryExecute` | Hostage scene verbs (`raiseweapons`, `offerdeal`, …) | strings on `0x6000a9f` |
| `NpcActions.TryExecuteDirectedInteractionAction` | Concurrent DI combat | public method; not Luna `hv` |
| P2 owner pipe | Follow/Wait/Dismiss only | reuses `NpcActions.FollowTarget` / `WaitHere`; no new scheduler |

**PROVEN:** stock dispatch and native registry are different layers. Parser-accepted ≠ registered ≠ model-offered.

---

## 4. Complete canonical action matrix

The exhaustive per-action rows live in [essential-action-catalog.json](essential-action-catalog.json). Summary by exposure:

### 4.1 Model-visible (`hv`) and actually executable — 50 tags

`h4` maps the first token of each `hv` tag through `Nd`/`Vy`/`vb`. All of these except the dead entry below survive that map and have a registry handler and/or a documented native path.

Civilian/common (role + capability filtered by `ra` / `YD` / `zf`): follow, walk away, stop-and-face, flee, walk backwards, turn around, attack-with-weapon, fire-once, aim, take/give weapon, hands up/down, kneel, stand, sit, equip/unequip, resume activity, wait, drive evasive, begin driving, exit, enter passenger/back/driver, follow/stop-follow vehicle, lean.

PR civilian extras: turn off engine, give ID/permits/docs, submit search/breathalyzer/swab/arrest/tint, FST trio, accept citation.

Police extras: backup, person check, vehicle check, arrest, search.

Capability gates **PROVEN** in `YD`/`zf`: `HAS_AVAILABLE_WEAPON`, `IS_DRIVER`, `IN_VEHICLE`. Police-excluded tags use `excludeGroups:[POLICE]`.

### 4.2 Dead model-visible entry — 1

`StopDrivingEvasively` is in `hv` with `IS_DRIVER`. `h4("StopDrivingEvasively")` is `null` because `Nd` has `drivenormally→drivenormal`, not `stopdrivingevasively`. `Cb` also requires `Nd`. The real cancel-evasive verb is `DO DriveNormally`. **PROVEN.**

### 4.3 Parser-known but not offered to Luna

`approachperson`, `givetargetitem`, `taketargetitem`, `walktodestination`, `drivetodestination`, `performactivity`, `performactivitywithitem`, `usehelditem`, `clearhelditem`, `pullovertargetvehicle`, `initiatetrafficstopon`, `felonystopinteraction`.

These are in `Vy`/`Nd`. They are **not** in `hv`, so E1 `allowedActionNames` will reject them even if Luna invents the verb. **PROVEN** from `buildCandidate.mjs` allowlist = `h4(ra(actor))`.

### 4.4 Registry-only (not in `Vy`)

`attacktarget` (unarmed), `takecover`, `becomeaccomplice`, `grabitem`, `initiatedirectedinteraction`, `getarrestedfront`, `givelicense`.

Native queue/integrations can still invoke them. Luna cannot unless `hv`/`h4` change.

### 4.5 Handler-return column (applies to every Core\* action)

| Handler result | Proves |
| --- | --- |
| `unconditionalTrue` | `HANDLER_ACCEPTED` only |
| `computed` (vehicle follow/stop, all PR) | callee bool; still not `PHYSICALLY_COMPLETED` unless that callee is itself a world check (**UNKNOWN** for PR; **INFERRED** false for follow-vehicle start) |

---

## 5. Hidden / latent native capability inventory

| Capability | Already has safe high-level action? | Why Luna cannot use it | Advice |
| --- | --- | --- | --- |
| `WalkTo` / `DriveTo` + `DestinationResolver` | State machine yes; registry action **no** | Not in `hv` | **B** after arrival adapter |
| `PerformActivity` / `WithItem` + occupancy | Activity queue yes | Not in `hv` | **B** — best completion fields |
| Item give/take/use/clear/grab | Yes (`CoreItemActionRegistrar`) | Not in `hv` | **B** via `HeldItem` |
| `approachperson` + `ApproachFinished` | Yes | Not in `hv` | **B** — unique event + P4 identity |
| `TakeCover` / `ChaseTarget` | Behavior + `NpcActions` | Cover not in `Vy`; chase unregistered | **D** then **C** |
| `GoTalkToNearestPed` / `initiatedirectedinteraction` | Yes | Not in `hv` | **C** (DI ownership) |
| `UseScenario` / `UseScenarioAtPosition` | Public wrapper only | No registry action | **D** through activity, not raw |
| `BecomeAccomplice` | Yes | Not in `hv`; P2 keeps it off | **E** for companion |
| Unarmed `attacktarget` | Yes | Stock only offers `Attack USING` | **E** until combat model |
| `getarrestedfront`, `givelicense` | PR registrar | Not in `hv` | **C** |
| Hostage `RoleActionRouter` verbs | Scene controller | Not Luna catalog | **E** |
| Direct `TaskInvoker.Clear` / raw TASK | — | Unsafe | **E** |

---

## 6. Registry / registrar architecture

### 6.1 `NpcActionRegistry`

Public: `Register(string, IEnumerable<string>, NpcActionHandler)`, `TryExecute(string, string, Ped)`, `HasAction(string)`.

`Register` (**PROVEN** `0x6000a90`): normalize canonical + each alias (`m0x6000a93` = trim/lower via helpers); skip blank; store one entry object `{canonical, HashSet aliases, handler}`; **`Dictionary.set_Item` for every alias including canonical** — last registration wins on collision. Logs `[NpcActionRegistry] Registered action: {canonical}`.

`TryExecute` is **synchronous**. Long-running work is started inside the handler (flags + behavior Start) and continues on the Essential update loop. There is **no** async receipt on the registry.

### 6.2 Built-in registrars (13)

**Core:** `CoreCombat`, `CoreCompliance`, `CoreItem`, `CoreMovement`, `CoreSocial`, `CoreVehicle`.

**PR:** `PrArrest`, `PrBackup`, `PrOfficerTarget`, `PrPedCheck`, `PrPullover`, `PrSuspectCommand`, `PrVehicleCheck`.

`PrSuspectCommandActionRegistrar.RegisterActions` (`0x6000e6d`) registers **16 names onto one shared handler** `0x6000ea9` → `m0x6000e6e`. Canonical identity is the registered name, not a distinct method.

### 6.3 `IActionStateModifier`

Interface method `ApplyActionState(Ped, NpcState, string, …)`. **PROVEN** implementor: `PrActionStateModifier`. Its `.cctor` lists destination/activity/combat/vehicle names it cares about. It **prepares PR search/arrest/pullover/document state** and can skip duplicate handoff. Ordering vs handler: **STRONGLY SUPPORTED** as before `TryExecute` body (queue strings `BLOCKED_STATE` / `Prepare suspect search`). Exact call site order should be treated as **STRONGLY SUPPORTED**, not fully unrolled in this report; see queue dump `0x6000214`.

### 6.4 `RoleActionRouter`

`TryExecute(string, string)` (`0x6000a9f`) is a **separate** router for hostage-scene verbs (`raiseweapons`, `offerdeal`, `delaybreach`, `requesthostagerelease`, `standdownswat`, `lowerweapons`, `movecloser`, `moveback`). Not the Luna catalog.

### 6.5 `NpcActionQueue`

`QueueNpcAction` overloads enqueue `{action, parameter, target, sourcePed, exactTargetPed}`. Process path (`0x6000214`) logs `Executing NPC action`, can supersede duplicates, block on `BlockedActions` / missing speaker focus / `BLOCKED_EXACT_TARGET`, and apply reflex special-turn locks (`BeginReflexSpecialTurnActionLock`). **Audio playback finish** can clear a reflex lock (`audio_playback_finished`). Queue success is still not physical completion.

---

## 7. Per-action handler traces

Pattern for Core\* (**PROVEN** via `handlers.py` on unflattened IL):

```text
handler(NpcActionContext ctx):
    NpcActions.Foo(ctx.SourcePed [, ctx.Parameter])
    return true
```

Context fields actually read: usually `SourcePed` and sometimes `Parameter`. **`TargetPed` is populated from `CurrentFocusPed` by TryExecute but many handlers ignore it** and let `NpcActions` re-resolve focus internally. That is a stale-target risk if focus changes between validate and execute.

Exceptions:

- `followtargetvehicle` / `stopfollowingtargetvehicle` → `VehicleBehavior.*` returning bool
- All PR handlers → PR helpers returning computed bool
- `initiatedirectedinteraction` → `GoTalkToNearestPed`
- `felonystopinteraction` → `FelonyStopInteraction`

`NpcActions` public surface is much larger than the registry (140 public methods including overloads): `ChaseTarget`, `UseScenario`, `SetControlledPed`, `ReleaseExclusiveControlForExternalSystem`, all `Clear*Flags`, directed-interaction helpers, etc.

Shared executor `m0x60002e4` (**STRONGLY SUPPORTED**): `(Ped, commandName, vehiclePolicy, body)`. Policy 1/2 = “if in vehicle, force exit, wait settle, abort if a newer per-ped command generation arrived.” Policies 0/3 run immediately. This is why live vehicle-entry races exist.

---

## 8. State / behavior / task traces

### 8.1 `NpcState` (readable public fields; **PROVEN**)

Ownership/runtime: `StayUnderLsaControl`, `RuntimeMode`, `HasBeenTakenOver`, `AccompliceMode`, `InDirectedInteraction`, `BlockedActions`.

Follow: `FollowPlayerOnFoot`, `FollowPaused`, `LastFollowTaskTime`, `AutoResumeFollowPedHandle`.

Destination: `HasDestination`, `WalkToDestination`, `DriveToDestination`, `Destination*`, `DriveDestination`, `HasResolvedDriveDestination`, `PendingDriveDestinationName`, `DriveToXWhenBothSeated`.

Activity: `ActivityQueue`, `CurrentActivity`, `HasActivityQueue`, `ActivityInProgress`, `ActivityWaitingForTurn`, occupancy handles, `ActivityStartTime`.

Vehicle: assigned vehicle/seat/entry-active, enter-when-player-near/enters, exit-when-player-exits, `DriveEvasiveMode`, `TargetVehicle`, last enter/exit/drive task times.

Combat/movement/compliance: `AttackPlayer`, `FleePlayer`, `WalkAway`, `Intimidate*`, `TakeCoverMode`, `ApproachTargetMode`+ped, `ChaseTargetMode`+ped, `TurnAroundMode`, `WalkBackwards*`, `LeanAgainstVehicleMode`, `StopAndFace*`, `HandsUpMode`/`WantsHandsUp`, `KneelMode`, `SitOnGroundMode`, weapon hashes.

**Setting a mode flag is intent.** Update loops keep issuing TASK_* while the flag stays true.

### 8.2 Behavior owners

| Family | Type | Start / Stop / Update |
| --- | --- | --- |
| Follow | `FollowBehavior` | `StopFollowTarget`, `StopFollowing`, `StopFollowTaskOnly` |
| Movement | `MovementBehavior` | `StartApproachTarget`, `StartChaseTarget`, `StartTurnAround`, `StartWalkBackwardsToTarget`, `StartLeanAgainstVehicle`, matching Stops, `Update`, `ApproachFinished` |
| Combat | `CombatBehavior` | `StopAttackTarget`, `StopIntimidate…`, `StopFlee…`, `StopTakeCover`, `StopAllCombat`, `StopCombatTaskOnly` |
| Compliance | `ComplianceBehavior` | `StopHandsUp`, `StopKneel`, `StopSitOnGround`, `Stop` |
| Vehicle | `VehicleBehavior` | seat-entry starts/stops, `StopDriveEvasive`, `StopFollowingTargetVehicle`, **`StopAllVehicleCommands` (`0x6000971`) clears every vehicle command except destination drive** |
| Items | `ItemBehavior` | `Stop`, `ClearHeldItem` |
| Activity | `ResumeActivityBehavior` | `Start` / `StartResumeActivity` / `Update` / `Stop` |
| Social | `SocialBehavior` | `StopAndFaceTarget` + clear |
| PR pullover | `PrPulloverBehavior` | `StopPullover` |

Natives observed in MovementBehavior strings (**PROVEN** as issued names, not as completion): `TASK_GO_TO_ENTITY`, `TASK_TURN_PED_TO_FACE_ENTITY`, `TASK_STAND_STILL`, `TASK_ACHIEVE_HEADING`, `GET_SCRIPT_TASK_STATUS`, lean scenario / `WORLD_HUMAN_LEANING`.

### 8.3 ApproachFinished trace

Raiser `0x60008b3` invokes `Action<Ped,Ped,bool,string>` (null reason → `""`), swallows subscriber exceptions. Callers in the same type emit “ApproachTarget completed” vs “failed: target missing” / “distance lookup threw” / “TASK_GO_TO_ENTITY not issued”. **STRONGLY SUPPORTED:** bool is a physical/attempt outcome, not handler acceptance. **UNKNOWN:** whether a superseded approach can still raise `true` for an older target; no generation token is passed.

---

## 9. Action lifecycle semantics

Use these states and **do not collapse them**:

| State | Who may set it | What it means |
| --- | --- | --- |
| `REQUESTED` | Luna emitted `DO` | syntax only |
| `VALIDATED` | E1 `validateStockDecision` + stock `Cb` + `h4` allowlist | actor could say it at reason-time; P0 rechecks references |
| `DISPATCHED` | `wb` sent WS | plugin has not necessarily run |
| `QUEUED` | `NpcActionQueue` accepted | may still be blocked/superseded |
| `HANDLER_ACCEPTED` | `TryExecute == true` | wrapper ran; flags/start likely |
| `TASK_STARTED` | Behavior issued TASK_* / TaskInvoker | weak |
| `IN_PROGRESS` | Update still owning the mode | medium |
| `PHYSICALLY_COMPLETED` | family adapter / world postcondition / `ApproachFinished(true)` / activity `Completed` | strong |
| `FAILED` | handler false, exception, `ApproachFinished(false)`, PR false, invalid ped | |
| `CANCELLED` | explicit Wait/Stop/hands-down/get-up | |
| `INTERRUPTED` | reflex, DI, combat, mission guard, P2 suspend | |
| `SUPERSEDED` | newer command generation / duplicate queue / new `DO` | |

`PlaybackEnded` is **speech** completion, not action completion. Do not reuse it.

---

## 10. Completion-evidence taxonomy

See evidence JSON for the full lists.

**Not completion:** model text, validator, `wb` true, queue accept, `TryExecute` true, `OnNpcActionExecuted(true)`, mode flag set.

**Weak:** TASK issued, `Last*TaskTime` bump.

**Medium:** matching Update still running; activity `Started`; assigned-vehicle intent; `ApproachFinished(false)`.

**Strong:** occupied seat; held item/weapon hash; activity `Completed`; destination reached **and** flags/tasks cleared (arrival predicate still **UNKNOWN** statically); `ApproachFinished(true)` for the current approach **if** GTA shows it is not stale.

---

## 11. Cancellation / supersession

### 11.1 Explicit Stop / Clear (**PROVEN** public APIs)

`ClearDestinationFlags`, `ClearVehicleIntentFlagsOnly`, `ClearAllVehicleFlags`, `ClearExplicitVehicleEnterFlags`, `ClearFollowFlags`, `ClearComplianceFlags`, `ClearKneelFlag`, `ClearMovementActionFlags`, `ClearHostileFlags`.

Behavior Stops listed in §8. `VehicleBehavior.StopAllVehicleCommands` stops seat-entry, follow-vehicle, passenger/back/driver entry, exit-when-player-exits, and evasive — **not obviously destination drive** (not in the `0x6000971` call list).

`ReleaseExclusiveControlForExternalSystem(Ped, reason, clearNativeTasks)` (**STRONGLY SUPPORTED** from `0x60002ec`): force-stop DI, bump an “external control handoff generation”, optionally `SetControlledBrain(false)`, notify `OnPedControlChanged`, can `TaskInvoker.Clear` when the bool is true. P2 must only use this on safe dismissal (already documented).

### 11.2 Newer command

Per-ped command generation (`NpcActions` dict `f0x4000198`) cancels **deferred vehicle-exit starts**. **PROVEN** strings: `newer command during settle delay`, `newer command before exit completed`. Whether every in-progress TASK is cleared on an unrelated second `DO` is **STRONGLY SUPPORTED** for flag-based modes (new Start typically clears sibling flags) and **UNKNOWN** for leftover Rockstar tasks if Stop is skipped.

### 11.3 Death / invalid handle / despawn

Handlers and Updates generally `NpcTargeting.IsValid` / `IsValidHumanPed` first. **STRONGLY SUPPORTED:** invalid ped → no-op / stop. Addon despawn vs adopted-ped dismiss is a P2 policy, not an action-completion signal.

### 11.4 Asymmetry

Cancellation is **not fully symmetric**. Destination drive may survive `StopAllVehicleCommands`. Follow can pause (`FollowPaused`) rather than stop. Hands-up `WantsHandsUp` vs `HandsUpMode` can diverge if animation fails (**UNKNOWN** live). PR pending arrest has its own `ClearPendingArrest`.

---

## 12. Vehicle arbitration findings

- Seat entry is **intent flags + TASK_ENTER\*** then Update retries (`LastVehicleEnterTaskTime`).
- Successful entry = **world occupancy**, not `HANDLER_ACCEPTED`.
- Policy 1/2 of `m0x60002e4` forces exit before some on-foot commands; a newer command can abort that sequence after the handler already returned true.
- `EnterPassengerSeatWhenPlayerEnters` / `ExitVehicleWhenPlayerExits` are **persistent companion policies** (P2), not one-shot Luna actions.
- `DriveToXWhenBothSeated` can delay drive until both seated — another race.
- P2 GTA smoke already showed **ordering-dependent vehicle-entry**. Treat that as evidence, not anecdote.
- Player occupying the requested seat, vehicle moving away, or another ped taking the seat: **detectable only as world postcondition**. Native does not emit a seat-claimed event we found.

`pullovertargetvehicle` is PR-owned (`PrPulloverBehavior.StopPullover`). Fighting LSPDFR/PR traffic-stop AI is **C**.

---

## 13. Combat / movement / compliance findings

**Combat** (`Attack*`, `TakeShot`, `Aim`/`Intimidate`, `Flee`, `TakeCover`): modes. Completion is “threat ended / cancelled / target invalid,” not a single success. `TakeShotOnTarget` might be finite (**INFERRED** from name + FireOnce catalog tag) but still has no completion event.

**Follow:** `FollowPlayerOnFoot` + `FollowPaused` + last task time. Distinguishing “maintaining follow” from “flag left on after task died” needs world+task observation (**UNKNOWN** without GTA).

**Approach:** best finite movement action; unique event.

**Chase:** native, hidden; same family as approach but no event found.

**Compliance:** flags + `ComplianceBehavior.Stop*`. Pose completion = animation/task observation (**UNKNOWN** statically). `puthandsdown` / `getup` are mode clears; handler true ≠ standing with hands down.

**Directed interaction:** concurrent whitelist includes attack / take-shot / intimidate. Target reactions: wait, stop-and-face, kneel, hands-up, none. Incompatible actions are rejected with a log, not silently completed.

---

## 14. Item / activity / scenario findings

**Items:** `NpcHeldItemState` + `ItemBehavior`. Give/take/use/clear/grab handlers return true immediately. Strong proof is `HeldItem` / attach state (`ATTACH_ENTITY_TO_ENTITY` appears in ItemBehavior). Target actually received an item is **UNKNOWN** without observing the other ped’s held state.

**Activities:** queue + `Started`/`Completed` + delays + occupancy + `ActivityTemplates` / `ActivityPoint` / `ActivityDefinition` + `ResumeActivityBehavior` reading `PedContinuityMemory.InteractionActivity`. Custom executors and completion **text** (`ActivityUpdatesSinceLastInteraction`) exist as context strings, not as a generic receipt. This **is** the most developed native long-running task+completion design and should inform P6 adapters — **without** treating `resumeactivity` handler true as `Completed`.

**Scenarios:** `UseScenario*` is a low-level bypass. Prefer the activity queue.

---

## 15. Mission / script ownership conflicts

P2 already refuses to replace Rockstar tasks in guarded states (`IS_CUTSCENE_*`, `GET_MISSION_FLAG`, `IS_ENTITY_A_MISSION_ENTITY`, player switch, network session). **PROVEN** as P2 policy.

Stock actions do **not** automatically inherit that guard. If Luna says `Attack` or `EnterDriverSeat` during a mission, the registry will still accept the handler unless `BlockedActions` / exclusive-control / PR modifier stops it.

`HasExclusiveControl` / `ReleaseExclusiveControlForExternalSystem` are the strongest LSA ownership surfaces. RPH “this script” ownership does **not** prove per-addon ownership (P2 evidence already said this; **confirmed, not expanded**).

High-conflict families: vehicle entry/drive, combat, pullover, scenarios, follow vs traffic, DI vs companion follow.

---

## 16. Integration / role-specific actions

PR actions are first-class registry names. Handler success is a PR helper bool — **INFERRED** as “PR accepted the request,” **UNKNOWN** as “cuff clicked / plate returned.” `OnNpcActionExecuted` still only mirrors that bool.

`requestbackup` is withheld on `MODEL_TRANSCRIPT` (`Rb` skips unless `e` complete). **PROVEN.**

Role groups: `COMMON` / `CIVILIAN_PR` / `POLICE` via `WD` (police officer role string) and `zD` (PR detected). Extra PR actions never appear for a non-PR civilian.

Hostage `RoleActionRouter` verbs are integration/scene, not Luna.

---

## 17. Generic completion-observer feasibility

**Safe to make generic:**

- `ActionExecutionId`
- actor identity (`pedId` / CharacterId separately)
- `turnId` + `generationId` + `sessionNonce` **captured at dispatch** (today only approach does this natively)
- canonical name + validated targets
- `REQUESTED` / `VALIDATED` / `DISPATCHED` / `HANDLER_ACCEPTED` / `CANCELLED` / `SUPERSEDED`
- timestamps for those

**Must be adapters:**

| Family | Adapter signal |
| --- | --- |
| Approach | `ApproachFinished` + same target + current execution id |
| Follow / aim / hands-up / evasive / accomplice | mode established + still alive; no `Completed` |
| Seat entry | occupancy of intended vehicle+seat |
| Drive / WalkTo | destination resolve + proximity + flags/tasks cleared |
| Combat | outcome enum (incapacitated / fled / cancelled), not `Completed` |
| Items/weapons | inventory/held/equipped hashes |
| Activity | `NpcActivityQueueItem.Completed` |
| PR | PR-specific callbacks if any; otherwise UNKNOWN |

One generic `Completed=true` bit would be a lie for modes and a guess for vehicles.

---

## 18. Recommended future action-receipt architecture

Smallest safe design (do **not** implement in this PR):

```text
ActionReceipt {
  executionId, pedId, characterId?,
  turnId, generationId, sessionNonce,   // stamped by companion at wb-time
  canonical, targets,
  requestedAt, dispatchedAt, handlerAcceptedAt?,
  state: REQUESTED|…|PHYSICALLY_COMPLETED|FAILED|CANCELLED|SUPERSEDED,
  handlerSucceeded?: bool,              // never promote this to Completed
  adapter: ApproachAdapter | SeatAdapter | … | ModeAdapter | None,
  evidence: [{kind, strength, at, detail}]
}
```

Companion owns the receipt. Essential remains the executor. Subscribe to `ApproachFinished` and poll/observe strong world postconditions on Essential Update or existing interop snapshots. **Never** write memory/commitment text from `OnNpcActionExecuted(true)`.

Stamp `turnId`/`generationId` on **every** `R4` payload (today only approach). Until then, the companion must keep the dispatch map itself.

---

## 19. GTA experiment matrix

Do not run these unless a real Enhanced session with the pinned DLL is available. Each probe is the smallest check that static evidence cannot close.

| ID | Setup | Record | Settles |
| --- | --- | --- | --- |
| V1 | Player enters vehicle first, then `DO EnterPassengerSeat V00n` | assigned vehicle/seat, flags, TASK, handler/`OnNpcActionExecuted`, final seat | ordering race |
| V2 | Command first, then player enters same seat | same | who wins |
| V3 | Command, then vehicle drives away | abort vs chase | entry abort |
| D1 | `BeginDriving` then `DriveTo` (once exposed) | motion, `DriveDestination`, arrival, flag clear | arrival predicate |
| D2 | Change destination mid-route | leftover task vs new | supersession |
| F1 | Follow, obstruct, enter/exit vehicle, `WaitHere` | `FollowPaused`, reacquire, explicit stop | follow modes |
| A1 | `approachperson` with P4 ids | `ApproachFinished` args vs turn/generation; fail by warping target | event reliability / stale |
| C1 | Attack / FireOnce / Aim; kill or cancel target | flags vs tasks vs handler | combat = mode |
| K1 | Hands-up / kneel / sit / stand | flag vs animation vs `GET_SCRIPT_TASK_STATUS` | pose completion |
| Y1 | `ResumeActivity` / queued activity | `Started` → scenario → `Completed` | activity as template |
| X1 | Second `DO` during first long action | flags, tasks, deferred-exit logs | supersession completeness |
| M1 | Same actions during cutscene/mission flag | whether stock still issues TASK | ownership gap |

Instrumentation: existing debug overlay strings already print `WalkToDestination` / `DriveToXWhenBothSeated`; prefer that plus E1 JSONL. Do not add production hooks in this research branch.

---

## 20. Prioritized implementation implications

### A — Already safe to reason about (not “safe to claim completed”)

Observing **current** flags and world: follow requested, hands-up requested, weapon hash, in-vehicle, activity `CurrentActivity`. Safe for Scene Director *situation*, not for promises.

### B — Safe after a completion adapter

`approachperson` (`ApproachFinished` + P4 ids), activity queue `Completed`, item/weapon world postconditions, vehicle **occupancy** (not flags), destination arrival once the Update predicate is proven in GTA.

### C — Needs stronger arbitration / cancellation

Vehicle entry vs player, pullover vs PR/LSPDFR, follow vs vehicle transitions, any action during mission/cutscene, DI vs companion follow, second-action leftover tasks.

### D — Requires a new registered + catalogued action

`WalkTo`/`DriveTo`, `PerformActivity`(+item), `TakeCover`, `ChaseTarget`, item verbs, `approachperson` in `hv`. Native behavior exists.

### E — Avoid

Raw `TaskInvoker` / scenario without occupancy, `BecomeAccomplice` for the companion, hostage router verbs, unarmed `attacktarget` as a “completed fight,” treating `wb`/`TryExecute` as done.

**Do not implement these in this investigation.**

---

## Answers to the required architectural questions

1. **`TryExecute == true`?** Handler invoked and returned true; state existed; name was registered. **Not** physical completion. **PROVEN.**

2. **`OnNpcActionExecuted(..., true)`?** Same bit. **PROVEN.**

3. **Instantaneous vs long-running?** Instantaneous *intents*: equip/unequip (still need world check), hands-down, get-up, stop-follow-vehicle, wait-here-as-cancel. Long-running modes: follow, approach, walk/drive to, seat entry, drive, combat, compliance poses, DI, activity, PR procedures.

4. **Explicit completion events?** Only `ApproachFinished` for actions. Activity uses fields not events. Playback events are speech.

5. **State flags only?** Follow, pause, most movement/combat/compliance/vehicle intents, destination bits.

6. **World postcondition required?** Seat occupancy, held item/weapon, destination arrival, target received item, PR physical cuff/search.

7. **No trustworthy completion?** Combat modes, flee, cover, chase, intimidate, follow-as-promise, PR checks, pullover, “drive around.”

8. **Correlate to originating turn after dispatch?** Only `approachperson` natively. Companion can correlate if it stamps receipts at `wb`.

9. **Where lost?** After `R4` for all non-approach actions; always lost at `NpcActionContext` (no generation fields); queue/registry do not store turn ids.

10. **Stale work satisfying a later action?** **STRONGLY SUPPORTED** risk: `ApproachFinished` without generation; assigned-seat flags vs later command; `FollowPaused` leftover; deferred exit starting an old body if generation check misses a path (**UNKNOWN** for every path).

11. **Second conflicting action?** New handler typically sets its flags and sibling Clears; vehicle deferred start can abort; queue may mark `Statefully duplicate action superseded`. Leftover TASKs **UNKNOWN** if Stop skipped.

12. **Robust Stop/Cancel?** Follow, combat, compliance, vehicle command bundle, exclusive-control release, DI stop. **Yes, APIs exist.**

13. **Stale tasks/state?** Destination drive vs `StopAllVehicleCommands`; `FollowPaused`; `WantsHandsUp`; assigned seat after abort; PR pending arrest if not cleared.

14. **Successful vehicle seat entry?** Ped exists, `IsInVehicle`, current vehicle is the intended one, seat index is the intended class (passenger/rear/driver). Flags are insufficient.

15. **Successful driving / arrival?** Driver seated + vehicle tasked + (for DriveTo) resolved destination + proximity + flags/tasks cleared. Exact arrival predicate **UNKNOWN**.

16. **Follow/approach/chase observation?** Approach: event + flags. Follow: flags + task, no event. Chase: flags + task, hidden.

17. **Combat completion?** Outcome/mode model: started, in-progress, target-invalid, cancelled, external-incapacitation. Not `Completed=true`.

18. **Persistent modes vs finite tasks?** Modes: follow, hands-up, aim, evasive, accomplice, attack, flee, cover. Finite: approach, (likely) fire-once, seat entry, get-up/hands-down, activity item, item transfer.

19. **Activity better than ordinary actions?** **Yes**, for long-running structured work (`Started`/`Completed`/occupancy). Still not wired to Luna (`hv`) and handler true ≠ `Completed`.

20. **Useful but inaccessible to Luna?** WalkTo/DriveTo, PerformActivity, item verbs, approach+event, TakeCover, Chase, DI start, grab item.

21. **Smallest safe architecture for P6 / Scene Director?** Companion-owned `ActionReceipt` stamped at dispatch with turn identity; generic states through `HANDLER_ACCEPTED` / cancel / supersede; **per-family adapters** for physical completion; never promote `OnNpcActionExecuted(true)` into memory or promises.

---

## Corrections to prior documents

- Perception/Scene Director research correctly called physical outcomes an **unresolved** problem. This audit **resolves the action-side map** and confirms that gap was not overstated.
- Session-identity research’s request vs validation vs dispatch vs handler vs physical split is **confirmed** and now pinned to tokens (`wb`, `0x6000a91`, `0x6000c11`, `ApproachFinished`).
- Native-contract wording that “server `ra/h4/Cb/N4/Rb/wb` preserves current stock action semantics” is true for **dispatch**, not completion. Qualify any reading that implied `wb` or `TryExecute` was done.
- “51 actions” inherited from `hv.length` is the **model catalog**, not the native registry (65) and not the parser (`Vy` 63). Always say which surface.

---

## Non-goals honored

Identity, memory architecture, perception/salience, Scene Director, NPC↔NPC talk, mass new actions, a second TASK scheduler, production `main` edits, and GTA deploys were not done.
