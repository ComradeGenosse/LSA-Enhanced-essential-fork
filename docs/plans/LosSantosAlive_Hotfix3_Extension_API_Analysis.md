# Los Santos Alive — Hotfix #3 Extension / Plugin API Archaeology

**Purpose:** map the shipped Los Santos Alive (LSA) implementation from an addon/mod-plugin perspective: where another RAGE Plugin Hook plugin can observe, enrich, register, trigger, or coordinate with LSA **without recreating LSA itself**.

This is a reverse-engineered engineering reference derived from the user-supplied **LSA Essential Installer (Hotfix #3)**. It focuses on preserved CLR metadata, public/readable symbols, companion bridge assemblies, configuration, and server protocol behavior. Implementation bodies are obfuscated in many places, so claims are marked conceptually as **confirmed surface**, **validated behavior**, or **inference** where appropriate.

## Executive summary — the extension seams worth building on

| Priority | Surface | Why it matters for an addon | Stability guess |
|---|---|---|---|
| 1 | `IIntegration` + `IntegrationManager.Register` | Official-looking plugin seam for lifecycle, context enrichment, control changes, and action completion | **Best** |
| 1 | `NpcActionRegistry.Register` | Add new Gemini/NPC actions without replacing the dispatcher | **Best** |
| 1 | `NpcStateStore` / `NpcState` runtime modes | Read/promote state, block actions, coordinate your behavior with LSA ownership | **Good** |
| 1 | `NpcPlaybackCoordinator` events | Know exactly when LSA speech starts/ends and which turn/generation it belongs to | **Good** |
| 1 | `SpecialGeminiTurnScheduler` | Ask an NPC to produce a special/environmental turn with dedupe/cancellation rules | **Good** |
| 2 | `ReflexSystem.Trigger` + reflex state | Feed synthetic world events into LSA or suppress duplicates | **Good but behavioral** |
| 2 | `DirectedInteractionManager` | Start and observe NPC↔NPC authored interactions | **Good but scene-sensitive** |
| 2 | `NpcItemStore`, `LocationRegistry`, `HostageSceneDatabase` | Extend content catalogs (items, activities/places, hostage setups) | **Promising; global mutable registries** |
| 2 | `PerceptionSystem`, context providers, resolvers | Reuse LSA’s snapshot/reference resolution instead of duplicating world scans | **Useful read surface** |
| 3 | Direct behavior classes (`CombatBehavior`, `VehicleBehavior`, etc.) | Powerful immediate control, but bypasses some higher-level state/action semantics | **Brittle** |
| 4 | `GeminiBridgeClient.SendJson` / raw WS protocol | Escape hatch when no higher-level API exists | **Most brittle** |

**Recommended architecture for our enhancement:** one small adapter plugin references LSA, registers an `IIntegration`, registers our own action handlers, listens to playback/directed-interaction events, and keeps all version-specific LSA calls behind that adapter. Our actual gameplay logic should depend on our adapter interfaces, not directly on dozens of LSA classes.

## Package / evidence fingerprint

- `LosSantosAlive.dll` — 2,407,424 bytes — SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`
- `LosSantosAlive.Interop.dll` — 27,648 bytes — SHA-256 `b471252afa5e32f8c2f98e842c0f931bcd54149a16fd0f42c407c5811abc97a8`
- `LosSantosAlive.PRBridge.dll` — 294,400 bytes — SHA-256 `712f9491c0693d496ea82b1e4cefaa03c0575408a2fefa8d9e295bb516e5ad3e`
- Main assembly metadata: .NET/Mono CLR runtime `v4.0.30319`, assembly version `1.0.0.0`.
- Notable references: `RagePluginHook`, `RAGENativeUI 1.9.3`, `DamageTrackerLib 2.0`, `LSPD First Response 0.4.9695.26411`, `NAudio 2.2.1`, `websocket-sharp-core 1.0.1`.
- The companion local server is shipped as `plugins/LosSantosAliveServer/server.bundle.mjs`.

- **LosSantosAlive.dll:** 187 readable types, 1208 readable method definitions, 488 readable fields, 127 properties, 7 events in the extracted readable-symbol set.
- **LosSantosAlive.Interop.dll:** 6 readable types, 48 readable method definitions, 41 readable fields, 1 properties, 0 events in the extracted readable-symbol set.
- **LosSantosAlive.PRBridge.dll:** 19 readable types, 48 readable method definitions, 25 readable fields, 0 properties, 0 events in the extracted readable-symbol set.

### Important limitation
The main DLL is substantially obfuscated: many private/internal identifiers and string literals are transformed. The CLR metadata still preserves a surprisingly large semantic surface, including the main managers, registries, state objects, enums, DTOs, events, and public methods. Therefore this document is strongest for **how to integrate with the exposed surface**, not for reconstructing every internal algorithm.

---

# 1. Mental model: how LSA is put together

At a high level, the shipped build behaves like a set of cooperating layers:

1. **World/perception layer** — captures peds/vehicles and exposes a current `PerceptionSnapshot`; resolves people, vehicles, locations and activity context.
2. **NPC state layer** — `NpcStateStore` owns a per-ped `NpcState`. Runtime mode moves from passive → reflex-only → active behavior → conversation as needed.
3. **Reflex layer** — detectors turn local game events (aimed gun, shots, melee, crashes, fleeing, etc.) into `ReflexEventType` and a weighted `ReflexReactionType`.
4. **Action layer** — normalized AI actions are routed through `NpcActionRegistry`; core registrars implement movement, combat, compliance, items, vehicles and social behavior. Integrations can add actions too.
5. **Behavior layer** — concrete behavior classes manipulate RAGE tasks/state (`FollowBehavior`, `CombatBehavior`, `VehicleBehavior`, etc.).
6. **Context/hydration layer** — builds `ActorContext`/`ContextSnapshot`, lets integrations enrich it, serializes it, and hydrates the Gemini/server side.
7. **Conversation/interaction layer** — manages current conversation speaker/target and directed NPC↔NPC interactions.
8. **Audio-turn layer** — protocol-v3 audio is keyed by ped + turn ID + generation ID, queued in the coordinator, and emits playback lifecycle events.
9. **Integration layer** — `IIntegration` adapters (LSPDFR, Policing Redefined, interop) add context/action behavior without replacing core systems.
10. **Local server** — WebSocket bridge on port 8765 connects game-side context/control to the live model and performs mic/audio/callout/special-turn orchestration.

For a plugin enhancement, **layers 2, 4, 6, 8 and 9 are the safest seams**. Directly driving layer 5 or layer 10 should be the exception.

---

# 2. The primary addon seam: `IIntegration`

This is the clearest “build on LSA” interface in Hotfix #3. `IntegrationManager.Register(IIntegration)` accepts arbitrary implementations and the manager fans lifecycle/context/action notifications out to available integrations.

### `LosSantosAlive.Integrations.IIntegration`

Properties:
- `string Id { get; }`
- `bool IsAvailable { get; }`

Methods:
- `public virtual abstract void Initialize()`
- `public virtual abstract void Update()`
- `public virtual abstract void Shutdown()`
- `public virtual abstract void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`
- `public virtual abstract void OnPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public virtual abstract void OnNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`

### `LosSantosAlive.Integrations.IntegrationManager`

Methods:
- `public static void Register(LosSantosAlive.Integrations.IIntegration integration)`
- `public static void Initialize()`
- `public static void Update()`
- `public static void Shutdown()`
- `public static void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`
- `public static void NotifyPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public static void NotifyNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`
- `public static void ApplyActionStateModifiers(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`

### `IActionStateModifier`

Methods:
- `public virtual abstract void ApplyActionState(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`

### How-to: register our enhancement as an LSA integration

```csharp
using LosSantosAlive.Context;
using LosSantosAlive.Integrations;
using LosSantosAlive.NPC;
using Rage;

public sealed class OurLsaIntegration : IIntegration, IActionStateModifier
{
    public string Id => "our.enhancement";
    public bool IsAvailable => true;

    public void Initialize() { /* subscribe / allocate */ }
    public void Update() { /* keep cheap; this is in LSA's update fan-out */ }
    public void Shutdown() { /* unsubscribe / release */ }

    public void EnrichActor(Ped ped, ActorContext context)
    {
        // Add information that Gemini/LSA should know about this actor.
        // Prefer IntegrationBlocks for namespaced addon-owned JSON.
    }

    public void OnPedControlChanged(Ped ped, bool controlledByLsa)
    {
        // Yield or restore our own tasking based on LSA ownership.
    }

    public void OnNpcActionExecuted(Ped ped, string actionName, bool succeeded)
    {
        // Observe action completion/failure without patching each action.
    }

    public void ApplyActionState(Ped ped, NpcState state, string actionName,
                                 ActionStateModifierPhase phase)
    {
        // Alter addon-owned coordination state before/after LSA core state rules.
    }
}

// During addon initialization, after LosSantosAlive.dll is loaded:
IntegrationManager.Register(new OurLsaIntegration());
```

**Validated behavior:** `IntegrationManager.ApplyActionStateModifiers` enumerates available integrations that also implement `IActionStateModifier` and calls `ApplyActionState`. `NpcActionRegistry.TryExecute` notifies `IntegrationManager.NotifyNpcActionExecuted` after executing a registered handler. This makes the integration + action registry pair the most coherent enhancement path.

**Versioning caution:** metadata proves `Register` exists, but obfuscation makes its late-registration initialization semantics hard to prove. Register early in plugin startup. Make `Initialize` idempotent anyway.

---

# 3. Extending the action system

### `LosSantosAlive.NPC.Actions.NpcActionContext`

Fields / constants:
- `public string RawAction`
- `public string ActionName`
- `public string Parameter`
- `public Rage.Ped SourcePed`
- `public Rage.Ped TargetPed`
- `public LosSantosAlive.NPC.NpcState State`

### `LosSantosAlive.NPC.Actions.NpcActionRegistry`

Methods:
- `public static void Register(string canonicalName, System.Collections.Generic.IEnumerable`1<string> aliases, LosSantosAlive.NPC.Actions.NpcActionHandler handler)`
- `public static bool TryExecute(string actionName, string parameter, Rage.Ped sourcePed)`
- `public static bool HasAction(string actionName)`

### `LosSantosAlive.NPC.Actions.INpcActionRegistrar`

Methods:
- `public virtual abstract void RegisterActions()`

### `LosSantosAlive.NPC.Actions.RoleActionRouter`

Methods:
- `public static bool TryExecute(string normalizedActionName, string parameter)`

`NpcActionHandler` is a delegate returning `bool`; the return value is treated as action success/failure and propagates to integration notifications. The context contains the raw/normalized action, parameter, source ped, resolved target ped, and the source ped's `NpcState`.

### How-to: add a completely new LSA action

```csharp
NpcActionRegistry.Register(
    "inspectvehicle",
    new[] { "inspectcar", "checkvehicle" },
    ctx =>
    {
        if (ctx.SourcePed == null || !ctx.SourcePed.Exists())
            return false;

        // Do our addon behavior. ctx.TargetPed is LSA's current focus target when present.
        // Keep NpcState coherent if our action changes a long-lived mode.
        return true;
    });
```

**Design rule:** put “what the model can ask for” in the registry; put long-running execution in our own state machine/fiber. The action handler should validate, enqueue/start, update LSA state if required, and return promptly.

### Existing canonical action vocabulary found in the shipped server

| Canonical token | Semantic label |
|---|---|
| `followtarget` | `Follow` |
| `approachperson` | `Approach` |
| `walkawayfromtarget` | `WalkAwayFrom` |
| `stopandfacetarget` | `StopAndFace` |
| `fleefromtarget` | `FleeFrom` |
| `walkbackwardstotarget` | `WalkBackwardsTo` |
| `turnaround` | `TurnAwayFrom` |
| `attacktargetwithweapon` | `Attack` |
| `takeshotontarget` | `FireOnceAt` |
| `intimidatetargetwithweapon` | `AimAt` |
| `givetargetitem` | `GiveItemTo` |
| `taketargetitem` | `TakeItemFrom` |
| `taketargetweapon` | `TakeWeaponFrom` |
| `givetargetweapon` | `GiveWeaponTo` |
| `puthandsup` | `PutHandsUp` |
| `puthandsdown` | `LowerHands` |
| `kneel` | `Kneel` |
| `getup` | `StandUp` |
| `sitonground` | `SitOnGround` |
| `equipweapon` | `EquipWeapon` |
| `unequipweapon` | `UnequipWeapon` |
| `resumeactivity` | `ResumeActivity` |
| `waithere` | `WaitHere` |
| `walktodestination` | `WalkTo` |
| `drivetodestination` | `DriveTo` |
| `driveevasive` | `DriveEvasively` |
| `drivenormal` | `StopDrivingEvasively` |
| `startdriving` | `BeginDriving` |
| `exitvehicle` | `ExitVehicle` |
| `entertargetvehicle` | `EnterPassengerSeat` |
| `enterbackoftargetvehicle` | `EnterBackSeat` |
| `enterdriverseatoftargetvehicle` | `EnterDriverSeat` |
| `followtargetvehicle` | `FollowVehicle` |
| `stopfollowingtargetvehicle` | `StopFollowing` |
| `leanagainstvehicle` | `LeanAgainstVehicle` |
| `turnoffengine` | `TurnOffEngine` |
| `performactivity` | `PerformActivity` |
| `performactivitywithitem` | `PerformActivityWithItem` |
| `usehelditem` | `UseHeldItem` |
| `clearhelditem` | `DiscardHeldItem` |
| `giveid` | `GiveIDTo` |
| `giveweaponpermit` | `GiveWeaponPermitTo` |
| `givefishingpermit` | `GiveFishingPermitTo` |
| `givehuntingpermit` | `GiveHuntingPermitTo` |
| `givevehicledocuments` | `GiveVehicleDocumentsTo` |
| `giveallinformation` | `GiveAllDocumentsTo` |
| `getsearched` | `SubmitToSearch` |
| `takebreathalyzer` | `SubmitToBreathalyzer` |
| `takedrugswab` | `SubmitToDrugSwab` |
| `performhorizontalgazetest` | `PerformHorizontalGazeTest` |
| `performwalkandturntest` | `PerformWalkAndTurnTest` |
| `performonelegstandtest` | `PerformOneLegStandTest` |
| `getarrested` | `SubmitToArrest` |
| `usetintreader` | `SubmitToTintTest` |
| `takecitation` | `AcceptCitation` |
| `requestbackup` | `RequestBackup` |
| `requestpedcheck` | `RequestPersonCheck` |
| `requestvehiclecheck` | `RequestVehicleCheck` |
| `pullovertargetvehicle` | `PullOver` |
| `initiatetrafficstopon` | `ApproachStoppedDriver` |
| `arresttarget` | `Arrest` |
| `searchtarget` | `Search` |
| `felonystopinteraction` | `InitiateFelonyStop` |

Representative aliases normalized by the server:

| Alias | Canonical |
|---|---|
| `follow` | `followtarget` |
| `approach` | `approachperson` |
| `walkawayfrom` | `walkawayfromtarget` |
| `stopandface` | `stopandfacetarget` |
| `fleefrom` | `fleefromtarget` |
| `walkbackwardsto` | `walkbackwardstotarget` |
| `turnawayfrom` | `turnaround` |
| `attack` | `attacktargetwithweapon` |
| `fireonceat / takeshoton` | `takeshotontarget` |
| `aimat` | `intimidatetargetwithweapon` |
| `giveitemto` | `givetargetitem` |
| `takeitemfrom` | `taketargetitem` |
| `takeweaponfrom` | `taketargetweapon` |
| `giveweaponto` | `givetargetweapon` |
| `raisehands` | `puthandsup` |
| `lowerhands` | `puthandsdown` |
| `standup` | `getup` |
| `walkto` | `walktodestination` |
| `driveto` | `drivetodestination` |
| `driveevasively` | `driveevasive` |
| `drivenormally` | `drivenormal` |
| `begindriving` | `startdriving` |
| `enterpassengerseat` | `entertargetvehicle` |
| `enterbackseat` | `enterbackoftargetvehicle` |
| `enterdriverseat` | `enterdriverseatoftargetvehicle` |
| `followvehicle` | `followtargetvehicle` |
| `stopfollowing` | `stopfollowingtargetvehicle` |
| `discardhelditem` | `clearhelditem` |
| `giveidto` | `giveid` |
| `submittosearch` | `getsearched` |
| `submittobreathalyzer` | `takebreathalyzer` |
| `submittodrugswab` | `takedrugswab` |
| `submittoarrest` | `getarrested` |
| `submittotinttest` | `usetintreader` |
| `acceptcitation` | `takecitation` |
| `requestpersoncheck` | `requestpedcheck` |
| `pullover / pullovervehicle` | `pullovertargetvehicle` |
| `approachstoppeddriver` | `initiatetrafficstopon` |
| `arrest` | `arresttarget` |
| `search` | `searchtarget` |
| `initiatefelonystop` | `felonystopinteraction` |

The server-side alias vocabulary and DLL-side action registry are complementary: the model/server normalizes common wording, while the DLL registry owns execution. For a new addon action, use a stable lowercase canonical name and a small alias set; avoid colliding with the table above.

---

# 4. NPC ownership, state and runtime modes

LSA keeps a durable runtime object per controlled/known ped. This is one of the highest-value addon surfaces because it tells us what LSA believes the NPC is currently doing and lets us avoid task fights.

### `LosSantosAlive.NPC.NpcRuntimeMode`

Fields / constants:
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode Passive = 0`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode ReflexOnly = 1`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode ActiveBehavior = 2`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode Conversation = 3`

### `LosSantosAlive.NPC.NpcState`

Fields / constants:
- `public Rage.Ped Ped`
- `public LosSantosAlive.NPC.Roles.NpcRoleType RoleType`
- `public LosSantosAlive.NPC.Roles.NpcRoleProfile RoleProfile`
- `public bool HasBeenTakenOver`
- `public bool StayUnderLsaControl`
- `public bool HasEverHadConversation`
- `public LosSantosAlive.NPC.NpcRuntimeMode RuntimeMode`
- `public bool FollowPlayerOnFoot`
- `public bool FollowPaused`
- `public bool HasDestination`
- `public string DestinationRawRequest`
- `public string DestinationHint`
- `public string DestinationIntent`
- `public string ResolvedDestinationName`
- `public string CurrentDestinationName`
- `public string CurrentDestinationDescription`
- `public Rage.Vector3 DestinationPosition`
- `public bool DestinationResolved`
- `public bool WalkToDestination`
- `public bool DriveToDestination`
- `public System.Collections.Generic.Queue`1<LosSantosAlive.NPC.NpcActivityQueueItem> ActivityQueue`
- `public LosSantosAlive.NPC.NpcActivityQueueItem CurrentActivity`
- `public bool HasActivityQueue`
- `public bool ActivityInProgress`
- `public bool ActivityWaitingForTurn`
- `public uint32 OccupyingActivityPointPedHandle`
- `public string CurrentActivityLocationName`
- `public string CurrentActivityPointName`
- `public string CurrentActivityName`
- `public string CurrentActivityItemName`
- `public int32 ActivityStartTime`
- `public int32 LastActivityTaskTime`
- `public System.Collections.Generic.List`1<string> ActivityUpdatesSinceLastInteraction`
- `public System.Collections.Generic.List`1<string> ContextUpdatesSinceLastInteraction`
- `public System.Collections.Generic.List`1<string> ImmediateContextUpdates`
- `public LosSantosAlive.NPC.Items.NpcHeldItemState HeldItem`
- `public bool EnterDriverSeatWhenPlayerVehicleNearby`
- `public bool EnterPassengerSeatWhenPlayerVehicleNearby`
- `public bool EnterBackPassengerSeatWhenPlayerVehicleNearby`
- `public bool EnterPassengerSeatWhenPlayerEnters`
- `public bool ExitVehicleWhenPlayerExits`
- `public Rage.Vehicle AssignedVehicle`
- `public int32 AssignedVehicleSeatIndex`
- `public bool AssignedVehicleSeatEntryActive`
- `public bool DriveToXWhenBothSeated`
- `public bool DriveEvasiveMode`
- `public string PendingDriveDestinationName`
- `public Rage.Vector3 DriveDestination`
- `public bool HasResolvedDriveDestination`
- `public bool WalkAway`
- `public bool FleePlayer`
- `public bool IntimidatePlayerWithWeapon`
- `public Rage.Ped IntimidateTargetPed`
- `public bool AttackPlayer`
- `public bool TurnAroundMode`
- `public Rage.Ped TurnAroundTargetPed`
- `public bool WalkBackwardsToTargetMode`
- `public Rage.Ped WalkBackwardsTargetPed`
- `public bool LeanAgainstVehicleMode`
- `public bool ApproachTargetMode`
- `public Rage.Ped ApproachTargetPed`
- `public int32 LastApproachTaskTime`
- `public bool ChaseTargetMode`
- `public Rage.Ped ChaseTargetPed`
- `public int32 LastChaseTaskTime`
- `public bool TakeCoverMode`
- `public int32 LastTakeCoverTaskTime`
- `public bool AccompliceMode`
- `public Rage.Ped CurrentFocusPed`
- `public string CurrentFocusReason`
- `public uint32 LastAutoAddressedPedHandle`
- `public uint32 AutoResumeFollowPedHandle`
- `public string ActiveInteractionId`
- `public bool InDirectedInteraction`
- `public bool StopAndFaceTargetMode`
- `public Rage.Ped StopAndFaceTargetPed`
- `public int32 LastStopAndFaceTaskTime`
- `public bool HandsUpMode`
- `public bool WantsHandsUp`
- `public bool KneelMode`
- `public bool SitOnGroundMode`
- `public System.Collections.Generic.HashSet`1<string> BlockedActions`
- `public string ActionBlockReason`
- `public bool BlockPhysicalReflexActions`
- `public string PhysicalReflexBlockReason`
- `public bool HasActiveReflex`
- `public string LastReflexEvent`
- `public LosSantosAlive.NPC.Reflexes.ReflexEventType LastReflexEventType`
- `public string LastReflexReaction`
- `public string LastReflexReason`
- `public int32 LastReflexTime`
- `public bool LastReflexRequestedGeminiSession`
- `public System.Collections.Generic.Dictionary`2<LosSantosAlive.NPC.Reflexes.ReflexEventType, int32> ReflexLastTimes`
- `public System.Collections.Generic.HashSet`1<LosSantosAlive.NPC.Reflexes.ReflexEventType> LockedReflexEvents`
- `public bool ReflexLocked`
- `public int32 ReflexEscalationLevel`
- `public int32 LastFollowTaskTime`
- `public int32 LastVehicleEnterTaskTime`
- `public int32 LastVehicleExitTaskTime`
- `public int32 LastAccompliceUpdateTime`
- `public int32 LastComplianceTaskTime`
- `public int32 LastCombatTaskTime`
- `public int32 LastDriveTaskTime`
- `public int32 LastFocusChangeTime`
- `public int32 LastInteractionTaskTime`
- `public int32 LastDestinationTaskTime`
- `public int32 LastMovementActionTaskTime`
- `public int32 LastReflexOnlyBrainRefreshTime`
- `public bool LastWantedControlledBrain`
- `public Rage.Vehicle TargetVehicle`
- `public uint32 LastKnownWeaponHash`
- `public bool WeaponEquippedMode`
- `public uint32 EquippedWeaponHash`

Properties:
- `bool IsPassiveRuntime { get; }`
- `bool IsReflexOnlyRuntime { get; }`
- `bool IsActiveBehaviorRuntime { get; }`
- `bool IsConversationRuntime { get; }`
- `bool ShouldUseFullBehaviorStack { get; }`

Methods:
- `public bool IsActionBlocked(string normalizedActionName)`
- `public void BlockAction(string normalizedActionName, string reason)`
- `public void BlockActions(System.Collections.Generic.IEnumerable`1<string> normalizedActionNames, string reason)`
- `public void UnblockAction(string normalizedActionName)`
- `public void ClearBlockedActions()`
- `public void PromoteToConversationRuntime()`
- `public void PromoteToActiveBehaviorRuntime()`
- `public void PromoteToReflexOnlyRuntime()`
- `public void DemoteToPassiveRuntime()`

### `LosSantosAlive.NPC.NpcStateStore`

Properties:
- `int32 Count { get; }`

Methods:
- `public static LosSantosAlive.NPC.NpcState GetState(Rage.Ped ped)`
- `public static LosSantosAlive.NPC.NpcState TryGetState(Rage.Ped ped)`
- `public static bool TryGetState(Rage.Ped ped, ref LosSantosAlive.NPC.NpcState state)`
- `public static LosSantosAlive.NPC.NpcState GetStateForReflex(Rage.Ped ped)`
- `public static LosSantosAlive.NPC.NpcState GetStateForActiveBehavior(Rage.Ped ped)`
- `public static LosSantosAlive.NPC.NpcState GetStateForConversation(Rage.Ped ped)`
- `public static void PromoteToReflexOnly(Rage.Ped ped)`
- `public static void PromoteToActiveBehavior(Rage.Ped ped)`
- `public static void PromoteToConversation(Rage.Ped ped)`
- `public static System.Collections.Generic.IEnumerable`1<System.Collections.Generic.KeyValuePair`2<string, LosSantosAlive.NPC.NpcState>> GetAllStates()`
- `public static System.Collections.Generic.List`1<System.Collections.Generic.KeyValuePair`2<string, LosSantosAlive.NPC.NpcState>> GetAllStatesSnapshot()`
- `public static void RemoveState(string key)`
- `public static void RemoveState(Rage.Ped ped)`
- `public static bool HasState(Rage.Ped ped)`
- `public static void Clear()`
- `public static void ClearRecentlyReleased(Rage.Ped ped)`

### `LosSantosAlive.NPC.NpcFocus`

Methods:
- `public static void SetFocus(Rage.Ped actorPed, Rage.Ped targetPed, string reason)`
- `public static void ClearFocus(Rage.Ped actorPed)`
- `public static Rage.Ped GetFocus(Rage.Ped actorPed)`
- `public static bool HasFocus(Rage.Ped actorPed)`
- `public static string GetFocusReason(Rage.Ped actorPed)`

### `LosSantosAlive.NPC.NpcTargeting`

Properties:
- `bool IsFirstConversationWarmupComplete { get; }`
- `Rage.Ped PlayerConversationPed { get; }`
- `bool HasPlayerConversationPed { get; }`
- `Rage.Ped CurrentSpeakerPed { get; }`
- `bool HasCurrentSpeaker { get; }`

Methods:
- `public static void WarmupForFirstConversation()`
- `public static void BeginFirstConversationWarmup()`
- `public static void SetPlayerConversationPed(Rage.Ped ped)`
- `public static Rage.Ped GetPlayerConversationPed()`
- `public static void ClearPlayerConversationPed()`
- `public static void ActivateAttention(Rage.Ped ped)`
- `public static Rage.Ped GetCurrentSpeakerPed()`
- `public static void ClearCurrentSpeaker()`
- `public static Rage.Ped GetRelevantTarget(Rage.Ped speakerPed)`
- `public static bool TryGetRelevantTarget(Rage.Ped speakerPed, ref Rage.Ped targetPed)`
- `public static Rage.Ped SetRelevantTarget(Rage.Ped speakerPed, Rage.Ped targetPed, string reason)`
- `public static Rage.Ped GetBestConversationPed()`
- `public static Rage.Ped GetBestConversationPed(Rage.Ped excludedPed)`
- `public static Rage.Ped GetBestConversationPed(float32 cameraMaxDistance, float32 nearestFallbackDistance)`
- `public static Rage.Ped GetBestConversationPed(float32 cameraMaxDistance, float32 nearestFallbackDistance, Rage.Ped excludedPed)`
- `public static Rage.Ped GetNearestPed()`
- `public static Rage.Ped GetNearestPed(Rage.Ped excludedPed)`
- `public static Rage.Ped GetNearestPed(float32 maxDistance)`
- `public static Rage.Ped GetNearestPed(float32 maxDistance, Rage.Ped excludedPed)`
- `public static bool IsValid(Rage.Ped ped)`
- `public static bool IsValidAnyPed(Rage.Ped ped)`
- `public static bool IsValidHumanPed(Rage.Ped ped)`
- `public static bool IsHumanPed(Rage.Ped ped)`

### Runtime modes

- `Passive = 0`
- `ReflexOnly = 1`
- `ActiveBehavior = 2`
- `Conversation = 3`

A useful working interpretation is:
- `Passive` — record/context may exist but LSA should not run the full behavior stack.
- `ReflexOnly` — LSA may react to immediate stimuli without promoting the NPC into a full authored actor.
- `ActiveBehavior` — LSA behavior state is actively controlling the NPC.
- `Conversation` — full conversation behavior/context path is active.

`NpcStateStore.GetStateForConversation` is validated to obtain the state and promote it to conversation runtime. Equivalent explicit promotion helpers exist for reflex-only and active behavior.

### How-to: observe LSA NPCs without taking ownership

```csharp
foreach (var kv in NpcStateStore.GetAllStatesSnapshot())
{
    var state = kv.Value;
    var ped = state.Ped;
    if (ped == null || !ped.Exists()) continue;

    // Read RuntimeMode, CurrentActivity, focus, reflex fields, vehicle state, etc.
    // Prefer the snapshot enumerator rather than mutating the live store while iterating.
}
```

### How-to: temporarily block one of LSA's actions for one NPC

```csharp
var state = NpcStateStore.GetStateForActiveBehavior(ped);
state.BlockAction("attacktargetwithweapon", "our_plugin_safe_zone");

// Later:
state.UnblockAction("attacktargetwithweapon");
```

`NpcState` also exposes `BlockPhysicalReflexActions`, `PhysicalReflexBlockReason`, `LockedReflexEvents`, and `ReflexLocked`. These are useful coordination flags, but prefer the narrowest possible block and always restore it. Do not set global/reflex locks permanently.

### High-value `NpcState` families

- **Ownership/runtime:** `HasBeenTakenOver`, `StayUnderLsaControl`, `HasEverHadConversation`, `RuntimeMode`.
- **Focus/interactions:** `CurrentFocusPed`, `CurrentFocusReason`, `ActiveInteractionId`, `InDirectedInteraction`.
- **Destination:** requested/hint/intent strings, resolved name/position, walk/drive flags.
- **Vehicle:** assigned vehicle, seat intent, current entry state, pending drive destination, evasive mode.
- **Combat/compliance:** flee, attack, intimidate, take-cover, hands-up, kneel, sit-on-ground modes.
- **Reflex:** active reflex, event/reaction/reason/time, escalation, per-event timestamps/locks.
- **Activities/items:** activity queue/current activity, occupied point handle, current location/activity/item names, held item.
- **Action governance:** blocked actions + reason and physical-reflex block state.

---

# 5. Reflex events: feed LSA world events instead of inventing another reaction system

### `LosSantosAlive.NPC.Reflexes.ReflexEventType`

Fields / constants:
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType None = 0`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerAimedGunAtPed = 1`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PedTazed = 2`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PedShot = 3`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayfullyHit = 4`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMeleeThreatenedPed = 5`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerHitPedWithVehicle = 6`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMinorVehicleCrash = 7`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMediumVehicleCrash = 8`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMajorVehicleCrash = 9`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType SuspectFleeStarted = 10`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType GunshotNearby = 11`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType ExplosionNearby = 12`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType VehicleThreatNearby = 13`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType NearbyPanic = 14`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType WitnessedViolence = 15`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType WitnessedDeath = 16`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType WitnessedVehicleRamming = 17`

### `LosSantosAlive.NPC.Reflexes.ReflexReactionType`

Fields / constants:
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType None = 0`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType PutHandsUp = 1`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType Flee = 2`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType WalkAway = 3`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType Chase = 4`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType Attack = 5`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType IntimidatePlayerWithWeapon = 6`

### `LosSantosAlive.NPC.Reflexes.ReflexRepeatMode`

Fields / constants:
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexRepeatMode OnceEver = 0`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexRepeatMode Cooldown = 1`

### `LosSantosAlive.NPC.Reflexes.ReflexEventDefinition`

Fields / constants:
- `public LosSantosAlive.NPC.Reflexes.ReflexEventType EventType`
- `public LosSantosAlive.NPC.Reflexes.ReflexRepeatMode RepeatMode`
- `public bool ShouldStartGeminiSession`
- `public bool ShouldInterruptGeminiSession`
- `public int32 CooldownMs`
- `public int32 Priority`
- `public System.Collections.Generic.Dictionary`2<LosSantosAlive.NPC.Reflexes.ReflexReactionType, int32> ReactionWeights`

### `LosSantosAlive.NPC.Reflexes.ReflexResult`

Fields / constants:
- `public Rage.Ped Ped`
- `public Rage.Ped SourcePed`
- `public LosSantosAlive.NPC.Reflexes.ReflexEventType EventType`
- `public LosSantosAlive.NPC.Reflexes.ReflexReactionType ReactionType`
- `public bool ShouldStartGeminiSession`
- `public bool ShouldInterruptGeminiSession`
- `public string EventReason`
- `public string ReactionReason`

### `LosSantosAlive.NPC.Reflexes.ReflexSystem`

Fields / constants:
- `public static literal bool DebugDrawReflexLines = False`

Methods:
- `public static LosSantosAlive.NPC.Reflexes.ReflexResult Trigger(Rage.Ped ped, Rage.Ped sourcePed, LosSantosAlive.NPC.Reflexes.ReflexEventType eventType, string eventReason)`

### Known reflex event values

- `None = 0`
- `PlayerAimedGunAtPed = 1`
- `PedTazed = 2`
- `PedShot = 3`
- `PlayfullyHit = 4`
- `PlayerMeleeThreatenedPed = 5`
- `PlayerHitPedWithVehicle = 6`
- `PlayerMinorVehicleCrash = 7`
- `PlayerMediumVehicleCrash = 8`
- `PlayerMajorVehicleCrash = 9`
- `SuspectFleeStarted = 10`
- `GunshotNearby = 11`
- `ExplosionNearby = 12`
- `VehicleThreatNearby = 13`
- `NearbyPanic = 14`
- `WitnessedViolence = 15`
- `WitnessedDeath = 16`
- `WitnessedVehicleRamming = 17`

### Known reflex reactions

- `None = 0`
- `PutHandsUp = 1`
- `Flee = 2`
- `WalkAway = 3`
- `Chase = 4`
- `Attack = 5`
- `IntimidatePlayerWithWeapon = 6`

### How-to: inject an addon-observed stimulus

```csharp
var result = ReflexSystem.Trigger(
    ped,
    sourcePed,
    ReflexEventType.GunshotNearby,
    "our_plugin: scripted gunshot");

if (result != null)
{
    // Inspect selected reaction and whether LSA wants to start/interrupt a Gemini session.
}
```

Use this when our addon sees a meaningful event LSA itself cannot see. If an LSA detector already covers the event, injecting another copy can double-trigger. Check `ReflexLastTimes`, `LockedReflexEvents`, or our own dedupe before firing synthetic events.

Readable detector types include `GunAimReflexDetector`, `GunshotReflexDetector`, `MeleeThreatReflexDetector`, `PedShotReflexDetector`, `SuspectFleeReflexDetector`, and `VehicleCrashReflexDetector`. The enum also reserves explosion, vehicle-threat, panic, witnessed-violence/death/ramming events, so the event model is broader than the currently obvious detector list.

---

# 6. Directed NPC ↔ NPC interactions

### `LosSantosAlive.NPC.DirectedInteractionManager`

Events:
- `NpcToNpcInteractionReady` (accessors: `add_NpcToNpcInteractionReady, remove_NpcToNpcInteractionReady`)
- `NpcToNpcInteractionEnded` (accessors: `add_NpcToNpcInteractionEnded, remove_NpcToNpcInteractionEnded`)

Methods:
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed)`
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed, string startingAction)`
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed, string startingAction, string targetReaction)`
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed, string startingAction, string targetReaction, bool stayInPlace)`
- `public static string StartFelonyStopInteraction(Rage.Ped officerPed, Rage.Ped targetPed)`
- `public static string StartFelonyStopInteraction(Rage.Ped officerPed, Rage.Ped targetPed, Rage.Vehicle sourceVehicle)`
- `public static bool SetStartingActionForPed(Rage.Ped ped, string startingAction)`
- `public static void StopInteraction(string interactionId)`
- `public static void StopInteractionForPed(Rage.Ped ped)`
- `public static void DetachInteractionForPlayerConversation(Rage.Ped ped)`
- `public static void ForceStopInteractionForPed(Rage.Ped ped)`
- `public static void MarkOpeningLineFinished(string interactionId)`
- `public static void MarkInteractionActive(string interactionId)`
- `public static void Update()`
- `public static bool ShouldSuppressAuthoredSetupReflex(Rage.Ped reactingPed, Rage.Ped sourcePed, LosSantosAlive.NPC.Reflexes.ReflexEventType eventType)`
- `public static bool ShouldSuppressAuthoredSetupReflex(Rage.Ped reactingPed, Rage.Ped sourcePed)`
- `public static bool IsPedInInteraction(Rage.Ped ped)`
- `public static bool IsInteractionActive(string interactionId)`
- `public static Rage.Ped GetInteractionPartner(Rage.Ped ped)`
- `public static string GetPedId(Rage.Ped ped)`

The manager exposes two especially useful events:
- `NpcToNpcInteractionReady`: `Action<string, Rage.Ped, Rage.Ped>` — interaction ID, speaker, target.
- `NpcToNpcInteractionEnded`: `Action<string>` — interaction ID.

### How-to: start an authored NPC-to-NPC exchange

```csharp
DirectedInteractionManager.NpcToNpcInteractionReady += (id, speaker, target) =>
{
    // Our scene can mark itself active or yield animation/task ownership.
};

DirectedInteractionManager.NpcToNpcInteractionEnded += id =>
{
    // Resume addon scene logic.
};

string id = DirectedInteractionManager.StartInteraction(speaker, target);
```

There are overloads that accept a starting action, a target reaction, and `stayInPlace`, plus `StartFelonyStopInteraction` overloads. Lifecycle helpers include `MarkOpeningLineFinished`, `MarkInteractionActive`, stop/detach/force-stop methods, partner lookup, and authored-setup-reflex suppression checks.

**Preferred use:** let LSA own the interaction while our addon owns the scene goal. Do not simultaneously task the same peds unless `OnPedControlChanged` tells us LSA has released them.

---

# 7. Context and hydration: teach LSA about our mod

### `LosSantosAlive.Context.ActorContext`

Fields / constants:
- `public bool Exists`
- `public string Label`
- `public string PedId`
- `public string PedModel`
- `public string Gender`
- `public string AgeRange`
- `public string Archetype`
- `public string ArchetypeDescription`
- `public string ArchetypePerceivedDescription`
- `public string Activity`
- `public string InteractionActivityContext`
- `public string RoleName`
- `public string RoleContext`
- `public bool IsArmed`
- `public string WeaponDescription`
- `public string EquippedWeaponDescription`
- `public string AvailableWeaponsContext`
- `public System.Collections.Generic.List`1<string> AvailableWeapons`
- `public string VehicleContext`
- `public string RecentVehicleContext`
- `public bool HasActiveReflex`
- `public string ReflexEvent`
- `public string ReflexReaction`
- `public string ReflexReason`
- `public int32 ReflexEscalationLevel`
- `public string StreetName`
- `public string CrossingStreetName`
- `public string ZoneCode`
- `public bool IsIndoors`
- `public string LocationContext`
- `public string AvailableActivitiesContext`
- `public string RadioContext`
- `public string NearbyPeopleContext`
- `public System.Collections.Generic.Dictionary`2<string, string> NearbyPersonReferences`
- `public System.Collections.Generic.Dictionary`2<string, string> NearbyVehicleReferences`
- `public System.Collections.Generic.List`1<LosSantosAlive.Integrations.IntegrationJsonBlock> IntegrationBlocks`

### `LosSantosAlive.Integrations.IntegrationJsonBlock`

Properties:
- `string Id { set; get; }`
- `string Json { get; set; }`

### `LosSantosAlive.Context.ActorHydrationCoordinator`

Methods:
- `public static bool IsActorHydrationRequest(string json)`
- `public static void HandleRequest(string json)`
- `public static void Update()`

### `LosSantosAlive.Context.ConversationHydrationCoordinator`

Methods:
- `public static void BeginMicTurn(Rage.Ped ped)`
- `public static void MarkMicReleased(Rage.Ped ped)`
- `public static void Update()`

### `LosSantosAlive.Context.GeminiContextBuilder`

Methods:
- `public static void LoadArchetypesIni()`
- `public static string BuildContextJson(string type, Rage.Ped ped, string text)`
- `public static string BuildInteractionContextJson(string type, Rage.Ped speakerPed, Rage.Ped targetPed, string text, string interactionId, string interactionType)`

### `LosSantosAlive.Context.ContextJsonSerializer`

Methods:
- `public static string Build(LosSantosAlive.Context.ContextSnapshot snapshot)`

`ActorContext` already carries identity/model, gender/age/archetype, current activity, role, weapon/vehicle context, recent vehicle context, reflex state, street/zone/interior/location/activity context, radio context, nearby people/references, and `IntegrationBlocks`.

### How-to: enrich an actor cleanly

The intended route is `IIntegration.EnrichActor(ped, context)`. Put addon-specific structured material into `context.IntegrationBlocks` under a unique ID instead of overloading unrelated core fields.

```csharp
public void EnrichActor(Ped ped, ActorContext context)
{
    context.IntegrationBlocks.Add(new IntegrationJsonBlock
    {
        Id = "our.enhancement",
        Json = "{\"sceneRole\":\"witness\",\"knowsSuspect\":true}"
    });
}
```

If the exact `IntegrationJsonBlock` setter shape changes in a later build, construct it through its preserved constructor or reflection; the conceptual seam (`IntegrationBlocks`) is the important part.

### Reuse LSA providers rather than recalculate
Readable providers include `ActorContextProvider`, `ActivityContextProvider`, `NearbyPersonContextProvider`, `RadioContextProvider`, `VehicleContextProvider`, `WeaponContextProvider`, and `WorldContextProvider`. When we need the same notion of “nearby person,” “current interior,” or “actor weapon context” that LSA itself uses, prefer calling these providers over independently inventing a conflicting definition.

---

# 8. Audio / speech lifecycle — one of the best hooks in the new build

### `LosSantosAlive.Audio.NpcPlaybackStartedEvent`

Fields / constants:
- `public Rage.Ped SpeakerPed`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`

### `LosSantosAlive.Audio.NpcPlaybackEndedEvent`

Fields / constants:
- `public Rage.Ped SpeakerPed`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`
- `public string Reason`
- `public bool WasInterrupted`
- `public bool HadAudio`
- `public bool PlaybackStarted`

### `LosSantosAlive.Audio.NpcAudioTurn`

Fields / constants:
- `public Rage.Ped SpeakerPed`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`
- `public string Key`
- `public Rage.Ped ListenerPed`
- `public string ListenerPedId`
- `public bool FaceListener`
- `public bool IsLegacy`
- `public bool StreamEnded`
- `public bool Cancelled`
- `public bool CompletionEmitted`
- `public bool StartEventEmitted`
- `public bool EndEventEmitted`
- `public bool HadAudio`
- `public bool PlaybackStarted`
- `public int32 CreatedAt`
- `public int32 LastChunkAt`
- `public int32 EstimatedPlaybackEndAt`
- `public int32 CompletedAt`

### `LosSantosAlive.Audio.NpcAudioQueue`

Events:
- `AudioPlaybackFinished` (accessors: `remove_AudioPlaybackFinished, add_AudioPlaybackFinished`)

Methods:
- `public static void Initialize()`
- `public static void QueueAudioChunk(uint8[] chunk)`
- `public static void QueueAudioChunk(uint8[] chunk, Rage.Ped speakerPed)`
- `public static bool HasPendingAudioForPed(Rage.Ped ped)`
- `public static bool IsAnyAudioPlayingOrPending()`
- `public static bool IsPedCurrentlySpeaking(Rage.Ped ped)`
- `public static Rage.Ped GetActiveSpeakerPed()`
- `public static void InterruptSpeechForPed(Rage.Ped ped, string reason)`
- `public static void InterruptSpeechForPed(Rage.Ped ped)`
- `public static void StopSpeechForPlayerMicInterrupt(Rage.Ped ped)`
- `public static void Clear()`
- `public static void Shutdown()`

### `LosSantosAlive.Audio.NpcPlaybackCoordinator`

Events:
- `LegacyPlaybackFinished` (accessors: `remove_LegacyPlaybackFinished, add_LegacyPlaybackFinished`)
- `PlaybackStarted` (accessors: `add_PlaybackStarted, remove_PlaybackStarted`)
- `PlaybackEnded` (accessors: `add_PlaybackEnded, remove_PlaybackEnded`)

Methods:
- `public static void Initialize()`
- `public static bool TryAuthorizeTurn(Rage.Ped speakerPed, string turnId, int64 generationId, ref string rejectionReason, Rage.Ped listenerPed, string listenerPedId, bool faceListener)`
- `public static bool QueueTaggedAudioChunk(uint8[] pcm, Rage.Ped speakerPed, string turnId, int64 generationId, ref string rejectionReason)`
- `public static void QueueLegacyAudioChunk(uint8[] pcm, Rage.Ped speakerPed)`
- `public static bool MarkStreamEnded(string pedId, string turnId, int64 generationId, ref string rejectionReason)`
- `public static bool InterruptExactTurn(Rage.Ped speakerPed, string turnId, int64 generationId, string reason)`
- `public static bool InterruptExactTurn(string pedId, Rage.Ped speakerPed, string turnId, int64 generationId, string reason)`
- `public static void InterruptPed(Rage.Ped speakerPed, string reason)`
- `public static bool HasPendingAudioForPed(Rage.Ped ped)`
- `public static bool IsAnyAudioPlayingOrPending()`
- `public static bool IsPedCurrentlySpeaking(Rage.Ped ped)`
- `public static Rage.Ped GetActiveSpeakerPed()`
- `public static void Clear()`
- `public static void ResetForTransportDisconnect()`
- `public static void Shutdown()`

### `LosSantosAlive.Bridge.NpcAudioProtocolMessage`

Fields / constants:
- `public string Type`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`
- `public string Reason`
- `public string AudioBase64`
- `public string ListenerPedId`
- `public bool FaceListener`

Properties:
- `bool HasCompleteTurnIdentity { get; }`
- `bool HasAnyTurnIdentity { get; }`

### `LosSantosAlive.Bridge.NpcAudioProtocol`

Fields / constants:
- `public static literal int32 ProtocolVersion = 3`

Methods:
- `public static bool IsAudioMessageType(string type)`
- `public static bool TryParse(string json, ref LosSantosAlive.Bridge.NpcAudioProtocolMessage message, ref string error)`
- `public static string BuildEndpointReady()`
- `public static string BuildTurnDecision(bool accepted, string pedId, string turnId, int64 generationId, string reason)`
- `public static string BuildPlaybackStarted(LosSantosAlive.Audio.NpcPlaybackStartedEvent playback)`
- `public static string BuildPlaybackEnded(LosSantosAlive.Audio.NpcPlaybackEndedEvent playback)`
- `public static string BuildApproachResult(bool succeeded, string pedId, string targetPedId, string turnId, int64 generationId, string conversationId, string reason, float32 distance)`
- `public static string BuildLegacyAudioFinished(string pedId)`

`NpcAudioProtocol.ProtocolVersion` is `3`. The coordinator authorizes and identifies audio by a tuple containing **ped identity + turn ID + generation ID**. The generation ID is important: it gives LSA a way to reject stale chunks/ends from a superseded turn.

### How-to: react when an LSA NPC actually begins/finishes audible speech

```csharp
NpcPlaybackCoordinator.PlaybackStarted += e =>
{
    // Duck our radio, pause subtitles, face the speaker, etc.
    // e carries speaker/ped identity + turn/generation identity.
};

NpcPlaybackCoordinator.PlaybackEnded += e =>
{
    // Resume. End event also reports reason/interruption/had-audio/playback-started state.
};
```

This is preferable to guessing “speaking” from timers or model requests. The event represents playback state in the game-side coordinator.

### How-to: interrupt only the exact speech turn we own

Use `InterruptExactTurn(...)` when our addon has retained the corresponding turn/generation identity. Avoid broad `InterruptPed` unless the whole speaker must be silenced, because it can cancel speech initiated by another subsystem.

---

# 9. Special Gemini turns — addon barks / authored AI speech

### `LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest`

Fields / constants:
- `public Rage.Ped SpeakerPed`
- `public Rage.Ped ListenerPed`
- `public Rage.Ped SpeechTargetPed`
- `public string Content`
- `public string Reason`
- `public string DedupeKey`
- `public bool FaceListener`
- `public bool InterruptExisting`
- `public int32 DelayMilliseconds`
- `public bool CancelIfPlayerStartsTurn`
- `public bool RequireCurrentPlayerConversation`
- `public bool SkipIfSpeakerBusy`

### `LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnScheduler`

Methods:
- `public static bool Submit(LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest request)`
- `public static bool SubmitAfterCurrentTurn(LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest request)`
- `public static void Cancel(string dedupeKey, Rage.Ped speakerPed)`
- `public static void CancelAll()`

### `LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService`

Methods:
- `public static void NotifyPlayerTurnStarted()`
- `public static int64 ReadPlayerTurnVersion()`
- `public static bool SendNow(LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest request)`

This is a much safer way to make an LSA actor say context-aware speech than manually constructing WebSocket messages.

### How-to: queue a non-player special turn

```csharp
var request = new SpecialGeminiTurnRequest
{
    SpeakerPed = witness,
    ListenerPed = player,
    SpeechTargetPed = player,
    Content = "React briefly to the crash you just witnessed.",
    Reason = "our_plugin_witness_bark",
    DedupeKey = $"our_plugin:witness:{witness.Handle}:crash",
    FaceListener = true,
    InterruptExisting = false,
    DelayMilliseconds = 250,
    CancelIfPlayerStartsTurn = true,
    RequireCurrentPlayerConversation = false,
    SkipIfSpeakerBusy = true
};

SpecialGeminiTurnScheduler.SubmitAfterCurrentTurn(request);
```

Use a deterministic `DedupeKey` for scene events. Cancel it with `Cancel(dedupeKey, speakerPed)` if the underlying event becomes invalid (ped dies, scene ends, player leaves, etc.). `SubmitAfterCurrentTurn` is the polite default; `Submit`/`SendNow` are for cases that genuinely need immediacy.

---

# 10. Perception, targeting and reference resolution

### `LosSantosAlive.NPC.Perception.PerceptionSnapshot`

Fields / constants:
- `public Rage.Ped Player`
- `public Rage.Ped[] AllPeds`
- `public Rage.Vehicle[] AllVehicles`
- `public int32 GameTime`

Properties:
- `bool IsValid { get; }`

Methods:
- `public bool TryGetPedByHandleString(string pedId, ref Rage.Ped ped)`
- `public bool TryGetPedByHandle(uint32 handle, ref Rage.Ped ped)`
- `public static LosSantosAlive.NPC.Perception.PerceptionSnapshot Capture()`

### `LosSantosAlive.NPC.Perception.PerceptionSystem`

Properties:
- `LosSantosAlive.NPC.Perception.PerceptionSnapshot CurrentSnapshot { get; }`

Methods:
- `public static LosSantosAlive.NPC.Perception.PerceptionSnapshot Update()`
- `public static bool TryGetSnapshot(ref LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`
- `public static Rage.Ped[] GetPedsSnapshot()`
- `public static Rage.Vehicle[] GetVehiclesSnapshot()`
- `public static Rage.Ped FindPedByHandleString(string pedId)`
- `public static Rage.Ped FindPedByHandle(uint32 handle)`

### `LosSantosAlive.NPC.Targeting.NpcReferenceResolver`

Properties:
- `System.Func`2<Rage.Ped, Rage.Ped> CurrentSpeakerProvider { set; get; }`
- `System.Func`2<Rage.Ped, bool> ActiveLsaStateProvider { get; set; }`
- `System.Func`2<Rage.Ped, bool> ResponderProvider { set; get; }`

Methods:
- `public static ResolveResult Resolve(Rage.Ped sourcePed, string referenceText)`
- `public static ResolveResult Resolve(Rage.Ped sourcePed, string referenceText, float32 maxDistance)`
- `public static ResolveResult Resolve(Rage.Ped sourcePed, string referenceText, float32 maxDistance, bool useDirectionalBias)`
- `public static ResolveResult Resolve(Rage.Ped sourcePed, Rage.Ped currentSpeaker, string referenceText, float32 maxDistance, bool useDirectionalBias)`
- `public static Rage.Ped ResolvePedOrNull(Rage.Ped sourcePed, string referenceText)`

### `LosSantosAlive.NPC.Targeting.VehicleTargetResolver`

Methods:
- `public static Result ResolveVehicle(string hint, Rage.Ped speaker, Rage.Ped currentTargetPed)`
- `public static Result ResolveVehicle(string hint, Rage.Ped speaker, Rage.Ped currentTargetPed, Options options)`

### How-to: share LSA's world snapshot

Use `PerceptionSystem.CurrentSnapshot` / `TryGetSnapshot` / `GetPedsSnapshot` / `GetVehiclesSnapshot` when our addon only needs the same near-current world view. This avoids doing another full world enumeration every frame.

`NpcReferenceResolver` and `VehicleTargetResolver` are useful when our feature takes natural-language references or wants to resolve “that officer / suspect / car” the same way LSA does. Avoid replacing the resolver's global provider delegates unless our plugin is explicitly taking responsibility for them; call the resolver rather than hijacking its dependencies.

---

# 11. Items / props as an extension registry

### `LosSantosAlive.NPC.Items.NpcItemDefinition`

Properties:
- `string Name { get; set; }`
- `string DisplayName { get; set; }`
- `string PropModel { get; set; }`
- `string AnimDict { set; get; }`
- `string AnimName { set; get; }`
- `float32 HoldFrame { get; set; }`
- `LosSantosAlive.NPC.Items.NpcItemHand Hand { get; set; }`
- `Rage.Vector3 PositionOffset { set; get; }`
- `Rage.Vector3 RotationOffset { set; get; }`
- `string ContextHoldingText { get; set; }`
- `string UseActionName { get; set; }`
- `string UseActionDescription { get; set; }`
- `int32 BoneId { get; }`
- `bool HasProp { get; }`
- `bool HasAnimation { get; }`
- `bool HasUseAction { get; }`

### `LosSantosAlive.NPC.Items.NpcHeldItemState`

Properties:
- `string ItemName { set; get; }`
- `Rage.Object Prop { set; get; }`
- `bool IsBusy { get; set; }`
- `int32 LastMaintenanceTime { set; get; }`
- `int32 LastAnimRefreshTime { set; get; }`
- `string LastPropModel { get; set; }`
- `bool PropAttachFailedLogged { set; get; }`
- `bool IsHoldingItem { get; }`

Methods:
- `public void Clear()`

### `LosSantosAlive.NPC.Items.NpcItemStore`

Methods:
- `public static void RegisterDefaults()`
- `public static void Register(LosSantosAlive.NPC.Items.NpcItemDefinition item)`
- `public static bool TryGet(string name, ref LosSantosAlive.NPC.Items.NpcItemDefinition item)`
- `public static System.Collections.Generic.IEnumerable`1<LosSantosAlive.NPC.Items.NpcItemDefinition> GetAll()`
- `public static void Clear()`

### How-to: register an addon item

`NpcItemDefinition` carries a name/display name, prop model, animation dictionary/name, hold frame/hand, position + rotation offsets, context text, use action name/description, bone ID, and flags describing prop/animation/use support. Build a definition and call `NpcItemStore.Register(definition)` during startup.

This gives our custom action/activity a vocabulary LSA can retain in `NpcState.HeldItem` instead of treating the prop as invisible external state.

---

# 12. Locations and activities — extend LSA’s world knowledge

### `LosSantosAlive.Locations.LocationDefinition`

Properties:
- `string Name { set; get; }`
- `string Zone { get; set; }`
- `System.Collections.Generic.List`1<string> Aliases { get; set; }`
- `System.Collections.Generic.List`1<string> Categories { get; set; }`
- `System.Collections.Generic.List`1<string> IntentTags { get; set; }`
- `Rage.Vector3 ReferencePoint { get; set; }`
- `System.Nullable`1<int32> InteriorId { set; get; }`
- `string Description { get; set; }`
- `System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityPoint> ActivityPoints { set; get; }`

### `LosSantosAlive.Locations.ActivityPoint`

Properties:
- `string Name { set; get; }`
- `Rage.Vector3 Position { set; get; }`
- `float32 Heading { get; set; }`
- `System.Collections.Generic.List`1<string> IntentTags { get; set; }`
- `System.Collections.Generic.List`1<string> RequiredAccessTags { get; set; }`
- `bool HiddenFromDestinationResolvingIfUnauthorized { get; set; }`
- `string UnauthorizedLabel { get; set; }`
- `System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityDefinition> Activities { set; get; }`
- `System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityItemDefinition> Items { get; set; }`
- `uint32 OccupiedByPedHandle { get; set; }`

### `LosSantosAlive.Locations.ActivityDefinition`

Properties:
- `string Name { get; set; }`
- `string DisplayName { set; get; }`
- `bool BlockedWhenOccupied { get; set; }`
- `bool OnlyWhenOccupied { get; set; }`
- `System.Collections.Generic.List`1<string> ExcludedRoles { get; set; }`
- `System.Collections.Generic.List`1<string> ExcludedModels { set; get; }`
- `System.Collections.Generic.List`1<string> RequiredAccessTags { get; set; }`
- `bool BlockIfUnauthorized { set; get; }`
- `bool IllegalIfUnauthorized { get; set; }`
- `bool SuspiciousIfUnauthorized { get; set; }`
- `string UnauthorizedLabel { set; get; }`
- `string ExecutorType { set; get; }`
- `string ExecutorValue { set; get; }`
- `int32 BeforeDelayMs { get; set; }`
- `int32 AfterDelayMs { set; get; }`
- `bool OccupiesPointWhileRunning { set; get; }`
- `string CompletionText { get; set; }`

### `LosSantosAlive.Locations.ActivityItemDefinition`

Properties:
- `string Name { set; get; }`
- `System.Collections.Generic.List`1<string> Aliases { set; get; }`
- `string ItemId { set; get; }`

### `LosSantosAlive.Locations.LocationRegistry`

Fields / constants:
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> Locations`

### `LosSantosAlive.Locations.LocationIndex`

Fields / constants:
- `public static initonly System.Collections.Generic.Dictionary`2<string, LosSantosAlive.Locations.LocationDefinition> ByName`
- `public static initonly System.Collections.Generic.Dictionary`2<string, System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition>> ByAlias`
- `public static initonly System.Collections.Generic.Dictionary`2<string, System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition>> ByCategory`
- `public static initonly System.Collections.Generic.Dictionary`2<int32, LosSantosAlive.Locations.LocationDefinition> ByInteriorId`

Methods:
- `public static void Build()`

### `LosSantosAlive.Locations.LocationResolver`

Methods:
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string query)`
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string query, Rage.Ped actor)`
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string destinationHint, string intent)`
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string destinationHint, string intent, Rage.Ped actor)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string query)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string query, Rage.Ped actor)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string destinationHint, string intent)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string destinationHint, string intent, Rage.Ped actor)`
- `public static LosSantosAlive.Locations.LocationDefinition ResolveByInteriorId(int32 interiorId)`

### `LosSantosAlive.Locations.LocationAwarenessService`

Methods:
- `public static LosSantosAlive.Locations.LocationDefinition GetLocationForInterior(int32 interiorId)`
- `public static LosSantosAlive.Locations.LocationDefinition GetNearestLocation(Rage.Vector3 position, float32 maxDistance)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> GetNearbyLocations(Rage.Vector3 position, float32 maxDistance)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDistanceResult> GetNearbyLocationResults(Rage.Vector3 position, float32 maxDistance)`

### `LosSantosAlive.Locations.ActivityTemplates`

Methods:
- `public static LosSantosAlive.Locations.ActivityDefinition UseScenario(string name, string displayName, string scenarioName, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition TakeItem(string name, string displayName, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition InitiateDirectInteraction(string name, string displayName, string targetRole, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition CustomExecutor(string name, string displayName, string executorType, string executorValue, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition Browse(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition Grab(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition PayForItems(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition UseAtm(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition UseCashRegister(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition RobCashRegister(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition OpenSafe(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition RobSafe(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition WaitTurn()`
- `public static LosSantosAlive.Locations.ActivityDefinition TalkToOccupant()`
- `public static LosSantosAlive.Locations.ActivityDefinition SuspiciousIfUnauthorized(LosSantosAlive.Locations.ActivityDefinition activity, string label)`
- `public static LosSantosAlive.Locations.ActivityDefinition IllegalIfUnauthorized(LosSantosAlive.Locations.ActivityDefinition activity, string label)`
- `public static LosSantosAlive.Locations.ActivityDefinition BlockIfUnauthorized(LosSantosAlive.Locations.ActivityDefinition activity, string accessTag, string label)`

### `LosSantosAlive.Locations.AccessTagService`

Methods:
- `public static System.Collections.Generic.List`1<string> GetAccessTags(Rage.Ped ped)`
- `public static bool HasAccessTag(Rage.Ped ped, string accessTag)`

LSA models places as `LocationDefinition` objects with aliases/categories/intent tags/reference point/interior ID/description and a set of `ActivityPoint`s. Activity points can require access tags, hide themselves from destination resolving when unauthorized, carry activities/items, and track occupancy.

### How-to: add a custom destination/activity location

1. Construct a `LocationDefinition` with a unique name and useful aliases/categories/intent tags.
2. Add one or more `ActivityPoint`s with world position/heading and any required access tags.
3. Add `ActivityDefinition`s / item definitions to those points, or use helpers from `ActivityTemplates`.
4. Append it to `LocationRegistry.Locations`.
5. Rebuild the derived lookup with `LocationIndex.Build()`.
6. Do this at initialization, not continuously. The registry/index are global mutable state.

This is potentially a very strong path for addon interiors: instead of our mod telling Gemini “go to X” while LSA knows nothing about X, we can register X into LSA’s destination model.

---

# 13. Roles and role-restricted actions

### `LosSantosAlive.NPC.Roles.NpcRoleType`

Fields / constants:
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType None = 0`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Civilian = 1`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Accomplice = 10`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType PoliceShowUnit = 20`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Negotiator = 21`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType SwatShowUnit = 22`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType StoreClerk = 30`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType TaxiDriver = 40`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Paramedic = 50`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType GangMember = 60`

### `LosSantosAlive.NPC.Roles.NpcRoleProfile`

Fields / constants:
- `public LosSantosAlive.NPC.Roles.NpcRoleType RoleType`
- `public string RoleName`
- `public string PromptContext`
- `public System.Collections.Generic.HashSet`1<string> AllowedActions`

Properties:
- `bool HasActionRestrictions { get; }`

Methods:
- `public bool AllowsAction(string normalizedActionName)`

### `LosSantosAlive.NPC.Roles.NpcRoleRegistry`

Methods:
- `public static void Register(LosSantosAlive.NPC.Roles.NpcRoleProfile profile)`
- `public static LosSantosAlive.NPC.Roles.NpcRoleProfile Get(LosSantosAlive.NPC.Roles.NpcRoleType roleType)`

### `LosSantosAlive.NPC.Roles.NpcRoleManager`

Methods:
- `public static void AssignRole(Rage.Ped ped, LosSantosAlive.NPC.Roles.NpcRoleType roleType)`
- `public static void AssignRole(LosSantosAlive.NPC.NpcState state, LosSantosAlive.NPC.Roles.NpcRoleType roleType)`
- `public static LosSantosAlive.NPC.Roles.NpcRoleProfile GetRoleProfile(LosSantosAlive.NPC.NpcState state)`
- `public static bool CanUseAction(LosSantosAlive.NPC.NpcState state, string normalizedActionName)`
- `public static string GetPromptContext(LosSantosAlive.NPC.NpcState state)`
- `public static string GetRoleName(LosSantosAlive.NPC.NpcState state)`
- `public static bool HasRole(LosSantosAlive.NPC.NpcState state, LosSantosAlive.NPC.Roles.NpcRoleType roleType)`
- `public static void ClearRole(LosSantosAlive.NPC.NpcState state)`

Known role enum values:
- `None = 0`
- `Civilian = 1`
- `Accomplice = 10`
- `PoliceShowUnit = 20`
- `Negotiator = 21`
- `SwatShowUnit = 22`
- `StoreClerk = 30`
- `TaxiDriver = 40`
- `Paramedic = 50`
- `GangMember = 60`

A role profile contains a role type/name, prompt context, and allowed-action set. `NpcRoleManager` can assign/query roles and check `CanUseAction`. For an addon, registering or modifying a profile is safer than bypassing role gating in an action handler.

**Caution on truly new role enum values:** the registry keys on the enum type. C# lets you cast an arbitrary integer to an enum, but that is not a stable contract. Prefer existing role categories plus addon context unless a future LSA build exposes a formal dynamic role ID.

---

# 14. Hostage-scene subsystem

### `LosSantosAlive.Scenes.HostageScenes.HostageScenePhase`

Fields / constants:
- `public int32 value__`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase None = 0`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase InitialResponse = 1`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase Negotiation = 2`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase TacticalContainment = 3`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase AssaultImminent = 4`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase AssaultActive = 5`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase Resolved = 6`

### `LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup`

Fields / constants:
- `public string SetupId`
- `public string InteriorId`
- `public bool HasDoorPoint`
- `public Rage.Vector3 DoorPoint`
- `public bool HasNegotiatorPoint`
- `public Rage.Vector3 NegotiatorPoint`
- `public float32 NegotiatorHeading`
- `public System.Collections.Generic.List`1<LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup> VehicleStages`
- `public System.Collections.Generic.List`1<LosSantosAlive.Scenes.HostageScenes.HostageSwatPointSetup> SwatPoints`

Methods:
- `public bool IsValidForPoliceResponse()`

### `LosSantosAlive.Scenes.HostageScenes.HostageSceneState`

Fields / constants:
- `public LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup Setup`
- `public string InteriorId`
- `public bool IsActive`
- `public LosSantosAlive.Scenes.HostageScenes.HostageScenePhase Phase`
- `public bool FirstRespondersArrived`
- `public bool NegotiatorArrived`
- `public bool SwatArrived`
- `public bool HelicopterArrived`
- `public bool SnipersArrived`
- `public int32 HostagesReleased`
- `public int32 CiviliansKilled`
- `public int32 OfficersKilled`
- `public uint32 SceneStartGameTime`
- `public uint32 LastEscalationGameTime`
- `public Rage.Ped NegotiatorPed`

Methods:
- `public static LosSantosAlive.Scenes.HostageScenes.HostageSceneState FromSetup(LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`

### `LosSantosAlive.Scenes.HostageScenes.HostageSceneDatabase`

Methods:
- `public static void Register(LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static bool TryGet(string setupId, ref LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static bool TryGetForInterior(string interiorId, ref LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static bool HasSetupForInterior(string interiorId)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup> GetAll()`
- `public static void Clear()`

### `LosSantosAlive.Scenes.HostageScenes.HostagePoliceResponseController`

Properties:
- `bool HasActiveScene { get; }`
- `LosSantosAlive.Scenes.HostageScenes.HostageSceneState ActiveState { get; }`

Methods:
- `public static bool TryStartForInterior(string interiorId)`
- `public static bool Start(LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static void Stop()`

### `LosSantosAlive.Scenes.HostageScenes.HostageSceneRuntimeDirector`

Methods:
- `public static void Update(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyNegotiatorArrived(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifySwatArrived(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyHostageReleased(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyCivilianKilled(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyOfficerKilled(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyShotsFired(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void RequestLowerWeapons(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void RequestHoldFire(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void RequestAssault(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void ResolveScene(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`

The hostage subsystem is data-driven enough to be interesting to scene mods: setups are registered in `HostageSceneDatabase`, the police response controller can start by interior/setup, and the runtime director exposes notifications for negotiator/SWAT arrival, hostage release, casualties, shots fired, weapon-lowering/hold-fire/assault requests, and resolution.

### How-to: attach an addon interior to LSA hostage response

Build a valid `HostageSceneSetup` with a unique setup ID/interior ID plus door/negotiator/staging/SWAT points, `HostageSceneDatabase.Register(setup)`, then let `HostagePoliceResponseController` start and own the response. Drive major scene facts through `HostageSceneRuntimeDirector.Notify...` rather than editing phase fields directly.

---

# 15. Direct behavior classes: useful, but lower-level

### `LosSantosAlive.NPC.Behaviors.CombatBehavior`

Methods:
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StartAttackPlayer(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartIntimidatePlayerWithWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartFleePlayer(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartWalkAwayFromPlayer(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartAttackTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartAttackTargetWithWeapon(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void TakeShotOnTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void StartIntimidateTargetWithWeapon(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartIntimidateTargetWithWeapon(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void StartFleeFromTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartWalkAwayFromTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartTakeCover(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateTakeCover(LosSantosAlive.NPC.NpcState state)`
- `public static void StopTakeCover(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateAttackTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopAttackTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateIntimidateTargetWithWeapon(LosSantosAlive.NPC.NpcState state)`
- `public static void StopIntimidateTargetWithWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateFleeFromTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFleeFromTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateWalkAwayFromTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopWalkAwayFromTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void StopAllCombat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void StopCombatTaskOnly(Rage.Ped ped)`
- `public static void StopCombatStateAndTasks(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void StartPutAwayWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartUnequipWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`

### `LosSantosAlive.NPC.Behaviors.ComplianceBehavior`

Methods:
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StartHandsUp(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateHandsUp(LosSantosAlive.NPC.NpcState state)`
- `public static void StopHandsUp(LosSantosAlive.NPC.NpcState state)`
- `public static void StartKneel(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateKneel(LosSantosAlive.NPC.NpcState state)`
- `public static void StopKneel(LosSantosAlive.NPC.NpcState state)`
- `public static void StartSitOnGround(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateSitOnGround(LosSantosAlive.NPC.NpcState state)`
- `public static void StopSitOnGround(LosSantosAlive.NPC.NpcState state)`
- `public static void Stop(LosSantosAlive.NPC.NpcState state)`
- `public static void PutHandsUp(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void HandsDown(LosSantosAlive.NPC.NpcState state)`
- `public static void Kneel(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void GetUp(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void PauseHandsUpAnimation(LosSantosAlive.NPC.NpcState state)`
- `public static void ReapplyHandsUpIfWanted(LosSantosAlive.NPC.NpcState state)`

### `LosSantosAlive.NPC.Behaviors.FollowBehavior`

Methods:
- `public static void StartFollowTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void PauseFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void ResumeFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void RestartFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StartFollowing(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void PauseFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void ResumeFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void RestartFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFollowTaskOnly(Rage.Ped ped)`

### `LosSantosAlive.NPC.Behaviors.ItemBehavior`

Methods:
- `public static void Start(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string itemName)`
- `public static void Stop(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StartGrabItem(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string itemName)`
- `public static void StartUseHeldItem(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void ClearHeldItem(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool GiveTargetItem(Rage.Ped giverPed, LosSantosAlive.NPC.NpcState giverState)`
- `public static bool TakeTargetItem(Rage.Ped takerPed, LosSantosAlive.NPC.NpcState takerState)`
- `public static bool GiveHeldItemToTarget(Rage.Ped giverPed, LosSantosAlive.NPC.NpcState giverState, Rage.Ped targetPed)`
- `public static bool GiveHeldItemToTarget(Rage.Ped giverPed, LosSantosAlive.NPC.NpcState giverState, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState targetState)`
- `public static bool TakeHeldItemFromTarget(Rage.Ped takerPed, LosSantosAlive.NPC.NpcState takerState, Rage.Ped targetPed)`
- `public static bool TakeHeldItemFromTarget(Rage.Ped takerPed, LosSantosAlive.NPC.NpcState takerState, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState targetState)`

### `LosSantosAlive.NPC.Behaviors.MovementBehavior`

Events:
- `ApproachFinished` (accessors: `remove_ApproachFinished, add_ApproachFinished`)

Methods:
- `public static void StartTurnAround(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StopTurnAround(LosSantosAlive.NPC.NpcState state)`
- `public static void StartWalkBackwardsToTarget(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StartChaseTarget(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StopChaseTarget(LosSantosAlive.NPC.NpcState state)`
- `public static bool IsChasingTarget(LosSantosAlive.NPC.NpcState state)`
- `public static Rage.Ped GetChaseTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StartApproachTarget(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StopApproachTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StopWalkBackwardsToTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StartLeanAgainstVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StopLeanAgainstVehicle(LosSantosAlive.NPC.NpcState state)`

### `LosSantosAlive.NPC.Behaviors.ApproachCoordinator`

Methods:
- `public static void Initialize()`
- `public static bool Start(Rage.Ped moverPed, Rage.Ped targetPed, string targetDescription, string turnId, int64 generationId, string conversationId)`
- `public static void ReportImmediateFailure(Rage.Ped moverPed, string targetPedId, string turnId, int64 generationId, string conversationId, string reason)`

### `LosSantosAlive.NPC.Behaviors.VehicleBehavior`

Methods:
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static bool FollowTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static bool StopFollowingTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static bool StartFollowTargetVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateFollowTargetVehicle(LosSantosAlive.NPC.NpcState state)`
- `public static bool StopFollowTargetVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool BeginAssignedVehicleSeatEntry(Rage.Ped ped, Rage.Vehicle vehicle, int32 seatIndex)`
- `public static void UpdateAssignedVehicleSeatEntry(LosSantosAlive.NPC.NpcState state)`
- `public static void StopAssignedVehicleSeatEntry(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterPassengerWhenPlayerEnters(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateEnterPassengerWhenPlayerEnters(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterPassengerWhenPlayerEnters(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterPassengerSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterPassengerSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateEnterPassengerSeat(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterPassengerSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterBackSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterBackSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateEnterBackSeat(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterBackSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterDriverSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterDriverSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateEnterDriverSeat(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterDriverSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartExitWhenPlayerExits(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateExitWhenPlayerExits(LosSantosAlive.NPC.NpcState state)`
- `public static void StopExitWhenPlayerExits(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartDriveEvasive(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateDriveEvasive(LosSantosAlive.NPC.NpcState state)`
- `public static void StopDriveEvasive(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartDriving(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void StopAllVehicleCommands(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StopVehicleTaskOnly(Rage.Ped ped)`
- `public static void UpdateStartDriving(LosSantosAlive.NPC.NpcState state)`
- `public static void ForceExitVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void ForceExitVehicleFast(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void ForceExitVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool fastExit)`

### `LosSantosAlive.NPC.Behaviors.WeaponBehavior`

Methods:
- `public static void TakePlayerWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void TakeTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void TakeTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, Rage.Ped targetPed)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, Rage.Ped targetPed)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName, Rage.Ped targetPed)`
- `public static bool EquipWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static bool EquipResolvedWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, uint32 weaponHash, bool preparePed)`
- `public static void UnequipWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool EquipWeaponIfPossible(Rage.Ped ped, uint32 weaponHash)`
- `public static bool EquipBestWeaponIfPossible(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool EquipBestCombatWeaponIfPossible(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool TryResolveBestCombatWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, ref uint32 weaponHash)`
- `public static bool TryResolveOwnedWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName, ref uint32 weaponHash)`
- `public static bool TryResolveNamedOwnedWeapon(Rage.Ped ped, string weaponName, ref uint32 weaponHash)`
- `public static uint32 ResolveWeaponHash(string weaponName)`
- `public static void RememberCurrentWeapon(LosSantosAlive.NPC.NpcState state)`
- `public static void RememberCurrentWeaponNow(LosSantosAlive.NPC.NpcState state)`

These methods are attractive because they directly start/stop/update combat, movement, follow, compliance, item, vehicle and weapon behaviors. However, they are downstream of the action/state systems. Calling them directly can leave `NpcState`, role restrictions, action notifications, or integration modifiers out of sync.

**Rule of thumb:** register/execute an action when a matching action exists. Call a behavior class directly only for addon-private mechanics, and update/restore the relevant `NpcState` flags so LSA does not immediately fight the task.

---

# 16. Optional integrations: LSPDFR / Policing Redefined / legacy interop

### `LosSantosAlive.Integrations.LSPDFR.LspdfrIntegration`
Implements: `LosSantosAlive.Integrations.IIntegration`.

Properties:
- `string Id { get; }`
- `bool IsAvailable { get; }`
- `bool IsOnDuty { get; }`

Methods:
- `public final virtual void Initialize()`
- `public final virtual void Update()`
- `public final virtual void Shutdown()`
- `public final virtual void OnPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public final virtual void OnNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`
- `public final virtual void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`

### `LosSantosAlive.Integrations.LSPDFR.FreemodeOfficerIntegration`

Methods:
- `public static bool TryBuild(Rage.Ped ped, ref LosSantosAlive.Integrations.IntegrationJsonBlock block)`
- `public static bool ShouldBlockPhysicalReflexActions(Rage.Ped ped, ref string reason)`

### `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedBridgeIntegration`
Implements: `IActionStateModifier`, `LosSantosAlive.Integrations.IIntegration`.

Properties:
- `string Id { get; }`
- `bool IsAvailable { get; }`

Methods:
- `public final virtual void ApplyActionState(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`
- `public final virtual void Initialize()`
- `public final virtual void Update()`
- `public final virtual void Shutdown()`
- `public final virtual void OnPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public final virtual void OnNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`
- `public final virtual void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`
- `public static void AddGeneralContextUpdate(LosSantosAlive.NPC.NpcState state, string update)`
- `public static bool ForceRefreshPedPrState(Rage.Ped ped, string reason)`
- `public static bool IsPedKnownHandcuffed(Rage.Ped ped)`
- `public static bool IsPedCurrentlyArrestedByPr(Rage.Ped ped, string reason)`
- `public static void InvalidatePedRecordCache(Rage.Ped ped)`
- `public static bool ForceRefreshPedRecordCache(Rage.Ped ped, string reason)`
- `public static bool ForceRefreshPedRecordCache(string pedHandle, string reason)`
- `public static void InvalidatePedRecordCache(string pedHandle)`
- `public static void PrewarmPedRecord(Rage.Ped ped)`
- `public static bool HasCachedPedRecord(Rage.Ped ped)`
- `public static void DrainCompletedAsyncRecords()`

### `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedPipeClient`

Methods:
- `public static bool HasBridgeDiscovery()`
- `public static bool IsBridgeAvailable()`
- `public static bool ForceRefreshAvailability()`
- `public static void ResetAvailabilityCache()`
- `public static bool TryGetPedRecordJson(string pedHandle, ref string recordJson)`
- `public static bool TryGetPedStateJson(string pedHandle, ref string stateJson)`
- `public static bool TryGetArrestStateJson(string pedHandle, ref string stateJson)`
- `public static bool TryGetVehicleRecordJson(string vehicleHandle, ref string vehicleJson)`
- `public static bool TryQueuePedRecordJson(string pedHandle, ref string response)`
- `public static bool TryQueueVehicleRecordJson(string vehicleHandle, ref string response)`
- `public static bool TryQueuePedStateJson(string pedHandle, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref System.Collections.Generic.List`1<CompletedPedCheck> pedChecks, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedStates, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref System.Collections.Generic.List`1<CompletedPedCheck> pedChecks, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedStates, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref System.Collections.Generic.List`1<CompletedPedCheck> pedChecks, ref System.Collections.Generic.List`1<CompletedVehicleCheck> vehicleChecks, ref string response)`
- `public static bool TrySearchPed(string officerHandle, string suspectHandle, ref string response)`
- `public static bool TryArrestPed(string officerHandle, string suspectHandle, bool frontCuffs, ref string response)`
- `public static bool TryExecuteSuspectCommand(string command, string officerHandle, string suspectHandle, ref string response)`
- `public static bool TryExecuteSuspectCommand(string command, string officerHandle, string suspectHandle, ref string handoffJson, ref string response)`
- `public static bool TryDismissPed(string suspectHandle, ref string response)`
- `public static bool TrySetLsaControl(string pedHandle, bool controlledByLsa, ref string response)`
- `public static bool TrySetCalloutPed(string pedHandle, string calloutPedJson, ref string response)`
- `public static bool TrySetLspdfrCallout(string calloutJson, ref string response)`
- `public static bool TryGetLspdfrCallout(ref string calloutJson)`
- `public static bool TryAcceptLspdfrCallout(string calloutId, ref string response)`
- `public static bool TryDeclineLspdfrCallout(string calloutId, ref string response)`
- `public static bool TryEndLspdfrCallout(string calloutId, ref string response)`
- `public static bool TryGetLspdfrCalloutStatus(ref string response)`
- `public static bool TryRequestPedCheck(string officerHandle, string targetHandle, string personName, ref string response)`
- `public static bool TryRequestPedCheck(string officerHandle, string personName, ref string response)`
- `public static bool TryRequestVehicleCheck(string officerHandle, string vehicleHandle, string plate, ref string response)`
- `public static bool TryRequestBackup(string message, ref string response)`

### `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrActionBootstrap`

Methods:
- `public static void RegisterAll()`

### `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrActionStateModifier`
Implements: `IActionStateModifier`.

Methods:
- `public final virtual void ApplyActionState(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`

The separate `LosSantosAlive.Interop.dll` is a compatibility adapter. Readable symbols show it can install Harmony hooks against an optional external assembly/type (`NPCAI_API` / `NPCAI.API.NPCAIContext`) and mirror scenario/detail/mood/remove operations through an interop transport. This is evidence that LSA intentionally supports *adapters around other mods* rather than requiring all state to live in core.

For new work, prefer the main DLL’s `IIntegration` and context/state APIs. Treat legacy interop or PR-specific pipes as integration-specific, not as the generic LSA addon protocol.

---

# 17. Server / wire protocol: validated escape hatch, not the first choice

The shipped server loads configuration from the GTA root and exposes a WebSocket server on **port 8765**. Its main inbound switch recognizes at least:

- `actorHydrationResponse`
- `micStart`
- `micHydration`
- `micStop`
- `testPrompt`
- `playerText`
- `contextUpdate`
- `npcToNpcInteractionReady`
- `npcToNpcInteractionEnded`
- `npcAudioFinished`
- `generateCallout`
- `specialGeminiTurn`

Server constants confirm: microphone input 16 kHz; generated output 24 kHz; 16-bit (`BYTES_PER_SAMPLE = 2`), mono PCM; 20 ms mic chunks. The live model constant in this package is `gemini-3.1-flash-live-preview`; callout generation uses `gemini-3.1-flash-lite`.

**Do not bind our addon directly to these message names if a DLL method exists.** The .NET side already encapsulates actor hydration, special turns, audio turn authorization, context building, and directed interaction notifications. Direct WebSocket messages skip game-side invariants and are more likely to break on an LSA update.

If an unexposed capability eventually forces a raw bridge integration, preserve the protocol-v3 identity model (`pedId`, `turnId`, `generationId`) and implement stale-turn rejection rather than treating audio as an untagged stream.

---

# 18. Recommended addon architecture for us

```text
OurGameplayPlugin
  ├─ Domain logic (NO direct LSA types)
  ├─ Our NPC/scene state
  └─ LsaAdapter
       ├─ IIntegration implementation
       ├─ custom NpcActionRegistry registrations
       ├─ PlaybackStarted/PlaybackEnded subscriptions
       ├─ DirectedInteraction lifecycle subscriptions
       ├─ SpecialGeminiTurnScheduler wrapper
       ├─ ReflexSystem wrapper
       ├─ NpcStateStore read/coordination wrapper
       └─ version/capability checks
```

This containment matters because Hotfix #3 is not advertising a formal semantic-versioned public SDK. The readable APIs are excellent hooks, but a future LSA build can rename/change them. One adapter makes that a one-file migration instead of a repo-wide rewrite.

### Capability probing

If we distribute independently of LSA, avoid a hard loader dependency at the outermost plugin boundary. Probe `AppDomain.CurrentDomain.GetAssemblies()` for assembly name `LosSantosAlive`, then enable the adapter. A strongly typed adapter assembly can be loaded only when LSA is present, or a small reflection shim can bridge the few startup calls.

### Thread/fiber discipline
RAGE entity/task calls should remain on the game/RPH execution context. Do not mutate `Ped`/task state from arbitrary websocket/background callbacks. Queue addon work onto our RPH fiber/update loop, especially from playback/network-related notifications.

### Ownership discipline
Treat `OnPedControlChanged`, runtime mode, directed-interaction membership, and speaking state as arbitration signals. The single biggest compatibility bug to avoid is two mods continuously re-tasking the same ped.

---

# 19. “What should we hook first?” — stable incremental plan

1. **Read-only adapter first:** detect LSA, enumerate `NpcStateStore.GetAllStatesSnapshot`, log runtime/focus/reflex state, subscribe to playback + directed-interaction events. No gameplay writes.
2. **Register one `IIntegration`:** implement lifecycle + `OnPedControlChanged` + `OnNpcActionExecuted`; add a tiny `IntegrationBlock` to actor context and verify it reaches the model context.
3. **Register one harmless custom action:** e.g. an addon emote/inspection action that can succeed/fail without affecting combat or police logic.
4. **Use special turns:** create one deduped scene bark and prove cancellation when player speech starts / scene ends.
5. **Only then add state/reflex manipulation:** narrow action blocks and one synthetic reflex from an event LSA cannot currently detect.
6. **Finally extend content registries:** custom item/location/activity or hostage setup after the adapter/version checks are established.

That sequence gives us observable integration at every step and minimizes the chance we mistake a task conflict for an AI/model problem.

---

# 20. Things I would *not* build against unless necessary

- Obfuscated private fields/methods, even if Harmony can reach them.
- Direct writes to conversation/audio coordinator internals when public methods/events exist.
- Raw WebSocket message injection for features already represented by `SpecialGeminiTurnScheduler`, context hydration, or directed-interaction APIs.
- Manual edits to global state collections while LSA is enumerating them; use stores/registries and snapshot methods.
- Per-frame global world scans when `PerceptionSystem` provides the same data.
- Hard-coded ped handles as long-term identity. RAGE/GTA handles can be recycled; use LSA’s continuity/context identity abstractions or our own durable scene IDs for persistence.

---

# 21. Configuration shipped with this package

The user-facing LSA config surface in this installer is:

```ini
# Los Santos Alive controls

ApiKey=
Language=English

TalkKey=Mouse4
TextKey=None

MarkPedKey=F3
MarkedPedTalkKey=Mouse5

AudioVolume=0.4
TutorialComplete=False
```

The Node/server side searches upward for a GTA root (`GTA5.exe`, `GTA5_Enhanced.exe`, or `PlayGTAV.exe`) and prefers `<GTA root>/plugins/LosSantosAlive/LosSantosAlive.config`.

---

# Appendix A — all readable main-DLL API symbols

This appendix is intentionally broad. It includes **every type whose name survived as readable semantic metadata** in the extracted main assembly, with readable public fields/properties/events and all readable methods (including non-public methods when their names survived). A readable symbol is **not automatically a supported public API**; use the guidance above to choose hooks.

## `ActionStateModifierPhase`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal ActionStateModifierPhase BeforeCoreStateRule = 0`
- `public static literal ActionStateModifierPhase AfterCoreStateRule = 1`

## `ConfusedByAttribute`
Kind: `class`; extends `System.Attribute`.

## `IActionStateModifier`
Kind: `interface`.

**Methods**
- `public virtual abstract void ApplyActionState(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`

## `LosSantosAlive.Audio.NpcAudioQueue`
Kind: `static class`; extends `System.Object`.

**Events**
- `AudioPlaybackFinished` — accessors `remove_AudioPlaybackFinished, add_AudioPlaybackFinished`

**Methods**
- `public static void add_AudioPlaybackFinished(System.Action`1<Rage.Ped> value)`
- `public static void remove_AudioPlaybackFinished(System.Action`1<Rage.Ped> value)`
- `public static void Initialize()`
- `public static void QueueAudioChunk(uint8[] chunk)`
- `public static void QueueAudioChunk(uint8[] chunk, Rage.Ped speakerPed)`
- `public static bool HasPendingAudioForPed(Rage.Ped ped)`
- `public static bool IsAnyAudioPlayingOrPending()`
- `public static bool IsPedCurrentlySpeaking(Rage.Ped ped)`
- `public static Rage.Ped GetActiveSpeakerPed()`
- `public static void InterruptSpeechForPed(Rage.Ped ped, string reason)`
- `public static void InterruptSpeechForPed(Rage.Ped ped)`
- `public static void StopSpeechForPlayerMicInterrupt(Rage.Ped ped)`
- `public static void Clear()`
- `public static void Shutdown()`

## `LosSantosAlive.Audio.NpcAudioTurn`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped SpeakerPed`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`
- `public string Key`
- `public Rage.Ped ListenerPed`
- `public string ListenerPedId`
- `public bool FaceListener`
- `public bool IsLegacy`
- `public bool StreamEnded`
- `public bool Cancelled`
- `public bool CompletionEmitted`
- `public bool StartEventEmitted`
- `public bool EndEventEmitted`
- `public bool HadAudio`
- `public bool PlaybackStarted`
- `public int32 CreatedAt`
- `public int32 LastChunkAt`
- `public int32 EstimatedPlaybackEndAt`
- `public int32 CompletedAt`

## `LosSantosAlive.Audio.NpcLipSync`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void StartTalking(Rage.Ped ped)`
- `public static void StartPlayerTalking()`
- `public static void StopPlayerTalking()`
- `public static void StopTalking(Rage.Ped ped)`
- `public static void StopTalking()`
- `public static void Stop()`

## `LosSantosAlive.Audio.NpcPlaybackCoordinator`
Kind: `static class`; extends `System.Object`.

**Events**
- `LegacyPlaybackFinished` — accessors `remove_LegacyPlaybackFinished, add_LegacyPlaybackFinished`
- `PlaybackStarted` — accessors `add_PlaybackStarted, remove_PlaybackStarted`
- `PlaybackEnded` — accessors `add_PlaybackEnded, remove_PlaybackEnded`

**Methods**
- `public static void add_LegacyPlaybackFinished(System.Action`1<Rage.Ped> value)`
- `public static void remove_LegacyPlaybackFinished(System.Action`1<Rage.Ped> value)`
- `public static void add_PlaybackStarted(System.Action`1<LosSantosAlive.Audio.NpcPlaybackStartedEvent> value)`
- `public static void remove_PlaybackStarted(System.Action`1<LosSantosAlive.Audio.NpcPlaybackStartedEvent> value)`
- `public static void add_PlaybackEnded(System.Action`1<LosSantosAlive.Audio.NpcPlaybackEndedEvent> value)`
- `public static void remove_PlaybackEnded(System.Action`1<LosSantosAlive.Audio.NpcPlaybackEndedEvent> value)`
- `public static void Initialize()`
- `public static bool TryAuthorizeTurn(Rage.Ped speakerPed, string turnId, int64 generationId, ref string rejectionReason, Rage.Ped listenerPed, string listenerPedId, bool faceListener)`
- `public static bool QueueTaggedAudioChunk(uint8[] pcm, Rage.Ped speakerPed, string turnId, int64 generationId, ref string rejectionReason)`
- `public static void QueueLegacyAudioChunk(uint8[] pcm, Rage.Ped speakerPed)`
- `public static bool MarkStreamEnded(string pedId, string turnId, int64 generationId, ref string rejectionReason)`
- `public static bool InterruptExactTurn(Rage.Ped speakerPed, string turnId, int64 generationId, string reason)`
- `public static bool InterruptExactTurn(string pedId, Rage.Ped speakerPed, string turnId, int64 generationId, string reason)`
- `public static void InterruptPed(Rage.Ped speakerPed, string reason)`
- `public static bool HasPendingAudioForPed(Rage.Ped ped)`
- `public static bool IsAnyAudioPlayingOrPending()`
- `public static bool IsPedCurrentlySpeaking(Rage.Ped ped)`
- `public static Rage.Ped GetActiveSpeakerPed()`
- `public static void Clear()`
- `public static void ResetForTransportDisconnect()`
- `public static void Shutdown()`

## `LosSantosAlive.Audio.NpcPlaybackEndedEvent`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped SpeakerPed`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`
- `public string Reason`
- `public bool WasInterrupted`
- `public bool HadAudio`
- `public bool PlaybackStarted`

## `LosSantosAlive.Audio.NpcPlaybackStartedEvent`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped SpeakerPed`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`

## `LosSantosAlive.Audio.NpcRadioSpeechAnimation`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void ApplyState(string pedId, string turnId, int64 generationId, bool active, string reason)`

## `LosSantosAlive.Audio.NpcSpatialAudio`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Initialize()`
- `public static void SetAudioVolume(float32 volume)`
- `public static void SetSpeakerPed(Rage.Ped ped)`
- `public static Rage.Ped GetSpeakerPed()`
- `public static void ClearSpeakerPed()`
- `public static void EnqueuePcm16Mono(uint8[] monoPcm16)`
- `public static void EnqueuePcm16Mono(uint8[] monoPcm16, Rage.Ped sourcePed)`
- `public static void QueueMonoChunk(uint8[] monoPcm16, Rage.Ped sourcePed)`
- `public static void QueueMonoChunk(uint8[] monoPcm16, Rage.Ped sourcePed, string turnId, int64 generationId)`
- `public static bool TryQueueMonoChunk(uint8[] monoPcm16, Rage.Ped sourcePed, string turnId, int64 generationId)`
- `public static bool HasBufferedAudioForTurn(string pedId, string turnId, int64 generationId)`
- `public static void InterruptTurn(Rage.Ped sourcePed, string turnId, int64 generationId, int32 hardMuteMs)`
- `public static bool IsAudibleAudioPlaying()`
- `public static bool IsAudibleAudioPlaying(Rage.Ped ped)`
- `public static float32 GetLastChunkRms()`
- `public static float32 GetLastChunkRms(Rage.Ped ped)`
- `public static void HardMuteForMs(int32 durationMs)`
- `public static void HardMuteBriefly()`
- `public static void Stop()`
- `public static void Stop(bool hardMute)`
- `public static void Stop(int32 hardMuteMs)`
- `public static void Dispose()`

## `LosSantosAlive.Bridge.BridgeMessageRouter`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void HandleBridgeTextMessage(string text)`

## `LosSantosAlive.Bridge.GeminiBridgeClient`
Kind: `static class`; extends `System.Object`.

**Properties**
- `bool IsConnected { get; }`

**Methods**
- `public static bool get_IsConnected()`
- `public static void Connect()`
- `public static void UpdateConnectionHealth()`
- `public static void Disconnect()`
- `public static void ProcessPendingMessages()`
- `public static void SendJson(string json)`
- `public static void SetCurrentBridgeAudioSpeaker(Rage.Ped ped)`
- `public static Rage.Ped GetCurrentBridgeAudioSpeaker()`

## `LosSantosAlive.Bridge.NpcAudioProtocol`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static literal int32 ProtocolVersion = 3`

**Methods**
- `public static bool IsAudioMessageType(string type)`
- `public static bool TryParse(string json, ref LosSantosAlive.Bridge.NpcAudioProtocolMessage message, ref string error)`
- `public static string BuildEndpointReady()`
- `public static string BuildTurnDecision(bool accepted, string pedId, string turnId, int64 generationId, string reason)`
- `public static string BuildPlaybackStarted(LosSantosAlive.Audio.NpcPlaybackStartedEvent playback)`
- `public static string BuildPlaybackEnded(LosSantosAlive.Audio.NpcPlaybackEndedEvent playback)`
- `public static string BuildApproachResult(bool succeeded, string pedId, string targetPedId, string turnId, int64 generationId, string conversationId, string reason, float32 distance)`
- `public static string BuildLegacyAudioFinished(string pedId)`

## `LosSantosAlive.Bridge.NpcAudioProtocolMessage`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string Type`
- `public string PedId`
- `public string TurnId`
- `public int64 GenerationId`
- `public string Reason`
- `public string AudioBase64`
- `public string ListenerPedId`
- `public bool FaceListener`

**Properties**
- `bool HasCompleteTurnIdentity { get; }`
- `bool HasAnyTurnIdentity { get; }`

**Methods**
- `public bool get_HasCompleteTurnIdentity()`
- `public bool get_HasAnyTurnIdentity()`

## `LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped SpeakerPed`
- `public Rage.Ped ListenerPed`
- `public Rage.Ped SpeechTargetPed`
- `public string Content`
- `public string Reason`
- `public string DedupeKey`
- `public bool FaceListener`
- `public bool InterruptExisting`
- `public int32 DelayMilliseconds`
- `public bool CancelIfPlayerStartsTurn`
- `public bool RequireCurrentPlayerConversation`
- `public bool SkipIfSpeakerBusy`

## `LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnScheduler`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool Submit(LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest request)`
- `public static bool SubmitAfterCurrentTurn(LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest request)`
- `public static void Cancel(string dedupeKey, Rage.Ped speakerPed)`
- `public static void CancelAll()`

## `LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void NotifyPlayerTurnStarted()`
- `public static int64 ReadPlayerTurnVersion()`
- `public static bool SendNow(LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest request)`

## `LosSantosAlive.Context.ActorContext`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public bool Exists`
- `public string Label`
- `public string PedId`
- `public string PedModel`
- `public string Gender`
- `public string AgeRange`
- `public string Archetype`
- `public string ArchetypeDescription`
- `public string ArchetypePerceivedDescription`
- `public string Activity`
- `public string InteractionActivityContext`
- `public string RoleName`
- `public string RoleContext`
- `public bool IsArmed`
- `public string WeaponDescription`
- `public string EquippedWeaponDescription`
- `public string AvailableWeaponsContext`
- `public System.Collections.Generic.List`1<string> AvailableWeapons`
- `public string VehicleContext`
- `public string RecentVehicleContext`
- `public bool HasActiveReflex`
- `public string ReflexEvent`
- `public string ReflexReaction`
- `public string ReflexReason`
- `public int32 ReflexEscalationLevel`
- `public string StreetName`
- `public string CrossingStreetName`
- `public string ZoneCode`
- `public bool IsIndoors`
- `public string LocationContext`
- `public string AvailableActivitiesContext`
- `public string RadioContext`
- `public string NearbyPeopleContext`
- `public System.Collections.Generic.Dictionary`2<string, string> NearbyPersonReferences`
- `public System.Collections.Generic.Dictionary`2<string, string> NearbyVehicleReferences`
- `public System.Collections.Generic.List`1<LosSantosAlive.Integrations.IntegrationJsonBlock> IntegrationBlocks`

## `LosSantosAlive.Context.ActorHydrationCoordinator`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool IsActorHydrationRequest(string json)`
- `public static void HandleRequest(string json)`
- `public static void Update()`

## `LosSantosAlive.Context.ContextJsonSerializer`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static string Build(LosSantosAlive.Context.ContextSnapshot snapshot)`

## `LosSantosAlive.Context.ContextSnapshot`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string Type`
- `public string Text`
- `public string ContextUpdate`
- `public string PlayerPedId`
- `public LosSantosAlive.Context.ActorContext Speaker`
- `public LosSantosAlive.Context.ActorContext Target`
- `public string InteractionId`
- `public string InteractionType`
- `public float32 ActorDistance`
- `public string GameTime`
- `public string Weather`
- `public string StreetName`
- `public string CrossingStreetName`
- `public string ZoneCode`
- `public bool IsIndoors`
- `public string InteriorContext`
- `public bool RadioAvailable`
- `public string RadioStationName`
- `public string RadioStationLabel`
- `public int32 RadioTrackId`
- `public bool RadioSongKnown`
- `public string RadioSongTitle`
- `public string RadioSongArtist`
- `public string RadioSongTags`
- `public string RadioDescription`

## `LosSantosAlive.Context.ContextWarmup`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void WarmupForFirstConversation()`

## `LosSantosAlive.Context.ConversationHydrationCoordinator`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void BeginMicTurn(Rage.Ped ped)`
- `public static void MarkMicReleased(Rage.Ped ped)`
- `public static void Update()`

## `LosSantosAlive.Context.Data.SongDatabase`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.Dictionary`2<int32, LosSantosAlive.Context.Data.SongInfo> Songs`

## `LosSantosAlive.Context.Data.SongInfo`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string Artist`
- `public string Title`
- `public string[] Tags`

## `LosSantosAlive.Context.GeminiContextBuilder`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void LoadArchetypesIni()`
- `public static string BuildContextJson(string type, Rage.Ped ped, string text)`
- `public static string BuildInteractionContextJson(string type, Rage.Ped speakerPed, Rage.Ped targetPed, string text, string interactionId, string interactionType)`

## `LosSantosAlive.Context.Providers.ActivityContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Warmup(Rage.Ped ped)`
- `public static void Populate(LosSantosAlive.Context.ActorContext actor, Rage.Ped ped)`
- `public static string GetActivity(Rage.Ped ped)`
- `public static string GetScenarioActivity(Rage.Ped ped)`

## `LosSantosAlive.Context.Providers.ActorContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void LoadArchetypesIni()`
- `public static string GetVisualDescription(Rage.Ped ped)`
- `public static string GetArchetypeVisualDescription(string archetype)`
- `public static void Populate(LosSantosAlive.Context.ActorContext actor, Rage.Ped ped)`

## `LosSantosAlive.Context.Providers.NearbyPersonContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static string BuildContext(Rage.Ped npc)`
- `public static string BuildContext(Rage.Ped npc, Rage.Ped interactionInitiator)`
- `public static string BuildContext(Rage.Ped npc, Rage.Ped interactionInitiator, LosSantosAlive.NPC.Perception.PerceptionSnapshot perceptionSnapshot)`
- `public static NearbyPeopleSnapshot BuildSnapshot(Rage.Ped npc)`
- `public static NearbyPeopleSnapshot BuildSnapshot(Rage.Ped npc, Rage.Ped interactionInitiator)`
- `public static NearbyPeopleSnapshot BuildSnapshot(Rage.Ped npc, Rage.Ped interactionInitiator, LosSantosAlive.NPC.Perception.PerceptionSnapshot perceptionSnapshot)`
- `public static void Warmup(LosSantosAlive.NPC.Perception.PerceptionSnapshot perceptionSnapshot)`
- `public static bool RegisterInteractionInitiator(Rage.Ped npc, Rage.Ped interactionInitiator)`
- `public static bool TryResolveReference(Rage.Ped observer, string reference, ref Rage.Ped target)`
- `public static bool IsNearbyPersonReference(string value)`
- `public static bool TryResolveBodyReference(Rage.Ped observer, string reference, ref Rage.Ped target)`
- `public static bool IsNearbyBodyReference(string value)`
- `public static bool TryResolveVehicleReference(Rage.Ped observer, string reference, ref Rage.Vehicle target)`
- `public static bool IsNearbyVehicleReference(string value)`
- `public static string GetOrCreatePersonReference(Rage.Ped observer, Rage.Ped target)`

## `LosSantosAlive.Context.Providers.NearbyPersonContextProvider+NearbyPeopleSnapshot`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string ContextText`
- `public System.Collections.Generic.Dictionary`2<string, string> ReferencePedIds`
- `public System.Collections.Generic.Dictionary`2<string, string> ReferenceVehicleIds`
- `public System.Collections.Generic.Dictionary`2<string, string> ReferenceBodyIds`

## `LosSantosAlive.Context.Providers.RadioContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Populate(LosSantosAlive.Context.ActorContext actor, Rage.Ped ped)`
- `public static string BuildRadioContextUpdate(Rage.Ped observerPed, Rage.Ped targetPed)`
- `public static string BuildRadioContextUpdate(Rage.Ped observerPed)`
- `public static string BuildRadioContextUpdate()`

## `LosSantosAlive.Context.Providers.VehicleContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static VehiclePerceptionInfo GetPerceptionInfo(Rage.Vehicle vehicle)`
- `public static string GetSimpleColourName(int32 id)`
- `public static void Populate(LosSantosAlive.Context.ActorContext actor, Rage.Ped ped)`
- `public static string BuildRecentVehicleContext(string vehicleHandleString, string seatRole)`
- `public static string BuildCrashVehicleDescription(Rage.Vehicle vehicle)`
- `public static string BuildRecentVehicleContext(Rage.Vehicle vehicle, string seatRole)`
- `public static string BuildInitialVehicleContext(Rage.Ped ped)`
- `public static string BuildConversationVehicleContextUpdate(Rage.Ped observerPed, Rage.Ped subjectPed)`
- `public static string BuildVehicleContextUpdate(Rage.Ped observerPed, Rage.Ped subjectPed)`
- `public static string BuildOwnVehicleContextUpdate(Rage.Ped observerPed)`
- `public static string BuildVehicleContextUpdate(Rage.Ped observerPed)`
- `public static string BuildVehicleContextUpdate()`

## `LosSantosAlive.Context.Providers.VehicleContextProvider+VehicleContext`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public bool IsInVehicle`
- `public Rage.Vehicle Vehicle`
- `public Rage.PoolHandle VehicleHandle`
- `public bool IsDriver`
- `public bool IsFrontPassenger`
- `public bool IsBackPassenger`
- `public string SeatDescription`
- `public string ModelName`
- `public string TypeName`
- `public string PrimaryColourName`
- `public string SecondaryColourName`
- `public string Cleanliness`
- `public string Damage`
- `public string Description`

## `LosSantosAlive.Context.Providers.VehicleContextProvider+VehiclePerceptionInfo`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string Type`
- `public string Colour`
- `public string Model`
- `public bool IsOccupied`
- `public string Plate`

## `LosSantosAlive.Context.Providers.WeaponContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Warmup(Rage.Ped ped)`
- `public static void Populate(LosSantosAlive.Context.ActorContext actor, Rage.Ped ped)`
- `public static string GetHeldWeaponDescription(Rage.Ped ped)`
- `public static string BuildWeaponContextUpdate(Rage.Ped observerPed, Rage.Ped subjectPed)`
- `public static string BuildWeaponInventoryContext(Rage.Ped ped)`

## `LosSantosAlive.Context.Providers.WorldContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Warmup(Rage.Ped ped)`
- `public static void Populate(LosSantosAlive.Context.ContextSnapshot snapshot, Rage.Ped ped)`
- `public static void Populate(LosSantosAlive.Context.ActorContext actor, Rage.Ped ped)`
- `public static string GetCurrentInteriorId(Rage.Ped ped)`
- `public static string BuildPlaceContextUpdate(Rage.Ped ped)`
- `public static string BuildZoneContextUpdate(Rage.Ped ped)`
- `public static string GetCurrentLocationActivitiesContext(Rage.Ped ped)`
- `public static string BuildLocationActivitiesContext(LosSantosAlive.Locations.LocationDefinition location)`
- `public static string BuildLocationActivitiesContext(LosSantosAlive.Locations.LocationDefinition location, Rage.Ped ped)`
- `public static string GetZoneContextForPosition(Rage.Vector3 pos)`
- `public static string GetCurrentGameTime()`
- `public static string GetCurrentWeather()`

## `LosSantosAlive.Core.GeminiVoicePlugin`
Kind: `class`; extends `System.Object`.

**Methods**
- `public static void Main()`
- `public static void OnUnload(bool isTerminating)`

## `LosSantosAlive.Core.LsaControlsMenu`
Kind: `static class`; extends `System.Object`.

**Properties**
- `bool BlocksLsaInput { get; }`

**Methods**
- `public static bool get_BlocksLsaInput()`
- `public static void Update()`

## `LosSantosAlive.Core.ServerLauncher`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void RequestEnsureServerRunning()`
- `public static void EnsureServerRunning()`
- `public static void StopServer()`

## `LosSantosAlive.Debug.LsaDebugOverlay`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static literal bool Enabled = False`

**Methods**
- `public static void RecordAwareness(Rage.Ped ped, LosSantosAlive.NPC.Reflexes.ReflexEventType eventType, string eventReason, LosSantosAlive.NPC.Reflexes.ReflexReactionType ambientReactionType, string ambientReactionReason)`
- `public static void RecordReflex(LosSantosAlive.NPC.Reflexes.ReflexResult result)`
- `public static void RecordAction(Rage.Ped ped, string actionName, string parameter, string status)`

## `LosSantosAlive.Debug.LsaPerfOverlay`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static literal bool Enabled = False`

**Methods**
- `public static Scope Section(string name)`
- `public static void Count(string name)`
- `public static void AddMs(string name, float64 ms)`
- `public static void Reset()`
- `public static void EnsureStarted()`

## `LosSantosAlive.Debug.LsaPerfOverlay+Scope`
Kind: `struct`; extends `System.ValueType`; interfaces: `System.IDisposable`.

**Methods**
- `public final virtual void Dispose()`

## `LosSantosAlive.Debug.StateDebugOverlay`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static bool Enabled`
- `public static bool ShowFullState`
- `public static int32 HoldMs`

**Methods**
- `public static void Capture(string stage, Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName)`
- `public static void Update()`

## `LosSantosAlive.Input.InputController`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update()`
- `public static void ReloadConfig()`
- `public static void SendMicStart(Rage.Ped ped)`
- `public static void SendMicStart(Rage.Ped ped, string conversationMode)`
- `public static void SendMicStop()`
- `public static void SendTextPrompt(Rage.Ped ped, string text)`

## `LosSantosAlive.Input.TextInputService`
Kind: `static class`; extends `System.Object`.

**Properties**
- `bool IsOpen { get; }`

**Methods**
- `public static bool get_IsOpen()`
- `public static void StartTextInputMode()`

## `LosSantosAlive.Integrations.IIntegration`
Kind: `interface`.

**Properties**
- `string Id { get; }`
- `bool IsAvailable { get; }`

**Methods**
- `public virtual abstract string get_Id()`
- `public virtual abstract bool get_IsAvailable()`
- `public virtual abstract void Initialize()`
- `public virtual abstract void Update()`
- `public virtual abstract void Shutdown()`
- `public virtual abstract void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`
- `public virtual abstract void OnPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public virtual abstract void OnNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`

## `LosSantosAlive.Integrations.IntegrationJsonBlock`
Kind: `class`; extends `System.Object`.

**Properties**
- `string Id { set; get; }`
- `string Json { get; set; }`

**Methods**
- `public string get_Id()`
- `public void set_Id(string value)`
- `public string get_Json()`
- `public void set_Json(string value)`

## `LosSantosAlive.Integrations.IntegrationManager`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Register(LosSantosAlive.Integrations.IIntegration integration)`
- `public static void Initialize()`
- `public static void Update()`
- `public static void Shutdown()`
- `public static void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`
- `public static void NotifyPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public static void NotifyNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`
- `public static void ApplyActionStateModifiers(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`

## `LosSantosAlive.Integrations.IntegrationRegistry`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void RegisterAll()`

## `LosSantosAlive.Integrations.Interop.InteropContextProvider`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool TryGetContext(Rage.Ped ped, ref LosSantosAlive.Integrations.Interop.InteropPedContext context)`
- `public static string BuildPromptBlock(Rage.Ped ped)`
- `public static string BuildPromptBlock(LosSantosAlive.Integrations.Interop.InteropPedContext context)`
- `public static string GetScenario(Rage.Ped ped)`
- `public static string GetRole(Rage.Ped ped)`
- `public static string GetMood(Rage.Ped ped)`
- `public static string GetDetails(Rage.Ped ped)`

## `LosSantosAlive.Integrations.Interop.InteropContextStore`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool SetScenario(Rage.PoolHandle pedHandle, string scenario, string role)`
- `public static bool SetMood(Rage.PoolHandle pedHandle, string mood)`
- `public static bool AddDetail(Rage.PoolHandle pedHandle, string detail)`
- `public static bool ReplaceDetails(Rage.PoolHandle pedHandle, string details)`
- `public static LosSantosAlive.Integrations.Interop.InteropPedContext Get(Rage.PoolHandle pedHandle)`
- `public static bool TryGet(Rage.PoolHandle pedHandle, ref LosSantosAlive.Integrations.Interop.InteropPedContext context)`
- `public static bool HasContext(Rage.PoolHandle pedHandle)`
- `public static bool Remove(Rage.PoolHandle pedHandle)`
- `public static void Clear()`

## `LosSantosAlive.Integrations.Interop.InteropIntegration`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.Integrations.IIntegration`.

**Properties**
- `string Id { get; }`
- `bool IsAvailable { get; }`

**Methods**
- `public final virtual string get_Id()`
- `public final virtual bool get_IsAvailable()`
- `public final virtual void Initialize()`
- `public final virtual void Update()`
- `public final virtual void Shutdown()`
- `public final virtual void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`
- `public final virtual void OnPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public final virtual void OnNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`

## `LosSantosAlive.Integrations.Interop.InteropPedContext`
Kind: `class`; extends `System.Object`.

**Properties**
- `Rage.PoolHandle PedHandle { set; get; }`
- `string Scenario { set; get; }`
- `string Role { set; get; }`
- `string Mood { set; get; }`
- `string Details { get; set; }`
- `System.DateTime LastUpdatedUtc { set; get; }`
- `bool HasAnyContext { get; }`

**Methods**
- `public Rage.PoolHandle get_PedHandle()`
- `public void set_PedHandle(Rage.PoolHandle value)`
- `public string get_Scenario()`
- `public void set_Scenario(string value)`
- `public string get_Role()`
- `public void set_Role(string value)`
- `public string get_Mood()`
- `public void set_Mood(string value)`
- `public string get_Details()`
- `public void set_Details(string value)`
- `public System.DateTime get_LastUpdatedUtc()`
- `public void set_LastUpdatedUtc(System.DateTime value)`
- `public bool get_HasAnyContext()`
- `public LosSantosAlive.Integrations.Interop.InteropPedContext Clone()`

## `LosSantosAlive.Integrations.LSPDFR.FreemodeOfficerIntegration`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool TryBuild(Rage.Ped ped, ref LosSantosAlive.Integrations.IntegrationJsonBlock block)`
- `public static bool ShouldBlockPhysicalReflexActions(Rage.Ped ped, ref string reason)`

## `LosSantosAlive.Integrations.LSPDFR.LspdfrIntegration`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.Integrations.IIntegration`.

**Properties**
- `string Id { get; }`
- `bool IsAvailable { get; }`
- `bool IsOnDuty { get; }`

**Methods**
- `public final virtual string get_Id()`
- `public final virtual bool get_IsAvailable()`
- `public bool get_IsOnDuty()`
- `public final virtual void Initialize()`
- `public final virtual void Update()`
- `public final virtual void Shutdown()`
- `public final virtual void OnPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public final virtual void OnNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`
- `public final virtual void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedBridgeIntegration`
Kind: `class`; extends `System.Object`; interfaces: `IActionStateModifier`, `LosSantosAlive.Integrations.IIntegration`.

**Properties**
- `string Id { get; }`
- `bool IsAvailable { get; }`

**Methods**
- `public final virtual string get_Id()`
- `public final virtual bool get_IsAvailable()`
- `public final virtual void ApplyActionState(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`
- `public final virtual void Initialize()`
- `public final virtual void Update()`
- `public final virtual void Shutdown()`
- `public final virtual void OnPedControlChanged(Rage.Ped ped, bool controlledByLsa)`
- `public final virtual void OnNpcActionExecuted(Rage.Ped ped, string actionName, bool succeeded)`
- `public final virtual void EnrichActor(Rage.Ped ped, LosSantosAlive.Context.ActorContext context)`
- `public static void AddGeneralContextUpdate(LosSantosAlive.NPC.NpcState state, string update)`
- `public static bool ForceRefreshPedPrState(Rage.Ped ped, string reason)`
- `public static bool IsPedKnownHandcuffed(Rage.Ped ped)`
- `public static bool IsPedCurrentlyArrestedByPr(Rage.Ped ped, string reason)`
- `public static void InvalidatePedRecordCache(Rage.Ped ped)`
- `public static bool ForceRefreshPedRecordCache(Rage.Ped ped, string reason)`
- `public static bool ForceRefreshPedRecordCache(string pedHandle, string reason)`
- `public static void InvalidatePedRecordCache(string pedHandle)`
- `public static void PrewarmPedRecord(Rage.Ped ped)`
- `public static bool HasCachedPedRecord(Rage.Ped ped)`
- `public static void DrainCompletedAsyncRecords()`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedPipeClient`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool HasBridgeDiscovery()`
- `public static bool IsBridgeAvailable()`
- `public static bool ForceRefreshAvailability()`
- `public static void ResetAvailabilityCache()`
- `public static bool TryGetPedRecordJson(string pedHandle, ref string recordJson)`
- `public static bool TryGetPedStateJson(string pedHandle, ref string stateJson)`
- `public static bool TryGetArrestStateJson(string pedHandle, ref string stateJson)`
- `public static bool TryGetVehicleRecordJson(string vehicleHandle, ref string vehicleJson)`
- `public static bool TryQueuePedRecordJson(string pedHandle, ref string response)`
- `public static bool TryQueueVehicleRecordJson(string vehicleHandle, ref string response)`
- `public static bool TryQueuePedStateJson(string pedHandle, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref System.Collections.Generic.List`1<CompletedPedCheck> pedChecks, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedStates, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref System.Collections.Generic.List`1<CompletedPedCheck> pedChecks, ref string response)`
- `public static bool TryDrainCompletedRecords(ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> vehicleRecords, ref System.Collections.Generic.List`1<CompletedAsyncRecord> pedStates, ref System.Collections.Generic.List`1<CompletedDocumentHandoff> documentHandoffs, ref System.Collections.Generic.List`1<CompletedPedCheck> pedChecks, ref System.Collections.Generic.List`1<CompletedVehicleCheck> vehicleChecks, ref string response)`
- `public static bool TrySearchPed(string officerHandle, string suspectHandle, ref string response)`
- `public static bool TryArrestPed(string officerHandle, string suspectHandle, bool frontCuffs, ref string response)`
- `public static bool TryExecuteSuspectCommand(string command, string officerHandle, string suspectHandle, ref string response)`
- `public static bool TryExecuteSuspectCommand(string command, string officerHandle, string suspectHandle, ref string handoffJson, ref string response)`
- `public static bool TryDismissPed(string suspectHandle, ref string response)`
- `public static bool TrySetLsaControl(string pedHandle, bool controlledByLsa, ref string response)`
- `public static bool TrySetCalloutPed(string pedHandle, string calloutPedJson, ref string response)`
- `public static bool TrySetLspdfrCallout(string calloutJson, ref string response)`
- `public static bool TryGetLspdfrCallout(ref string calloutJson)`
- `public static bool TryAcceptLspdfrCallout(string calloutId, ref string response)`
- `public static bool TryDeclineLspdfrCallout(string calloutId, ref string response)`
- `public static bool TryEndLspdfrCallout(string calloutId, ref string response)`
- `public static bool TryGetLspdfrCalloutStatus(ref string response)`
- `public static bool TryRequestPedCheck(string officerHandle, string targetHandle, string personName, ref string response)`
- `public static bool TryRequestPedCheck(string officerHandle, string personName, ref string response)`
- `public static bool TryRequestVehicleCheck(string officerHandle, string vehicleHandle, string plate, ref string response)`
- `public static bool TryRequestBackup(string message, ref string response)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedPipeClient+CompletedAsyncRecord`
Kind: `class`; extends `System.Object`.

**Properties**
- `string Handle { set; get; }`
- `string Json { get; set; }`

**Methods**
- `public string get_Handle()`
- `public void set_Handle(string value)`
- `public string get_Json()`
- `public void set_Json(string value)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedPipeClient+CompletedDocumentHandoff`
Kind: `class`; extends `System.Object`.

**Properties**
- `string RequestId { set; get; }`
- `string Command { set; get; }`
- `string OfficerHandle { get; set; }`
- `string SuspectHandle { set; get; }`
- `string HandoffJson { get; set; }`

**Methods**
- `public string get_RequestId()`
- `public void set_RequestId(string value)`
- `public string get_Command()`
- `public void set_Command(string value)`
- `public string get_OfficerHandle()`
- `public void set_OfficerHandle(string value)`
- `public string get_SuspectHandle()`
- `public void set_SuspectHandle(string value)`
- `public string get_HandoffJson()`
- `public void set_HandoffJson(string value)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedPipeClient+CompletedPedCheck`
Kind: `class`; extends `System.Object`.

**Properties**
- `string RequestId { get; set; }`
- `string OfficerHandle { set; get; }`
- `string PersonName { get; set; }`
- `string ResultJson { get; set; }`

**Methods**
- `public string get_RequestId()`
- `public void set_RequestId(string value)`
- `public string get_OfficerHandle()`
- `public void set_OfficerHandle(string value)`
- `public string get_PersonName()`
- `public void set_PersonName(string value)`
- `public string get_ResultJson()`
- `public void set_ResultJson(string value)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PolicingRedefinedPipeClient+CompletedVehicleCheck`
Kind: `class`; extends `System.Object`.

**Properties**
- `string RequestId { set; get; }`
- `string OfficerHandle { get; set; }`
- `string VehicleHandle { set; get; }`
- `string Plate { set; get; }`
- `string ResultJson { set; get; }`

**Methods**
- `public string get_RequestId()`
- `public void set_RequestId(string value)`
- `public string get_OfficerHandle()`
- `public void set_OfficerHandle(string value)`
- `public string get_VehicleHandle()`
- `public void set_VehicleHandle(string value)`
- `public string get_Plate()`
- `public void set_Plate(string value)`
- `public string get_ResultJson()`
- `public void set_ResultJson(string value)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrActionBootstrap`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void RegisterAll()`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrActionStateModifier`
Kind: `class`; extends `System.Object`; interfaces: `IActionStateModifier`.

**Methods**
- `public final virtual void ApplyActionState(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string actionName, ActionStateModifierPhase phase)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrArrestActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrBackupActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrOfficerTargetActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`
- `public static void QueueSearchInventoryContextUpdates(Rage.Ped officer, Rage.Ped suspect, string suspectHandle)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrPedCheckActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrPulloverActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrPulloverBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool StartPullover(Rage.Ped officerPed, string vehicleDescription)`
- `public static bool StopPullover(Rage.Ped officerPed)`
- `public static bool StopPullover(Rage.Ped officerPed, bool stopVehicleFollow)`
- `public static bool IsPulloverActive(Rage.Ped officerPed)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrSuspectCommandActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`
- `public static void MarkArrestTargetQueued(Rage.Ped suspect, Rage.Ped officer, bool frontCuffs)`
- `public static bool TryGetPendingArrest(Rage.Ped suspect, ref Rage.Ped officer, ref bool frontCuffs)`
- `public static void ClearPendingArrest(Rage.Ped suspect)`
- `public static Rage.Ped ResolveArrestingOfficerForSuspect(Rage.Ped suspect, ref string resolution)`
- `public static Rage.Ped ResolveOfficerForSuspect(Rage.Ped suspect, ref string resolution)`

## `LosSantosAlive.Integrations.PolicingRedefinedBridge.PrVehicleCheckActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.Locations.AccessTagService`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static System.Collections.Generic.List`1<string> GetAccessTags(Rage.Ped ped)`
- `public static bool HasAccessTag(Rage.Ped ped, string accessTag)`

## `LosSantosAlive.Locations.ActivityDefinition`
Kind: `class`; extends `System.Object`.

**Properties**
- `string Name { get; set; }`
- `string DisplayName { set; get; }`
- `bool BlockedWhenOccupied { get; set; }`
- `bool OnlyWhenOccupied { get; set; }`
- `System.Collections.Generic.List`1<string> ExcludedRoles { get; set; }`
- `System.Collections.Generic.List`1<string> ExcludedModels { set; get; }`
- `System.Collections.Generic.List`1<string> RequiredAccessTags { get; set; }`
- `bool BlockIfUnauthorized { set; get; }`
- `bool IllegalIfUnauthorized { get; set; }`
- `bool SuspiciousIfUnauthorized { get; set; }`
- `string UnauthorizedLabel { set; get; }`
- `string ExecutorType { set; get; }`
- `string ExecutorValue { set; get; }`
- `int32 BeforeDelayMs { get; set; }`
- `int32 AfterDelayMs { set; get; }`
- `bool OccupiesPointWhileRunning { set; get; }`
- `string CompletionText { get; set; }`

**Methods**
- `public string get_Name()`
- `public void set_Name(string value)`
- `public string get_DisplayName()`
- `public void set_DisplayName(string value)`
- `public bool get_BlockedWhenOccupied()`
- `public void set_BlockedWhenOccupied(bool value)`
- `public bool get_OnlyWhenOccupied()`
- `public void set_OnlyWhenOccupied(bool value)`
- `public System.Collections.Generic.List`1<string> get_ExcludedRoles()`
- `public void set_ExcludedRoles(System.Collections.Generic.List`1<string> value)`
- `public System.Collections.Generic.List`1<string> get_ExcludedModels()`
- `public void set_ExcludedModels(System.Collections.Generic.List`1<string> value)`
- `public System.Collections.Generic.List`1<string> get_RequiredAccessTags()`
- `public void set_RequiredAccessTags(System.Collections.Generic.List`1<string> value)`
- `public bool get_BlockIfUnauthorized()`
- `public void set_BlockIfUnauthorized(bool value)`
- `public bool get_IllegalIfUnauthorized()`
- `public void set_IllegalIfUnauthorized(bool value)`
- `public bool get_SuspiciousIfUnauthorized()`
- `public void set_SuspiciousIfUnauthorized(bool value)`
- `public string get_UnauthorizedLabel()`
- `public void set_UnauthorizedLabel(string value)`
- `public string get_ExecutorType()`
- `public void set_ExecutorType(string value)`
- `public string get_ExecutorValue()`
- `public void set_ExecutorValue(string value)`
- `public int32 get_BeforeDelayMs()`
- `public void set_BeforeDelayMs(int32 value)`
- `public int32 get_AfterDelayMs()`
- `public void set_AfterDelayMs(int32 value)`
- `public bool get_OccupiesPointWhileRunning()`
- `public void set_OccupiesPointWhileRunning(bool value)`
- `public string get_CompletionText()`
- `public void set_CompletionText(string value)`

## `LosSantosAlive.Locations.ActivityItemDefinition`
Kind: `class`; extends `System.Object`.

**Properties**
- `string Name { set; get; }`
- `System.Collections.Generic.List`1<string> Aliases { set; get; }`
- `string ItemId { set; get; }`

**Methods**
- `public string get_Name()`
- `public void set_Name(string value)`
- `public System.Collections.Generic.List`1<string> get_Aliases()`
- `public void set_Aliases(System.Collections.Generic.List`1<string> value)`
- `public string get_ItemId()`
- `public void set_ItemId(string value)`

## `LosSantosAlive.Locations.ActivityItems`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static LosSantosAlive.Locations.ActivityItemDefinition Beer()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition SixPack()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Liquor()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition EnergyDrink()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Soda()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Water()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Slushie()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Coffee()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Donut()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition IceCream()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition BreakfastSnack()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition CannedGoods()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Fruit()`
- `public static LosSantosAlive.Locations.ActivityItemDefinition Snack()`

## `LosSantosAlive.Locations.ActivityPoint`
Kind: `class`; extends `System.Object`.

**Properties**
- `string Name { set; get; }`
- `Rage.Vector3 Position { set; get; }`
- `float32 Heading { get; set; }`
- `System.Collections.Generic.List`1<string> IntentTags { get; set; }`
- `System.Collections.Generic.List`1<string> RequiredAccessTags { get; set; }`
- `bool HiddenFromDestinationResolvingIfUnauthorized { get; set; }`
- `string UnauthorizedLabel { get; set; }`
- `System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityDefinition> Activities { set; get; }`
- `System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityItemDefinition> Items { get; set; }`
- `uint32 OccupiedByPedHandle { get; set; }`

**Methods**
- `public string get_Name()`
- `public void set_Name(string value)`
- `public Rage.Vector3 get_Position()`
- `public void set_Position(Rage.Vector3 value)`
- `public float32 get_Heading()`
- `public void set_Heading(float32 value)`
- `public System.Collections.Generic.List`1<string> get_IntentTags()`
- `public void set_IntentTags(System.Collections.Generic.List`1<string> value)`
- `public System.Collections.Generic.List`1<string> get_RequiredAccessTags()`
- `public void set_RequiredAccessTags(System.Collections.Generic.List`1<string> value)`
- `public bool get_HiddenFromDestinationResolvingIfUnauthorized()`
- `public void set_HiddenFromDestinationResolvingIfUnauthorized(bool value)`
- `public string get_UnauthorizedLabel()`
- `public void set_UnauthorizedLabel(string value)`
- `public System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityDefinition> get_Activities()`
- `public void set_Activities(System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityDefinition> value)`
- `public System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityItemDefinition> get_Items()`
- `public void set_Items(System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityItemDefinition> value)`
- `public uint32 get_OccupiedByPedHandle()`
- `public void set_OccupiedByPedHandle(uint32 value)`

## `LosSantosAlive.Locations.ActivityTemplates`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static LosSantosAlive.Locations.ActivityDefinition UseScenario(string name, string displayName, string scenarioName, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition TakeItem(string name, string displayName, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition InitiateDirectInteraction(string name, string displayName, string targetRole, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition CustomExecutor(string name, string displayName, string executorType, string executorValue, string completionText, int32 beforeDelayMs, int32 afterDelayMs, bool blockedWhenOccupied, bool occupiesPointWhileRunning)`
- `public static LosSantosAlive.Locations.ActivityDefinition Browse(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition Grab(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition PayForItems(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition UseAtm(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition UseCashRegister(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition RobCashRegister(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition OpenSafe(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition RobSafe(string completionText)`
- `public static LosSantosAlive.Locations.ActivityDefinition WaitTurn()`
- `public static LosSantosAlive.Locations.ActivityDefinition TalkToOccupant()`
- `public static LosSantosAlive.Locations.ActivityDefinition SuspiciousIfUnauthorized(LosSantosAlive.Locations.ActivityDefinition activity, string label)`
- `public static LosSantosAlive.Locations.ActivityDefinition IllegalIfUnauthorized(LosSantosAlive.Locations.ActivityDefinition activity, string label)`
- `public static LosSantosAlive.Locations.ActivityDefinition BlockIfUnauthorized(LosSantosAlive.Locations.ActivityDefinition activity, string accessTag, string label)`

## `LosSantosAlive.Locations.LocationAwarenessService`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static LosSantosAlive.Locations.LocationDefinition GetLocationForInterior(int32 interiorId)`
- `public static LosSantosAlive.Locations.LocationDefinition GetNearestLocation(Rage.Vector3 position, float32 maxDistance)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> GetNearbyLocations(Rage.Vector3 position, float32 maxDistance)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDistanceResult> GetNearbyLocationResults(Rage.Vector3 position, float32 maxDistance)`

## `LosSantosAlive.Locations.LocationCategoryRegistry`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.Dictionary`2<string, System.Collections.Generic.List`1<string>> CategoryAliases`

## `LosSantosAlive.Locations.LocationDefinition`
Kind: `class`; extends `System.Object`.

**Properties**
- `string Name { set; get; }`
- `string Zone { get; set; }`
- `System.Collections.Generic.List`1<string> Aliases { get; set; }`
- `System.Collections.Generic.List`1<string> Categories { get; set; }`
- `System.Collections.Generic.List`1<string> IntentTags { get; set; }`
- `Rage.Vector3 ReferencePoint { get; set; }`
- `System.Nullable`1<int32> InteriorId { set; get; }`
- `string Description { get; set; }`
- `System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityPoint> ActivityPoints { set; get; }`

**Methods**
- `public string get_Name()`
- `public void set_Name(string value)`
- `public string get_Zone()`
- `public void set_Zone(string value)`
- `public System.Collections.Generic.List`1<string> get_Aliases()`
- `public void set_Aliases(System.Collections.Generic.List`1<string> value)`
- `public System.Collections.Generic.List`1<string> get_Categories()`
- `public void set_Categories(System.Collections.Generic.List`1<string> value)`
- `public System.Collections.Generic.List`1<string> get_IntentTags()`
- `public void set_IntentTags(System.Collections.Generic.List`1<string> value)`
- `public Rage.Vector3 get_ReferencePoint()`
- `public void set_ReferencePoint(Rage.Vector3 value)`
- `public System.Nullable`1<int32> get_InteriorId()`
- `public void set_InteriorId(System.Nullable`1<int32> value)`
- `public string get_Description()`
- `public void set_Description(string value)`
- `public System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityPoint> get_ActivityPoints()`
- `public void set_ActivityPoints(System.Collections.Generic.List`1<LosSantosAlive.Locations.ActivityPoint> value)`

## `LosSantosAlive.Locations.LocationDistanceResult`
Kind: `class`; extends `System.Object`.

**Properties**
- `LosSantosAlive.Locations.LocationDefinition Location { get; }`
- `float32 Distance { get; }`

**Methods**
- `public LosSantosAlive.Locations.LocationDefinition get_Location()`
- `public float32 get_Distance()`

## `LosSantosAlive.Locations.LocationIndex`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.Dictionary`2<string, LosSantosAlive.Locations.LocationDefinition> ByName`
- `public static initonly System.Collections.Generic.Dictionary`2<string, System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition>> ByAlias`
- `public static initonly System.Collections.Generic.Dictionary`2<string, System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition>> ByCategory`
- `public static initonly System.Collections.Generic.Dictionary`2<int32, LosSantosAlive.Locations.LocationDefinition> ByInteriorId`

**Methods**
- `public static void Build()`

## `LosSantosAlive.Locations.LocationRandomPicker`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static LosSantosAlive.Locations.LocationDefinition PickRandom()`
- `public static LosSantosAlive.Locations.LocationDefinition PickRandomWithActivityPoints()`
- `public static LosSantosAlive.Locations.LocationDefinition PickRandomWithActivityPointsNear(Rage.Vector3 origin, float32 minimumDistance, float32 maximumDistance)`

## `LosSantosAlive.Locations.LocationRegistry`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> Locations`

## `LosSantosAlive.Locations.LocationResolver`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string query)`
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string query, Rage.Ped actor)`
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string destinationHint, string intent)`
- `public static LosSantosAlive.Locations.LocationDefinition Resolve(string destinationHint, string intent, Rage.Ped actor)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string query)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string query, Rage.Ped actor)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string destinationHint, string intent)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> ResolveAll(string destinationHint, string intent, Rage.Ped actor)`
- `public static LosSantosAlive.Locations.LocationDefinition ResolveByInteriorId(int32 interiorId)`

## `LosSantosAlive.Locations.Registries.AmmuNationLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.BankLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.BarAndClubLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.BarberShopLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.ClothingStoreLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.ConvenienceStoreLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.DrugDealLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.MiscCalloutLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.PoliceStationLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Locations.Registries.SubwayStationLocations`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static initonly System.Collections.Generic.List`1<LosSantosAlive.Locations.LocationDefinition> All`

## `LosSantosAlive.Navigation.NpcTargetResolver`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static System.Collections.Generic.List`1<NearbyPedInfo> GetNearbyPedInfo(Rage.Ped originPed, int32 radius)`

## `LosSantosAlive.Navigation.NpcTargetResolver+NearbyPedInfo`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped Ped`
- `public string ModelName`
- `public string Gender`
- `public string ScenarioName`
- `public string ScenarioText`
- `public string[] ScenarioKeywords`
- `public float32 Distance`

## `LosSantosAlive.NPC.Actions.Core.CoreCombatActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.NPC.Actions.Core.CoreComplianceActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.NPC.Actions.Core.CoreItemActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.NPC.Actions.Core.CoreMovementActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.NPC.Actions.Core.CoreSocialActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.NPC.Actions.Core.CoreVehicleActionRegistrar`
Kind: `class`; extends `System.Object`; interfaces: `LosSantosAlive.NPC.Actions.INpcActionRegistrar`.

**Methods**
- `public final virtual void RegisterActions()`

## `LosSantosAlive.NPC.Actions.INpcActionRegistrar`
Kind: `interface`.

**Methods**
- `public virtual abstract void RegisterActions()`

## `LosSantosAlive.NPC.Actions.Integrations.IntegrationActionBootstrap`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void RegisterAll()`

## `LosSantosAlive.NPC.Actions.NpcActionBootstrap`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void RegisterAll()`

## `LosSantosAlive.NPC.Actions.NpcActionContext`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string RawAction`
- `public string ActionName`
- `public string Parameter`
- `public Rage.Ped SourcePed`
- `public Rage.Ped TargetPed`
- `public LosSantosAlive.NPC.NpcState State`

## `LosSantosAlive.NPC.Actions.NpcActionHandler`
Kind: `class`; extends `System.MulticastDelegate`.

**Methods**
- `public virtual bool Invoke(LosSantosAlive.NPC.Actions.NpcActionContext context)`
- `public virtual System.IAsyncResult BeginInvoke(LosSantosAlive.NPC.Actions.NpcActionContext context, System.AsyncCallback callback, object object)`
- `public virtual bool EndInvoke(System.IAsyncResult result)`

## `LosSantosAlive.NPC.Actions.NpcActionRegistry`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Register(string canonicalName, System.Collections.Generic.IEnumerable`1<string> aliases, LosSantosAlive.NPC.Actions.NpcActionHandler handler)`
- `public static bool TryExecute(string actionName, string parameter, Rage.Ped sourcePed)`
- `public static bool HasAction(string actionName)`

## `LosSantosAlive.NPC.Actions.RoleActionRouter`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool TryExecute(string normalizedActionName, string parameter)`

## `LosSantosAlive.NPC.Behaviors.AccompliceBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartAccompliceMode(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StopAccompliceMode(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StopAccompliceTaskOnly(Rage.Ped ped)`

## `LosSantosAlive.NPC.Behaviors.ApproachCoordinator`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Initialize()`
- `public static bool Start(Rage.Ped moverPed, Rage.Ped targetPed, string targetDescription, string turnId, int64 generationId, string conversationId)`
- `public static void ReportImmediateFailure(Rage.Ped moverPed, string targetPedId, string turnId, int64 generationId, string conversationId, string reason)`

## `LosSantosAlive.NPC.Behaviors.CombatBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StartAttackPlayer(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartIntimidatePlayerWithWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartFleePlayer(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartWalkAwayFromPlayer(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartAttackTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartAttackTargetWithWeapon(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void TakeShotOnTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void StartIntimidateTargetWithWeapon(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartIntimidateTargetWithWeapon(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void StartFleeFromTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartWalkAwayFromTarget(Rage.Ped ped, Rage.Ped target, LosSantosAlive.NPC.NpcState state)`
- `public static void StartTakeCover(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateTakeCover(LosSantosAlive.NPC.NpcState state)`
- `public static void StopTakeCover(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateAttackTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopAttackTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateIntimidateTargetWithWeapon(LosSantosAlive.NPC.NpcState state)`
- `public static void StopIntimidateTargetWithWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateFleeFromTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFleeFromTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void UpdateWalkAwayFromTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopWalkAwayFromTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void StopAllCombat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void StopCombatTaskOnly(Rage.Ped ped)`
- `public static void StopCombatStateAndTasks(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool standStillOnFoot)`
- `public static void StartPutAwayWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartUnequipWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`

## `LosSantosAlive.NPC.Behaviors.ComplianceBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StartHandsUp(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateHandsUp(LosSantosAlive.NPC.NpcState state)`
- `public static void StopHandsUp(LosSantosAlive.NPC.NpcState state)`
- `public static void StartKneel(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateKneel(LosSantosAlive.NPC.NpcState state)`
- `public static void StopKneel(LosSantosAlive.NPC.NpcState state)`
- `public static void StartSitOnGround(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateSitOnGround(LosSantosAlive.NPC.NpcState state)`
- `public static void StopSitOnGround(LosSantosAlive.NPC.NpcState state)`
- `public static void Stop(LosSantosAlive.NPC.NpcState state)`
- `public static void PutHandsUp(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void HandsDown(LosSantosAlive.NPC.NpcState state)`
- `public static void Kneel(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void GetUp(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void PauseHandsUpAnimation(LosSantosAlive.NPC.NpcState state)`
- `public static void ReapplyHandsUpIfWanted(LosSantosAlive.NPC.NpcState state)`

## `LosSantosAlive.NPC.Behaviors.ConversationLookBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void StartPlayerMicLook(Rage.Ped ped)`
- `public static void StopPlayerMicLook(Rage.Ped ped)`
- `public static void Update()`
- `public static void LookAtPlayerOnce(Rage.Ped ped)`
- `public static void Start(Rage.Ped speakerPed, Rage.Ped listenerPed, string turnId, int64 generationId)`
- `public static void Stop(string speakerPedId, Rage.Ped speakerPed, string turnId, int64 generationId)`
- `public static void StopAll()`

## `LosSantosAlive.NPC.Behaviors.FollowBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void StartFollowTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void PauseFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void ResumeFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void RestartFollowTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StartFollowing(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void PauseFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void ResumeFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void RestartFollowing(LosSantosAlive.NPC.NpcState state)`
- `public static void StopFollowTaskOnly(Rage.Ped ped)`

## `LosSantosAlive.NPC.Behaviors.ItemBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Start(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string itemName)`
- `public static void Stop(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StartGrabItem(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string itemName)`
- `public static void StartUseHeldItem(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void ClearHeldItem(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool GiveTargetItem(Rage.Ped giverPed, LosSantosAlive.NPC.NpcState giverState)`
- `public static bool TakeTargetItem(Rage.Ped takerPed, LosSantosAlive.NPC.NpcState takerState)`
- `public static bool GiveHeldItemToTarget(Rage.Ped giverPed, LosSantosAlive.NPC.NpcState giverState, Rage.Ped targetPed)`
- `public static bool GiveHeldItemToTarget(Rage.Ped giverPed, LosSantosAlive.NPC.NpcState giverState, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState targetState)`
- `public static bool TakeHeldItemFromTarget(Rage.Ped takerPed, LosSantosAlive.NPC.NpcState takerState, Rage.Ped targetPed)`
- `public static bool TakeHeldItemFromTarget(Rage.Ped takerPed, LosSantosAlive.NPC.NpcState takerState, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState targetState)`

## `LosSantosAlive.NPC.Behaviors.MovementBehavior`
Kind: `static class`; extends `System.Object`.

**Events**
- `ApproachFinished` — accessors `remove_ApproachFinished, add_ApproachFinished`

**Methods**
- `public static void add_ApproachFinished(System.Action`4<Rage.Ped, Rage.Ped, bool, string> value)`
- `public static void remove_ApproachFinished(System.Action`4<Rage.Ped, Rage.Ped, bool, string> value)`
- `public static void StartTurnAround(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StopTurnAround(LosSantosAlive.NPC.NpcState state)`
- `public static void StartWalkBackwardsToTarget(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StartChaseTarget(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StopChaseTarget(LosSantosAlive.NPC.NpcState state)`
- `public static bool IsChasingTarget(LosSantosAlive.NPC.NpcState state)`
- `public static Rage.Ped GetChaseTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StartApproachTarget(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void StopApproachTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void StopWalkBackwardsToTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StartLeanAgainstVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StopLeanAgainstVehicle(LosSantosAlive.NPC.NpcState state)`

## `LosSantosAlive.NPC.Behaviors.NpcConversationAutoBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void OnAddressalPlaybackStarting(Rage.Ped speakerPed, Rage.Ped listenerPed)`

## `LosSantosAlive.NPC.Behaviors.ResumeActivityBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Start(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartResumeActivity(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void Stop(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StopResumeActivity(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`

## `LosSantosAlive.NPC.Behaviors.RoleBehaviors.NegotiatorActions`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool TryExecute(string normalizedActionName, string parameter)`

## `LosSantosAlive.NPC.Behaviors.SocialBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void StartStopAndFaceTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StartStopAndFaceTargetInVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateStopAndFaceTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopStopAndFaceTarget(LosSantosAlive.NPC.NpcState state)`
- `public static void StopStopAndFaceTargetTaskOnly(Rage.Ped ped)`
- `public static void StopAndFaceTarget(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearStopAndFaceTargetState(LosSantosAlive.NPC.NpcState state)`

## `LosSantosAlive.NPC.Behaviors.VehicleBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.NPC.NpcState state)`
- `public static bool FollowTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static bool StopFollowingTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static bool StartFollowTargetVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateFollowTargetVehicle(LosSantosAlive.NPC.NpcState state)`
- `public static bool StopFollowTargetVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool BeginAssignedVehicleSeatEntry(Rage.Ped ped, Rage.Vehicle vehicle, int32 seatIndex)`
- `public static void UpdateAssignedVehicleSeatEntry(LosSantosAlive.NPC.NpcState state)`
- `public static void StopAssignedVehicleSeatEntry(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterPassengerWhenPlayerEnters(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateEnterPassengerWhenPlayerEnters(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterPassengerWhenPlayerEnters(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterPassengerSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterPassengerSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateEnterPassengerSeat(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterPassengerSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterBackSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterBackSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateEnterBackSeat(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterBackSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterDriverSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartEnterDriverSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void UpdateEnterDriverSeat(LosSantosAlive.NPC.NpcState state)`
- `public static void StopEnterDriverSeat(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartExitWhenPlayerExits(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateExitWhenPlayerExits(LosSantosAlive.NPC.NpcState state)`
- `public static void StopExitWhenPlayerExits(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartDriveEvasive(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void UpdateDriveEvasive(LosSantosAlive.NPC.NpcState state)`
- `public static void StopDriveEvasive(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool StartDriving(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string vehicleDescription)`
- `public static void StopAllVehicleCommands(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void StopVehicleTaskOnly(Rage.Ped ped)`
- `public static void UpdateStartDriving(LosSantosAlive.NPC.NpcState state)`
- `public static void ForceExitVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void ForceExitVehicleFast(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void ForceExitVehicle(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, bool fastExit)`

## `LosSantosAlive.NPC.Behaviors.WeaponBehavior`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void TakePlayerWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void TakeTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void TakeTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, Rage.Ped targetPed)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, Rage.Ped targetPed)`
- `public static void GiveTargetWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName, Rage.Ped targetPed)`
- `public static bool EquipWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName)`
- `public static bool EquipResolvedWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, uint32 weaponHash, bool preparePed)`
- `public static void UnequipWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool EquipWeaponIfPossible(Rage.Ped ped, uint32 weaponHash)`
- `public static bool EquipBestWeaponIfPossible(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool EquipBestCombatWeaponIfPossible(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static bool TryResolveBestCombatWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, ref uint32 weaponHash)`
- `public static bool TryResolveOwnedWeapon(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string weaponName, ref uint32 weaponHash)`
- `public static bool TryResolveNamedOwnedWeapon(Rage.Ped ped, string weaponName, ref uint32 weaponHash)`
- `public static uint32 ResolveWeaponHash(string weaponName)`
- `public static void RememberCurrentWeapon(LosSantosAlive.NPC.NpcState state)`
- `public static void RememberCurrentWeaponNow(LosSantosAlive.NPC.NpcState state)`

## `LosSantosAlive.NPC.DirectedInteractionManager`
Kind: `static class`; extends `System.Object`.

**Events**
- `NpcToNpcInteractionReady` — accessors `add_NpcToNpcInteractionReady, remove_NpcToNpcInteractionReady`
- `NpcToNpcInteractionEnded` — accessors `add_NpcToNpcInteractionEnded, remove_NpcToNpcInteractionEnded`

**Methods**
- `public static void add_NpcToNpcInteractionReady(System.Action`3<string, Rage.Ped, Rage.Ped> value)`
- `public static void remove_NpcToNpcInteractionReady(System.Action`3<string, Rage.Ped, Rage.Ped> value)`
- `public static void add_NpcToNpcInteractionEnded(System.Action`1<string> value)`
- `public static void remove_NpcToNpcInteractionEnded(System.Action`1<string> value)`
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed)`
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed, string startingAction)`
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed, string startingAction, string targetReaction)`
- `public static string StartInteraction(Rage.Ped speakerPed, Rage.Ped targetPed, string startingAction, string targetReaction, bool stayInPlace)`
- `public static string StartFelonyStopInteraction(Rage.Ped officerPed, Rage.Ped targetPed)`
- `public static string StartFelonyStopInteraction(Rage.Ped officerPed, Rage.Ped targetPed, Rage.Vehicle sourceVehicle)`
- `public static bool SetStartingActionForPed(Rage.Ped ped, string startingAction)`
- `public static void StopInteraction(string interactionId)`
- `public static void StopInteractionForPed(Rage.Ped ped)`
- `public static void DetachInteractionForPlayerConversation(Rage.Ped ped)`
- `public static void ForceStopInteractionForPed(Rage.Ped ped)`
- `public static void MarkOpeningLineFinished(string interactionId)`
- `public static void MarkInteractionActive(string interactionId)`
- `public static void Update()`
- `public static bool ShouldSuppressAuthoredSetupReflex(Rage.Ped reactingPed, Rage.Ped sourcePed, LosSantosAlive.NPC.Reflexes.ReflexEventType eventType)`
- `public static bool ShouldSuppressAuthoredSetupReflex(Rage.Ped reactingPed, Rage.Ped sourcePed)`
- `public static bool IsPedInInteraction(Rage.Ped ped)`
- `public static bool IsInteractionActive(string interactionId)`
- `public static Rage.Ped GetInteractionPartner(Rage.Ped ped)`
- `public static string GetPedId(Rage.Ped ped)`

## `LosSantosAlive.NPC.Items.NpcHeldItemState`
Kind: `class`; extends `System.Object`.

**Properties**
- `string ItemName { set; get; }`
- `Rage.Object Prop { set; get; }`
- `bool IsBusy { get; set; }`
- `int32 LastMaintenanceTime { set; get; }`
- `int32 LastAnimRefreshTime { set; get; }`
- `string LastPropModel { get; set; }`
- `bool PropAttachFailedLogged { set; get; }`
- `bool IsHoldingItem { get; }`

**Methods**
- `public string get_ItemName()`
- `public void set_ItemName(string value)`
- `public Rage.Object get_Prop()`
- `public void set_Prop(Rage.Object value)`
- `public bool get_IsBusy()`
- `public void set_IsBusy(bool value)`
- `public int32 get_LastMaintenanceTime()`
- `public void set_LastMaintenanceTime(int32 value)`
- `public int32 get_LastAnimRefreshTime()`
- `public void set_LastAnimRefreshTime(int32 value)`
- `public string get_LastPropModel()`
- `public void set_LastPropModel(string value)`
- `public bool get_PropAttachFailedLogged()`
- `public void set_PropAttachFailedLogged(bool value)`
- `public bool get_IsHoldingItem()`
- `public void Clear()`

## `LosSantosAlive.NPC.Items.NpcItemDefinition`
Kind: `class`; extends `System.Object`.

**Properties**
- `string Name { get; set; }`
- `string DisplayName { get; set; }`
- `string PropModel { get; set; }`
- `string AnimDict { set; get; }`
- `string AnimName { set; get; }`
- `float32 HoldFrame { get; set; }`
- `LosSantosAlive.NPC.Items.NpcItemHand Hand { get; set; }`
- `Rage.Vector3 PositionOffset { set; get; }`
- `Rage.Vector3 RotationOffset { set; get; }`
- `string ContextHoldingText { get; set; }`
- `string UseActionName { get; set; }`
- `string UseActionDescription { get; set; }`
- `int32 BoneId { get; }`
- `bool HasProp { get; }`
- `bool HasAnimation { get; }`
- `bool HasUseAction { get; }`

**Methods**
- `public string get_Name()`
- `public void set_Name(string value)`
- `public string get_DisplayName()`
- `public void set_DisplayName(string value)`
- `public string get_PropModel()`
- `public void set_PropModel(string value)`
- `public string get_AnimDict()`
- `public void set_AnimDict(string value)`
- `public string get_AnimName()`
- `public void set_AnimName(string value)`
- `public float32 get_HoldFrame()`
- `public void set_HoldFrame(float32 value)`
- `public LosSantosAlive.NPC.Items.NpcItemHand get_Hand()`
- `public void set_Hand(LosSantosAlive.NPC.Items.NpcItemHand value)`
- `public Rage.Vector3 get_PositionOffset()`
- `public void set_PositionOffset(Rage.Vector3 value)`
- `public Rage.Vector3 get_RotationOffset()`
- `public void set_RotationOffset(Rage.Vector3 value)`
- `public string get_ContextHoldingText()`
- `public void set_ContextHoldingText(string value)`
- `public string get_UseActionName()`
- `public void set_UseActionName(string value)`
- `public string get_UseActionDescription()`
- `public void set_UseActionDescription(string value)`
- `public int32 get_BoneId()`
- `public bool get_HasProp()`
- `public bool get_HasAnimation()`
- `public bool get_HasUseAction()`

## `LosSantosAlive.NPC.Items.NpcItemHand`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Items.NpcItemHand Left = 0`
- `public static literal LosSantosAlive.NPC.Items.NpcItemHand Right = 1`

## `LosSantosAlive.NPC.Items.NpcItemStore`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void RegisterDefaults()`
- `public static void Register(LosSantosAlive.NPC.Items.NpcItemDefinition item)`
- `public static bool TryGet(string name, ref LosSantosAlive.NPC.Items.NpcItemDefinition item)`
- `public static System.Collections.Generic.IEnumerable`1<LosSantosAlive.NPC.Items.NpcItemDefinition> GetAll()`
- `public static void Clear()`

## `LosSantosAlive.NPC.Memory.InteractionActivityMemory`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string Activity`
- `public Rage.Vector3 Position`
- `public float32 Heading`
- `public int32 LastSeenGameTime`

## `LosSantosAlive.NPC.Memory.PedContinuityMemory`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string PedHandle`
- `public LosSantosAlive.NPC.Memory.RecentVehicleMemory RecentVehicle`
- `public LosSantosAlive.NPC.Memory.InteractionActivityMemory InteractionActivity`
- `public int32 LastUpdatedGameTime`

## `LosSantosAlive.NPC.Memory.PedContinuityMemoryService`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`
- `public static bool TryGetMemory(Rage.Ped ped, ref LosSantosAlive.NPC.Memory.PedContinuityMemory memory)`

## `LosSantosAlive.NPC.Memory.RecentVehicleMemory`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string VehicleHandle`
- `public string SeatRole`
- `public int32 LastSeenGameTime`

## `LosSantosAlive.NPC.Navigation.DestinationResolver`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static bool TryResolve(string destinationName, ref Rage.Vector3 destination)`

## `LosSantosAlive.NPC.NpcActionQueue`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void BeginReflexSpecialTurnActionLock(Rage.Ped speakerPed, string reason)`
- `public static void EndReflexSpecialTurnActionLock(Rage.Ped speakerPed, string reason)`
- `public static void QueueNpcAction(string action)`
- `public static void QueueNpcAction(string action, Rage.Ped sourcePed)`
- `public static void QueueNpcAction(string action, string parameter, string targetDescription)`
- `public static void QueueNpcAction(string action, string parameter, string targetDescription, Rage.Ped sourcePed)`
- `public static void QueueNpcAction(string action, string parameter, string targetDescription, Rage.Ped sourcePed, Rage.Ped targetPed)`
- `public static void ProcessPendingActions()`

## `LosSantosAlive.NPC.NpcActions`
Kind: `static class`; extends `System.Object`.

**Properties**
- `bool DispatcherOwnsActionModifiers`

**Methods**
- `public static void SetControlledPed(Rage.Ped ped, bool prepare)`
- `public static void QueueConversationWarmup(Rage.Ped ped)`
- `public static void IntimidateTargetWithWeapon(Rage.Ped ped, Rage.Ped targetPed)`
- `public static void IntimidateTargetWithWeapon(Rage.Ped ped, Rage.Ped targetPed, NpcActionExecutionContext executionContext)`
- `public static bool TryExecuteDirectedInteractionAction(Rage.Ped ped, Rage.Ped targetPed, string actionName)`
- `public static bool IsSupportedDirectedInteractionTargetReaction(string reactionName)`
- `public static bool TryExecuteDirectedInteractionTargetReaction(Rage.Ped targetPed, Rage.Ped sourcePed, string reactionName)`
- `public static void StartDriving()`
- `public static void StartDriving(string vehicleDescription)`
- `public static void StartDriving(Rage.Ped ped, string vehicleDescription)`
- `public static void GrabItem(string itemName)`
- `public static void GrabItem(Rage.Ped ped, string itemName)`
- `public static void UseHeldItem()`
- `public static void UseHeldItem(Rage.Ped ped)`
- `public static void ClearHeldItem()`
- `public static void ClearHeldItem(Rage.Ped ped)`
- `public static void GiveTargetItem()`
- `public static void GiveTargetItem(Rage.Ped ped)`
- `public static void TakeTargetItem()`
- `public static void TakeTargetItem(Rage.Ped ped)`
- `public static void UseScenario()`
- `public static void UseScenario(string scenarioName)`
- `public static void UseScenario(Rage.Ped ped, string scenarioName)`
- `public static void UseScenarioAtPosition(Rage.Ped ped, string scenarioName, Rage.Vector3 position, float32 heading, string debugPointName)`
- `public static void FollowTarget()`
- `public static void FollowTarget(Rage.Ped ped)`
- `public static void WaitHere()`
- `public static void WaitHere(Rage.Ped ped)`
- `public static void TakeCover()`
- `public static void TakeCover(Rage.Ped ped)`
- `public static void GoTalkToNearestPed()`
- `public static void GoTalkToNearestPed(Rage.Ped ped)`
- `public static void GoTalkToNearestPed(Rage.Ped ped, string targetDescription)`
- `public static void FelonyStopInteraction()`
- `public static void FelonyStopInteraction(Rage.Ped ped)`
- `public static void FelonyStopInteraction(Rage.Ped ped, string targetDescription)`
- `public static void ApproachTarget()`
- `public static void ApproachTarget(Rage.Ped ped)`
- `public static void ChaseTarget()`
- `public static void ChaseTarget(Rage.Ped ped)`
- `public static void ChaseTarget(Rage.Ped ped, Rage.Ped targetPed)`
- `public static void StopAndFaceTarget()`
- `public static void StopAndFaceTarget(Rage.Ped ped)`
- `public static void StopAndFaceTarget(Rage.Ped ped, Rage.Ped targetPed)`
- `public static void StopDirectedInteraction()`
- `public static void StopDirectedInteraction(Rage.Ped ped)`
- `public static void EnterTargetVehicle()`
- `public static void EnterTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static void EnterBackOfTargetVehicle()`
- `public static void EnterBackOfTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static void EnterDriverSeatOfTargetVehicle()`
- `public static void EnterDriverSeatOfTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static void FollowTargetVehicle(string vehicleDescription)`
- `public static void FollowTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static void StopFollowingTargetVehicle(string vehicleDescription)`
- `public static void StopFollowingTargetVehicle(Rage.Ped ped, string vehicleDescription)`
- `public static void DriveEvasive()`
- `public static void DriveEvasive(Rage.Ped ped)`
- `public static void DriveNormal()`
- `public static void DriveNormal(Rage.Ped ped)`
- `public static void ExitVehicle()`
- `public static void ExitVehicle(Rage.Ped ped)`
- `public static void PutHandsUp()`
- `public static void PutHandsUp(Rage.Ped ped)`
- `public static void PutHandsUpFromReflex(Rage.Ped ped)`
- `public static void PutHandsUpFromReflex(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void KneelFromReflex(Rage.Ped ped)`
- `public static void KneelFromReflex(Rage.Ped ped, LosSantosAlive.NPC.NpcState state)`
- `public static void PutHandsDown()`
- `public static void PutHandsDown(Rage.Ped ped)`
- `public static void Kneel()`
- `public static void Kneel(Rage.Ped ped)`
- `public static void GetUp()`
- `public static void GetUp(Rage.Ped ped)`
- `public static void TurnAround()`
- `public static void TurnAround(Rage.Ped ped)`
- `public static void WalkBackwardsToTarget()`
- `public static void WalkBackwardsToTarget(Rage.Ped ped)`
- `public static void LeanAgainstVehicle()`
- `public static void LeanAgainstVehicle(Rage.Ped ped)`
- `public static void SitOnGround()`
- `public static void SitOnGround(Rage.Ped ped)`
- `public static void WalkAwayFromTarget()`
- `public static void WalkAwayFromTarget(Rage.Ped ped)`
- `public static void FleeFromTarget()`
- `public static void FleeFromTarget(Rage.Ped ped)`
- `public static void AttackTarget()`
- `public static void AttackTarget(Rage.Ped ped)`
- `public static void AttackTargetWithWeapon()`
- `public static void AttackTargetWithWeapon(string weaponName)`
- `public static void AttackTargetWithWeapon(Rage.Ped ped)`
- `public static void AttackTargetWithWeapon(Rage.Ped ped, string weaponName)`
- `public static void TakeShotOnTarget()`
- `public static void TakeShotOnTarget(string weaponName)`
- `public static void TakeShotOnTarget(Rage.Ped ped)`
- `public static void TakeShotOnTarget(Rage.Ped ped, string weaponName)`
- `public static void TakeTargetWeapon()`
- `public static void TakeTargetWeapon(Rage.Ped ped)`
- `public static void GiveTargetWeapon()`
- `public static void GiveTargetWeapon(string weaponName)`
- `public static void GiveTargetWeapon(Rage.Ped ped)`
- `public static void GiveTargetWeapon(Rage.Ped ped, string weaponName)`
- `public static void EquipWeapon()`
- `public static void EquipWeapon(string weaponName)`
- `public static void EquipWeapon(Rage.Ped ped)`
- `public static void EquipWeapon(Rage.Ped ped, string weaponName)`
- `public static void IntimidateTargetWithWeapon()`
- `public static void IntimidateTargetWithWeapon(string weaponName)`
- `public static void IntimidateTargetWithWeapon(Rage.Ped ped)`
- `public static void IntimidateTargetWithWeapon(Rage.Ped ped, string weaponName)`
- `public static void IntimidateTargetWithWeaponFromReflex(Rage.Ped ped, Rage.Ped targetPed)`
- `public static void IntimidateTargetWithWeaponFromReflex(Rage.Ped ped, Rage.Ped targetPed, LosSantosAlive.NPC.NpcState state)`
- `public static void UnequipWeapon()`
- `public static void UnequipWeapon(Rage.Ped ped)`
- `public static void PutAwayWeapon()`
- `public static void PutAwayWeapon(Rage.Ped ped)`
- `public static void BecomeAccomplice()`
- `public static void BecomeAccomplice(Rage.Ped ped)`
- `public static void ResumeActivity()`
- `public static void ReturnToActivity()`
- `public static void ContinueActivity()`
- `public static void ResumeActivity(Rage.Ped ped)`
- `public static void ResumeActivity(Rage.Ped ped, string ignoredParameter)`
- `public static DirectedInteractionActionCompatibility GetDirectedInteractionActionCompatibility(string actionName)`
- `public static void Update()`
- `public static void ClearDestinationFlags(LosSantosAlive.NPC.NpcState state)`
- `public static bool HasExclusiveControl(Rage.Ped ped)`
- `public static string GetExclusiveControlReason(Rage.Ped ped)`
- `public static void ReleaseExclusiveControlForExternalSystem(Rage.Ped ped, string reason, bool clearNativeTasks)`
- `public static void ClearVehicleIntentFlagsOnly(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearAllVehicleFlags(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearExplicitVehicleEnterFlags(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearFollowFlags(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearComplianceFlags(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearKneelFlag(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearMovementActionFlags(LosSantosAlive.NPC.NpcState state)`
- `public static void ClearHostileFlags(LosSantosAlive.NPC.NpcState state)`
- `public static void PreparePed(Rage.Ped ped)`
- `public static void SetControlledBrain(Rage.Ped ped, bool enabled)`
- `public static void Cleanup()`

## `LosSantosAlive.NPC.NpcActions+DirectedInteractionActionCompatibility`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal DirectedInteractionActionCompatibility Unsupported = 0`
- `public static literal DirectedInteractionActionCompatibility Concurrent = 1`
- `public static literal DirectedInteractionActionCompatibility ReplacesInteraction = 2`

## `LosSantosAlive.NPC.NpcActions+NpcActionExecutionContext`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal NpcActionExecutionContext Normal = 0`
- `public static literal NpcActionExecutionContext DirectedInteractionConcurrent = 1`

## `LosSantosAlive.NPC.NpcActivityQueueItem`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string LocationName`
- `public string ActivityPointName`
- `public string ActivityName`
- `public string ItemName`
- `public string RawAction`
- `public bool Started`
- `public bool Completed`

## `LosSantosAlive.NPC.NpcFocus`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void SetFocus(Rage.Ped actorPed, Rage.Ped targetPed, string reason)`
- `public static void ClearFocus(Rage.Ped actorPed)`
- `public static Rage.Ped GetFocus(Rage.Ped actorPed)`
- `public static bool HasFocus(Rage.Ped actorPed)`
- `public static string GetFocusReason(Rage.Ped actorPed)`

## `LosSantosAlive.NPC.NpcRuntimeMode`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode Passive = 0`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode ReflexOnly = 1`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode ActiveBehavior = 2`
- `public static literal LosSantosAlive.NPC.NpcRuntimeMode Conversation = 3`

## `LosSantosAlive.NPC.NpcState`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped Ped`
- `public LosSantosAlive.NPC.Roles.NpcRoleType RoleType`
- `public LosSantosAlive.NPC.Roles.NpcRoleProfile RoleProfile`
- `public bool HasBeenTakenOver`
- `public bool StayUnderLsaControl`
- `public bool HasEverHadConversation`
- `public LosSantosAlive.NPC.NpcRuntimeMode RuntimeMode`
- `public bool FollowPlayerOnFoot`
- `public bool FollowPaused`
- `public bool HasDestination`
- `public string DestinationRawRequest`
- `public string DestinationHint`
- `public string DestinationIntent`
- `public string ResolvedDestinationName`
- `public string CurrentDestinationName`
- `public string CurrentDestinationDescription`
- `public Rage.Vector3 DestinationPosition`
- `public bool DestinationResolved`
- `public bool WalkToDestination`
- `public bool DriveToDestination`
- `public System.Collections.Generic.Queue`1<LosSantosAlive.NPC.NpcActivityQueueItem> ActivityQueue`
- `public LosSantosAlive.NPC.NpcActivityQueueItem CurrentActivity`
- `public bool HasActivityQueue`
- `public bool ActivityInProgress`
- `public bool ActivityWaitingForTurn`
- `public uint32 OccupyingActivityPointPedHandle`
- `public string CurrentActivityLocationName`
- `public string CurrentActivityPointName`
- `public string CurrentActivityName`
- `public string CurrentActivityItemName`
- `public int32 ActivityStartTime`
- `public int32 LastActivityTaskTime`
- `public System.Collections.Generic.List`1<string> ActivityUpdatesSinceLastInteraction`
- `public System.Collections.Generic.List`1<string> ContextUpdatesSinceLastInteraction`
- `public System.Collections.Generic.List`1<string> ImmediateContextUpdates`
- `public LosSantosAlive.NPC.Items.NpcHeldItemState HeldItem`
- `public bool EnterDriverSeatWhenPlayerVehicleNearby`
- `public bool EnterPassengerSeatWhenPlayerVehicleNearby`
- `public bool EnterBackPassengerSeatWhenPlayerVehicleNearby`
- `public bool EnterPassengerSeatWhenPlayerEnters`
- `public bool ExitVehicleWhenPlayerExits`
- `public Rage.Vehicle AssignedVehicle`
- `public int32 AssignedVehicleSeatIndex`
- `public bool AssignedVehicleSeatEntryActive`
- `public bool DriveToXWhenBothSeated`
- `public bool DriveEvasiveMode`
- `public string PendingDriveDestinationName`
- `public Rage.Vector3 DriveDestination`
- `public bool HasResolvedDriveDestination`
- `public bool WalkAway`
- `public bool FleePlayer`
- `public bool IntimidatePlayerWithWeapon`
- `public Rage.Ped IntimidateTargetPed`
- `public bool AttackPlayer`
- `public bool TurnAroundMode`
- `public Rage.Ped TurnAroundTargetPed`
- `public bool WalkBackwardsToTargetMode`
- `public Rage.Ped WalkBackwardsTargetPed`
- `public bool LeanAgainstVehicleMode`
- `public bool ApproachTargetMode`
- `public Rage.Ped ApproachTargetPed`
- `public int32 LastApproachTaskTime`
- `public bool ChaseTargetMode`
- `public Rage.Ped ChaseTargetPed`
- `public int32 LastChaseTaskTime`
- `public bool TakeCoverMode`
- `public int32 LastTakeCoverTaskTime`
- `public bool AccompliceMode`
- `public Rage.Ped CurrentFocusPed`
- `public string CurrentFocusReason`
- `public uint32 LastAutoAddressedPedHandle`
- `public uint32 AutoResumeFollowPedHandle`
- `public string ActiveInteractionId`
- `public bool InDirectedInteraction`
- `public bool StopAndFaceTargetMode`
- `public Rage.Ped StopAndFaceTargetPed`
- `public int32 LastStopAndFaceTaskTime`
- `public bool HandsUpMode`
- `public bool WantsHandsUp`
- `public bool KneelMode`
- `public bool SitOnGroundMode`
- `public System.Collections.Generic.HashSet`1<string> BlockedActions`
- `public string ActionBlockReason`
- `public bool BlockPhysicalReflexActions`
- `public string PhysicalReflexBlockReason`
- `public bool HasActiveReflex`
- `public string LastReflexEvent`
- `public LosSantosAlive.NPC.Reflexes.ReflexEventType LastReflexEventType`
- `public string LastReflexReaction`
- `public string LastReflexReason`
- `public int32 LastReflexTime`
- `public bool LastReflexRequestedGeminiSession`
- `public System.Collections.Generic.Dictionary`2<LosSantosAlive.NPC.Reflexes.ReflexEventType, int32> ReflexLastTimes`
- `public System.Collections.Generic.HashSet`1<LosSantosAlive.NPC.Reflexes.ReflexEventType> LockedReflexEvents`
- `public bool ReflexLocked`
- `public int32 ReflexEscalationLevel`
- `public int32 LastFollowTaskTime`
- `public int32 LastVehicleEnterTaskTime`
- `public int32 LastVehicleExitTaskTime`
- `public int32 LastAccompliceUpdateTime`
- `public int32 LastComplianceTaskTime`
- `public int32 LastCombatTaskTime`
- `public int32 LastDriveTaskTime`
- `public int32 LastFocusChangeTime`
- `public int32 LastInteractionTaskTime`
- `public int32 LastDestinationTaskTime`
- `public int32 LastMovementActionTaskTime`
- `public int32 LastReflexOnlyBrainRefreshTime`
- `public bool LastWantedControlledBrain`
- `public Rage.Vehicle TargetVehicle`
- `public uint32 LastKnownWeaponHash`
- `public bool WeaponEquippedMode`
- `public uint32 EquippedWeaponHash`

**Properties**
- `bool IsPassiveRuntime { get; }`
- `bool IsReflexOnlyRuntime { get; }`
- `bool IsActiveBehaviorRuntime { get; }`
- `bool IsConversationRuntime { get; }`
- `bool ShouldUseFullBehaviorStack { get; }`

**Methods**
- `public bool get_IsPassiveRuntime()`
- `public bool get_IsReflexOnlyRuntime()`
- `public bool get_IsActiveBehaviorRuntime()`
- `public bool get_IsConversationRuntime()`
- `public bool get_ShouldUseFullBehaviorStack()`
- `public bool IsActionBlocked(string normalizedActionName)`
- `public void BlockAction(string normalizedActionName, string reason)`
- `public void BlockActions(System.Collections.Generic.IEnumerable`1<string> normalizedActionNames, string reason)`
- `public void UnblockAction(string normalizedActionName)`
- `public void ClearBlockedActions()`
- `public void PromoteToConversationRuntime()`
- `public void PromoteToActiveBehaviorRuntime()`
- `public void PromoteToReflexOnlyRuntime()`
- `public void DemoteToPassiveRuntime()`

## `LosSantosAlive.NPC.NpcStateStore`
Kind: `static class`; extends `System.Object`.

**Properties**
- `int32 Count { get; }`

**Methods**
- `public static LosSantosAlive.NPC.NpcState GetState(Rage.Ped ped)`
- `public static LosSantosAlive.NPC.NpcState TryGetState(Rage.Ped ped)`
- `public static bool TryGetState(Rage.Ped ped, ref LosSantosAlive.NPC.NpcState state)`
- `public static LosSantosAlive.NPC.NpcState GetStateForReflex(Rage.Ped ped)`
- `public static LosSantosAlive.NPC.NpcState GetStateForActiveBehavior(Rage.Ped ped)`
- `public static LosSantosAlive.NPC.NpcState GetStateForConversation(Rage.Ped ped)`
- `public static void PromoteToReflexOnly(Rage.Ped ped)`
- `public static void PromoteToActiveBehavior(Rage.Ped ped)`
- `public static void PromoteToConversation(Rage.Ped ped)`
- `public static System.Collections.Generic.IEnumerable`1<System.Collections.Generic.KeyValuePair`2<string, LosSantosAlive.NPC.NpcState>> GetAllStates()`
- `public static System.Collections.Generic.List`1<System.Collections.Generic.KeyValuePair`2<string, LosSantosAlive.NPC.NpcState>> GetAllStatesSnapshot()`
- `public static void RemoveState(string key)`
- `public static void RemoveState(Rage.Ped ped)`
- `public static bool HasState(Rage.Ped ped)`
- `public static int32 get_Count()`
- `public static void Clear()`
- `public static void ClearRecentlyReleased(Rage.Ped ped)`

## `LosSantosAlive.NPC.NpcTargeting`
Kind: `static class`; extends `System.Object`.

**Properties**
- `bool IsFirstConversationWarmupComplete { get; }`
- `Rage.Ped PlayerConversationPed { get; }`
- `bool HasPlayerConversationPed { get; }`
- `Rage.Ped CurrentSpeakerPed { get; }`
- `bool HasCurrentSpeaker { get; }`

**Methods**
- `public static void WarmupForFirstConversation()`
- `public static void BeginFirstConversationWarmup()`
- `public static bool get_IsFirstConversationWarmupComplete()`
- `public static Rage.Ped get_PlayerConversationPed()`
- `public static bool get_HasPlayerConversationPed()`
- `public static void SetPlayerConversationPed(Rage.Ped ped)`
- `public static Rage.Ped GetPlayerConversationPed()`
- `public static void ClearPlayerConversationPed()`
- `public static Rage.Ped get_CurrentSpeakerPed()`
- `public static bool get_HasCurrentSpeaker()`
- `public static void ActivateAttention(Rage.Ped ped)`
- `public static Rage.Ped GetCurrentSpeakerPed()`
- `public static void ClearCurrentSpeaker()`
- `public static Rage.Ped GetRelevantTarget(Rage.Ped speakerPed)`
- `public static bool TryGetRelevantTarget(Rage.Ped speakerPed, ref Rage.Ped targetPed)`
- `public static Rage.Ped SetRelevantTarget(Rage.Ped speakerPed, Rage.Ped targetPed, string reason)`
- `public static Rage.Ped GetBestConversationPed()`
- `public static Rage.Ped GetBestConversationPed(Rage.Ped excludedPed)`
- `public static Rage.Ped GetBestConversationPed(float32 cameraMaxDistance, float32 nearestFallbackDistance)`
- `public static Rage.Ped GetBestConversationPed(float32 cameraMaxDistance, float32 nearestFallbackDistance, Rage.Ped excludedPed)`
- `public static Rage.Ped GetNearestPed()`
- `public static Rage.Ped GetNearestPed(Rage.Ped excludedPed)`
- `public static Rage.Ped GetNearestPed(float32 maxDistance)`
- `public static Rage.Ped GetNearestPed(float32 maxDistance, Rage.Ped excludedPed)`
- `public static bool IsValid(Rage.Ped ped)`
- `public static bool IsValidAnyPed(Rage.Ped ped)`
- `public static bool IsValidHumanPed(Rage.Ped ped)`
- `public static bool IsHumanPed(Rage.Ped ped)`

## `LosSantosAlive.NPC.Perception.PerceptionSnapshot`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped Player`
- `public Rage.Ped[] AllPeds`
- `public Rage.Vehicle[] AllVehicles`
- `public int32 GameTime`

**Properties**
- `bool IsValid { get; }`

**Methods**
- `public bool get_IsValid()`
- `public bool TryGetPedByHandleString(string pedId, ref Rage.Ped ped)`
- `public bool TryGetPedByHandle(uint32 handle, ref Rage.Ped ped)`
- `public static LosSantosAlive.NPC.Perception.PerceptionSnapshot Capture()`

## `LosSantosAlive.NPC.Perception.PerceptionSystem`
Kind: `static class`; extends `System.Object`.

**Properties**
- `LosSantosAlive.NPC.Perception.PerceptionSnapshot CurrentSnapshot { get; }`

**Methods**
- `public static LosSantosAlive.NPC.Perception.PerceptionSnapshot get_CurrentSnapshot()`
- `public static LosSantosAlive.NPC.Perception.PerceptionSnapshot Update()`
- `public static bool TryGetSnapshot(ref LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`
- `public static Rage.Ped[] GetPedsSnapshot()`
- `public static Rage.Vehicle[] GetVehiclesSnapshot()`
- `public static Rage.Ped FindPedByHandleString(string pedId)`
- `public static Rage.Ped FindPedByHandle(uint32 handle)`

## `LosSantosAlive.NPC.Reflexes.Awareness.ReflexAwarenessMemory`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public LosSantosAlive.NPC.Reflexes.ReflexEventType EventType`
- `public string EventReason`
- `public LosSantosAlive.NPC.Reflexes.ReflexReactionType AmbientReactionType`
- `public string AmbientReactionReason`
- `public Rage.Vector3 EventPosition`
- `public uint32 SourcePedHandle`
- `public int32 LastSeenGameTime`

## `LosSantosAlive.NPC.Reflexes.Awareness.ReflexAwarenessService`
Kind: `static class`; extends `System.Object`.

**Properties**
- `int32 Count { get; }`

**Methods**
- `public static int32 get_Count()`
- `public static void Record(Rage.Ped ped, LosSantosAlive.NPC.Reflexes.ReflexEventType eventType, string eventReason, Rage.Vector3 eventPosition, Rage.Ped sourcePed)`
- `public static void Record(Rage.Ped ped, LosSantosAlive.NPC.Reflexes.ReflexEventType eventType, string eventReason, Rage.Vector3 eventPosition, Rage.Ped sourcePed, LosSantosAlive.NPC.Reflexes.ReflexReactionType ambientReactionType, string ambientReactionReason)`
- `public static bool TryGetMemory(Rage.Ped ped, ref LosSantosAlive.NPC.Reflexes.Awareness.ReflexAwarenessMemory memory)`
- `public static void Cleanup()`

## `LosSantosAlive.NPC.Reflexes.Detectors.GunAimReflexDetector`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`

## `LosSantosAlive.NPC.Reflexes.Detectors.GunshotReflexDetector`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static literal int32 RecentShotMemoryMs = 2500`
- `public static literal int32 RecentTazerMemoryMs = 1400`

**Methods**
- `public static void UpdatePlayerShotDetection(Rage.Ped player, int32 now)`
- `public static void Update(LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`
- `public static bool IsPlayfulProjectileWeapon(uint32 weaponHash)`
- `public static string GetPlayfulProjectileReason(uint32 weaponHash)`
- `public static bool IsIgnoredGunshotWeapon(uint32 weaponHash)`
- `public static bool IsWeaponValidForGunshotDamage(uint32 weaponHash)`
- `public static bool HasRecentShotActivity(int32 now)`
- `public static bool TryResolveRecentGunshotSource(Rage.Ped targetPed, int32 now, float32 maxDistance, ref Rage.Ped sourcePed, ref uint32 weaponHash, ref string weaponName)`
- `public static bool TryResolveRecentTazerSource(Rage.Ped targetPed, int32 now, float32 maxDistance, ref Rage.Ped sourcePed, ref uint32 weaponHash, ref string weaponName)`
- `public static string WeaponHashToName(uint32 weapon)`

## `LosSantosAlive.NPC.Reflexes.Detectors.GunshotReflexDetector+RecentShot`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public int32 Time`
- `public Rage.Ped SourcePed`
- `public uint32 SourceHandle`
- `public int32 LastProcessTime`
- `public Rage.Vector3 Position`
- `public uint32 WeaponHash`
- `public string WeaponName`
- `public bool IsTazer`

## `LosSantosAlive.NPC.Reflexes.Detectors.MeleeThreatReflexDetector`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`

## `LosSantosAlive.NPC.Reflexes.Detectors.PedShotReflexDetector`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Start()`
- `public static void Stop()`
- `public static void Update(LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`

## `LosSantosAlive.NPC.Reflexes.Detectors.SuspectFleeReflexDetector`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void NotifyFleeStarted(Rage.Ped fleeingPed)`

## `LosSantosAlive.NPC.Reflexes.Detectors.VehicleCrashReflexDetector`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.NPC.Perception.PerceptionSnapshot snapshot)`

## `LosSantosAlive.NPC.Reflexes.Detectors.VehicleCrashReflexDetector+CrashSeverity`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal CrashSeverity Minor = 0`
- `public static literal CrashSeverity Medium = 1`
- `public static literal CrashSeverity Major = 2`

## `LosSantosAlive.NPC.Reflexes.ReflexEventDefinition`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public LosSantosAlive.NPC.Reflexes.ReflexEventType EventType`
- `public LosSantosAlive.NPC.Reflexes.ReflexRepeatMode RepeatMode`
- `public bool ShouldStartGeminiSession`
- `public bool ShouldInterruptGeminiSession`
- `public int32 CooldownMs`
- `public int32 Priority`
- `public System.Collections.Generic.Dictionary`2<LosSantosAlive.NPC.Reflexes.ReflexReactionType, int32> ReactionWeights`

## `LosSantosAlive.NPC.Reflexes.ReflexEventType`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType None = 0`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerAimedGunAtPed = 1`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PedTazed = 2`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PedShot = 3`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayfullyHit = 4`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMeleeThreatenedPed = 5`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerHitPedWithVehicle = 6`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMinorVehicleCrash = 7`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMediumVehicleCrash = 8`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType PlayerMajorVehicleCrash = 9`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType SuspectFleeStarted = 10`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType GunshotNearby = 11`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType ExplosionNearby = 12`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType VehicleThreatNearby = 13`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType NearbyPanic = 14`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType WitnessedViolence = 15`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType WitnessedDeath = 16`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexEventType WitnessedVehicleRamming = 17`

## `LosSantosAlive.NPC.Reflexes.ReflexReactionType`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType None = 0`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType PutHandsUp = 1`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType Flee = 2`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType WalkAway = 3`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType Chase = 4`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType Attack = 5`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexReactionType IntimidatePlayerWithWeapon = 6`

## `LosSantosAlive.NPC.Reflexes.ReflexRepeatMode`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexRepeatMode OnceEver = 0`
- `public static literal LosSantosAlive.NPC.Reflexes.ReflexRepeatMode Cooldown = 1`

## `LosSantosAlive.NPC.Reflexes.ReflexResult`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped Ped`
- `public Rage.Ped SourcePed`
- `public LosSantosAlive.NPC.Reflexes.ReflexEventType EventType`
- `public LosSantosAlive.NPC.Reflexes.ReflexReactionType ReactionType`
- `public bool ShouldStartGeminiSession`
- `public bool ShouldInterruptGeminiSession`
- `public string EventReason`
- `public string ReactionReason`

## `LosSantosAlive.NPC.Reflexes.ReflexSystem`
Kind: `static class`; extends `System.Object`.

**Fields/constants**
- `public static literal bool DebugDrawReflexLines = False`

**Methods**
- `public static LosSantosAlive.NPC.Reflexes.ReflexResult Trigger(Rage.Ped ped, Rage.Ped sourcePed, LosSantosAlive.NPC.Reflexes.ReflexEventType eventType, string eventReason)`

## `LosSantosAlive.NPC.Roles.NpcRoleManager`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void AssignRole(Rage.Ped ped, LosSantosAlive.NPC.Roles.NpcRoleType roleType)`
- `public static void AssignRole(LosSantosAlive.NPC.NpcState state, LosSantosAlive.NPC.Roles.NpcRoleType roleType)`
- `public static LosSantosAlive.NPC.Roles.NpcRoleProfile GetRoleProfile(LosSantosAlive.NPC.NpcState state)`
- `public static bool CanUseAction(LosSantosAlive.NPC.NpcState state, string normalizedActionName)`
- `public static string GetPromptContext(LosSantosAlive.NPC.NpcState state)`
- `public static string GetRoleName(LosSantosAlive.NPC.NpcState state)`
- `public static bool HasRole(LosSantosAlive.NPC.NpcState state, LosSantosAlive.NPC.Roles.NpcRoleType roleType)`
- `public static void ClearRole(LosSantosAlive.NPC.NpcState state)`

## `LosSantosAlive.NPC.Roles.NpcRoleProfile`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public LosSantosAlive.NPC.Roles.NpcRoleType RoleType`
- `public string RoleName`
- `public string PromptContext`
- `public System.Collections.Generic.HashSet`1<string> AllowedActions`

**Properties**
- `bool HasActionRestrictions { get; }`

**Methods**
- `public bool get_HasActionRestrictions()`
- `public bool AllowsAction(string normalizedActionName)`

## `LosSantosAlive.NPC.Roles.NpcRoleRegistry`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Register(LosSantosAlive.NPC.Roles.NpcRoleProfile profile)`
- `public static LosSantosAlive.NPC.Roles.NpcRoleProfile Get(LosSantosAlive.NPC.Roles.NpcRoleType roleType)`

## `LosSantosAlive.NPC.Roles.NpcRoleType`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType None = 0`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Civilian = 1`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Accomplice = 10`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType PoliceShowUnit = 20`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Negotiator = 21`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType SwatShowUnit = 22`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType StoreClerk = 30`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType TaxiDriver = 40`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType Paramedic = 50`
- `public static literal LosSantosAlive.NPC.Roles.NpcRoleType GangMember = 60`

## `LosSantosAlive.NPC.Targeting.NpcReferenceResolver`
Kind: `static class`; extends `System.Object`.

**Properties**
- `System.Func`2<Rage.Ped, Rage.Ped> CurrentSpeakerProvider { set; get; }`
- `System.Func`2<Rage.Ped, bool> ActiveLsaStateProvider { get; set; }`
- `System.Func`2<Rage.Ped, bool> ResponderProvider { set; get; }`

**Methods**
- `public static System.Func`2<Rage.Ped, Rage.Ped> get_CurrentSpeakerProvider()`
- `public static void set_CurrentSpeakerProvider(System.Func`2<Rage.Ped, Rage.Ped> value)`
- `public static System.Func`2<Rage.Ped, bool> get_ActiveLsaStateProvider()`
- `public static void set_ActiveLsaStateProvider(System.Func`2<Rage.Ped, bool> value)`
- `public static System.Func`2<Rage.Ped, bool> get_ResponderProvider()`
- `public static void set_ResponderProvider(System.Func`2<Rage.Ped, bool> value)`
- `public static ResolveResult Resolve(Rage.Ped sourcePed, string referenceText)`
- `public static ResolveResult Resolve(Rage.Ped sourcePed, string referenceText, float32 maxDistance)`
- `public static ResolveResult Resolve(Rage.Ped sourcePed, string referenceText, float32 maxDistance, bool useDirectionalBias)`
- `public static ResolveResult Resolve(Rage.Ped sourcePed, Rage.Ped currentSpeaker, string referenceText, float32 maxDistance, bool useDirectionalBias)`
- `public static Rage.Ped ResolvePedOrNull(Rage.Ped sourcePed, string referenceText)`

## `LosSantosAlive.NPC.Targeting.NpcReferenceResolver+ResolveResult`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Ped Ped`
- `public bool Success`
- `public float32 Confidence`
- `public string Reason`
- `public string NormalizedReference`

**Methods**
- `public virtual string ToString()`

## `LosSantosAlive.NPC.Targeting.VehicleTargetResolver`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static Result ResolveVehicle(string hint, Rage.Ped speaker, Rage.Ped currentTargetPed)`
- `public static Result ResolveVehicle(string hint, Rage.Ped speaker, Rage.Ped currentTargetPed, Options options)`

## `LosSantosAlive.NPC.Targeting.VehicleTargetResolver+Options`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public float32 MaxSearchDistance`
- `public float32 MinConfidence`
- `public System.Nullable`1<bool> RequireEmpty`
- `public System.Nullable`1<bool> RequireStationary`
- `public System.Nullable`1<bool> RequireFreeSeat`
- `public System.Nullable`1<bool> RequirePoliceVehicle`
- `public System.Nullable`1<bool> RequireCarLike`
- `public System.Nullable`1<bool> RequireTruckLike`
- `public System.Nullable`1<bool> RequireBikeLike`
- `public bool ExcludeSpeakerVehicleUnlessMentioned`
- `public bool PenalizePlayerVehicleUnlessMentioned`
- `public bool PreferPlayerCurrentVehicleWhenPlayerInside`
- `public bool ForcePlayerCurrentVehicleWhenPlayerInside`
- `public bool PreferEmpty`
- `public bool PreferStationary`
- `public bool PreferFreeSeat`
- `public System.Func`2<Rage.Vehicle, bool> CustomFilter`

## `LosSantosAlive.NPC.Targeting.VehicleTargetResolver+Result`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Vehicle Vehicle`
- `public float32 Confidence`
- `public string Reason`
- `public float32 MinConfidence`

**Properties**
- `bool Success { get; }`

**Methods**
- `public bool get_Success()`

## `LosSantosAlive.Scenes.HostageScenes.HostagePolicePositioning`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void PositionFirstPoliceSingle(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state, LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit unit)`
- `public static void PositionSecondPoliceTwo(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state, LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit unit)`
- `public static void PositionNegotiator(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state, LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit unit)`
- `public static void PositionSwat(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state, LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit unit)`

## `LosSantosAlive.Scenes.HostageScenes.HostagePoliceResponseController`
Kind: `static class`; extends `System.Object`.

**Properties**
- `bool HasActiveScene { get; }`
- `LosSantosAlive.Scenes.HostageScenes.HostageSceneState ActiveState { get; }`

**Methods**
- `public static bool get_HasActiveScene()`
- `public static LosSantosAlive.Scenes.HostageScenes.HostageSceneState get_ActiveState()`
- `public static bool TryStartForInterior(string interiorId)`
- `public static bool Start(LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static void Stop()`

## `LosSantosAlive.Scenes.HostageScenes.HostagePoliceStageType`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostagePoliceStageType FirstPoliceSingle = 0`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostagePoliceStageType SecondPoliceTwo = 1`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostagePoliceStageType ThirdNegotiator = 2`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostagePoliceStageType FourthSwat = 3`

## `LosSantosAlive.Scenes.HostageScenes.HostageResponseDriving`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void DriveParkThenRun(LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit unit, LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup stage, System.Action afterParked)`
- `public static void DriveParkThenRun(Rage.Vehicle vehicle, Rage.Ped driver, LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup stage, System.Action afterParked)`

## `LosSantosAlive.Scenes.HostageScenes.HostageSceneDatabase`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Register(LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static bool TryGet(string setupId, ref LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static bool TryGetForInterior(string interiorId, ref LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`
- `public static bool HasSetupForInterior(string interiorId)`
- `public static System.Collections.Generic.List`1<LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup> GetAll()`
- `public static void Clear()`

## `LosSantosAlive.Scenes.HostageScenes.HostageScenePhase`
Kind: `enum`; extends `System.Enum`.

**Fields/constants**
- `public int32 value__`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase None = 0`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase InitialResponse = 1`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase Negotiation = 2`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase TacticalContainment = 3`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase AssaultImminent = 4`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase AssaultActive = 5`
- `public static literal LosSantosAlive.Scenes.HostageScenes.HostageScenePhase Resolved = 6`

## `LosSantosAlive.Scenes.HostageScenes.HostageSceneRuntimeDirector`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void Update(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyNegotiatorArrived(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifySwatArrived(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyHostageReleased(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyCivilianKilled(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyOfficerKilled(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void NotifyShotsFired(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void RequestLowerWeapons(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void RequestHoldFire(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void RequestAssault(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`
- `public static void ResolveScene(LosSantosAlive.Scenes.HostageScenes.HostageSceneState state)`

## `LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public string SetupId`
- `public string InteriorId`
- `public bool HasDoorPoint`
- `public Rage.Vector3 DoorPoint`
- `public bool HasNegotiatorPoint`
- `public Rage.Vector3 NegotiatorPoint`
- `public float32 NegotiatorHeading`
- `public System.Collections.Generic.List`1<LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup> VehicleStages`
- `public System.Collections.Generic.List`1<LosSantosAlive.Scenes.HostageScenes.HostageSwatPointSetup> SwatPoints`

**Methods**
- `public bool IsValidForPoliceResponse()`

## `LosSantosAlive.Scenes.HostageScenes.HostageSceneState`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup Setup`
- `public string InteriorId`
- `public bool IsActive`
- `public LosSantosAlive.Scenes.HostageScenes.HostageScenePhase Phase`
- `public bool FirstRespondersArrived`
- `public bool NegotiatorArrived`
- `public bool SwatArrived`
- `public bool HelicopterArrived`
- `public bool SnipersArrived`
- `public int32 HostagesReleased`
- `public int32 CiviliansKilled`
- `public int32 OfficersKilled`
- `public uint32 SceneStartGameTime`
- `public uint32 LastEscalationGameTime`
- `public Rage.Ped NegotiatorPed`

**Methods**
- `public static LosSantosAlive.Scenes.HostageScenes.HostageSceneState FromSetup(LosSantosAlive.Scenes.HostageScenes.HostageSceneSetup setup)`

## `LosSantosAlive.Scenes.HostageScenes.HostageSceneTrigger`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static void SetCurrentInteriorIdProvider(System.Func`1<string> provider)`
- `public static void Update()`

## `LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Vehicle Vehicle`
- `public Rage.Ped Driver`
- `public Rage.Ped[] Peds`

## `LosSantosAlive.Scenes.HostageScenes.HostageSwatPointSetup`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public Rage.Vector3 Position`
- `public float32 Heading`
- `public bool HasAimPoint`
- `public Rage.Vector3 AimPoint`
- `public bool UseCrouch`
- `public bool UseCover`

## `LosSantosAlive.Scenes.HostageScenes.HostageVehicleSpawner`
Kind: `static class`; extends `System.Object`.

**Methods**
- `public static LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit SpawnFirstPoliceSingle(LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup stage)`
- `public static LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit SpawnSecondPoliceTwo(LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup stage)`
- `public static LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit SpawnNegotiator(LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup stage)`
- `public static LosSantosAlive.Scenes.HostageScenes.HostageSpawnedUnit SpawnSwat(LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup stage)`

## `LosSantosAlive.Scenes.HostageScenes.HostageVehicleStageSetup`
Kind: `class`; extends `System.Object`.

**Fields/constants**
- `public LosSantosAlive.Scenes.HostageScenes.HostagePoliceStageType Type`
- `public bool HasStartPoint`
- `public Rage.Vector3 StartPosition`
- `public float32 StartHeading`
- `public Rage.Vector3 ParkPosition`
- `public float32 ParkHeading`

## `LosSantosAlive.Tutorial.FirstRunTutorial`
Kind: `static class`; extends `System.Object`.

**Properties**
- `bool IsComplete { get; }`

**Methods**
- `public static bool get_IsComplete()`
- `public static void Update()`
- `public static void NotifyNormalTalkStarted(Rage.Ped ped)`
- `public static void NotifyPedMarked(Rage.Ped ped)`
- `public static void NotifyMarkedTalkStarted(Rage.Ped ped)`
- `public static void ResetForTesting()`
- `public static void Skip()`

---

# Appendix B — `LosSantosAlive.Interop.dll` readable API

## `LosSantosAlive.Interop.ContextMirror`
- method `public static void MirrorScenario(object entity, object scenario, object role)`
- method `public static void MirrorDetail(object entity, object detail)`
- method `public static void MirrorMood(object entity, object mood)`
- method `public static void MirrorRemove(object entity)`
- method `private static string GetEntityHandle(object entity)`
- method `private static string ToText(object value)`

## `LosSantosAlive.Interop.ExternalApiHooks`
- field `private static literal string ExternalAssemblyName = 'NPCAI_API'`
- field `private static literal string ExternalContextTypeName = 'NPCAI.API.NPCAIContext'`
- field `private static initonly string[] RequiredTargets`
- field `private static initonly object Sync`
- field `private static initonly System.Collections.Generic.HashSet`1<System.Reflection.MethodBase> PatchedMethods`
- field `private static initonly System.Collections.Generic.HashSet`1<string> PatchedTargets`
- field `private static bool _reportedReady`
- field `private static bool _reportedFingerprint`
- property `bool HasAnyHooks { get; }`
- method `public static bool get_HasAnyHooks()`
- method `public static bool TryInstall(HarmonyLib.Harmony harmony, System.Reflection.Assembly candidateAssembly, ref bool externalApiPresent)`
- method `public static void ResetState()`
- method `private static System.Reflection.Assembly ResolveExternalAssembly(System.Reflection.Assembly candidateAssembly)`
- method `private static bool IsExternalAssembly(System.Reflection.Assembly assembly)`
- method `private static int32 PatchMethods(HarmonyLib.Harmony harmony, System.Type contextType, string methodName, int32 parameterCount, System.Reflection.MethodInfo prefix)`
- method `private static System.Reflection.MethodInfo GetPatchMethod(string name)`
- method `private static bool ScenarioPrefix(object[] __args)`
- method `private static bool DetailPrefix(object[] __args)`
- method `private static bool MoodPrefix(object[] __args)`
- method `private static bool RemovePrefix(object[] __args)`
- method `private static bool AreRequiredTargetsPatchedNoLock()`
- method `private static void ReportExternalAssemblyFingerprint(System.Reflection.Assembly assembly)`
- method `private static string SafeAssemblyName(System.Reflection.Assembly assembly)`
- method `private static string SafeAssemblyFullName(System.Reflection.Assembly assembly)`
- method `private static string SafeAssemblyLocation(System.Reflection.Assembly assembly)`
- method `private static string SafeAppDomainName()`
- method `private static string SafeMethod(System.Reflection.MethodBase method)`

## `LosSantosAlive.Interop.InteropBootstrap`
- field `private static literal string HarmonyId = 'com.lossantosalive.interop'`
- field `private static literal string BuildTag = '2026.08.16-interop-hotfix-2'`
- field `private static literal int32 FirstProbeDelayMs = 250`
- field `private static literal int32 MissingApiRetryDelayMs = 750`
- field `private static literal int32 PresentApiRetryDelayMs = 1000`
- field `private static literal int32 MaxMissingApiProbes = 60`
- field `private static literal int32 MaxPresentApiFailures = 3`
- field `private static initonly object Sync`
- field `private static initonly object InstallGate`
- field `private static HarmonyLib.Harmony _harmony`
- field `private static bool _initialized`
- field `private static bool _shutdownRequested`
- field `private static bool _hooksReady`
- field `private static bool _circuitBroken`
- field `private static int32 _installWorkerRunning`
- method `public static void Initialize()`
- method `public static void Shutdown()`
- method `private static void StartInstallWorker()`
- method `private static void InstallWorkerLoop()`
- method `internal static void Log(string message)`

## `LosSantosAlive.Interop.LsaInteropTransport`
- field `private static literal string PipeName = 'LosSantosAlive_Interop'`
- field `private static literal int32 ConnectTimeoutMs = 250`
- field `private static literal int32 RetryDelayMs = 500`
- field `private static literal int32 MaxQueuedMessages = 4096`
- field `private static initonly System.Collections.Concurrent.ConcurrentQueue`1<string> Queue`
- field `private static initonly System.Threading.AutoResetEvent WakeSignal`
- field `private static initonly object StartSync`
- field `private static System.Threading.Thread _worker`
- field `private static bool _started`
- field `private static ET_1f _stopping`
- field `private static int32 _queuedCount`
- method `public static void SendScenario(string entityHandle, string scenario, string role)`
- method `public static void SendDetail(string entityHandle, string detail)`
- method `public static void SendMood(string entityHandle, string mood)`
- method `public static void SendRemove(string entityHandle)`
- method `public static void Stop()`
- method `private static void Enqueue(string message)`
- method `private static void EnsureStarted()`
- method `private static void WorkerLoop()`
- method `private static string CleanHandle(string value)`
- method `private static string Encode(string value)`

## `LosSantosAlive.Interop.Main`
- field `private static literal string BuildTag = '2026.08.16-interop-hotfix-2'`
- field `private static literal int32 InitialBootstrapDelayMs = 2000`
- field `private static literal int32 ReinitializeDelayMs = 750`
- field `private static int32 _bootstrapScheduled`
- field `private static ET_1f _shuttingDown`
- method `public virtual void Initialize()`
- method `public virtual void InitializeAgain()`
- method `public virtual void Finally()`
- method `private static void ScheduleBootstrap(string reason, int32 delayMs)`

## `LosSantosAlive.Interop.Main+<>c__DisplayClass8_0`
- field `public string reason`
- field `public int32 delayMs`

Readable strings in this bridge identify optional compatibility targets `NPCAI_API` / `NPCAI.API.NPCAIContext` and operations corresponding to scenario, detail, mood and remove. The adapter is therefore best understood as a legacy/external context mirror, not the central LSA addon API.

---

# Appendix C — `LosSantosAlive.PRBridge.dll` readable API

PRBridge is considerably more obfuscated than the main public integration surface, but the readable symbols are included for discovery. Use the main `PolicingRedefinedBridge` classes in `LosSantosAlive.dll` first.

## `ConfusedByAttribute`

## `LosSantosAlive.PRBridge.LspdfrCalloutBridgeStore`
- method `public static string HandleSetCallout(string json)`
- method `public static string HandleGetCallout()`
- method `public static string HandleAcceptCallout(string calloutId)`
- method `public static string HandleDeclineCallout(string calloutId)`
- method `public static string HandleEndCallout(string calloutId)`
- method `public static string HandleGetStatus()`

## `LosSantosAlive.PRBridge.LspdfrDynamicDisturbanceCallout`
- method `public virtual bool OnBeforeCalloutDisplayed()`
- method `public virtual bool OnCalloutAccepted()`
- method `public virtual void Process()`
- method `public virtual void End()`

## `LosSantosAlive.PRBridge.Main`
- method `public virtual void Initialize()`
- method `public virtual void InitializeAgain()`
- method `public virtual void Finally()`

## `LosSantosAlive.PRBridge.PedCheckRequestHandler`
- method `public static bool TryQueue(string requestId, string officerHandle, string targetHandle, Rage.Ped targetPed, string personName, System.Action`1<string> onCompleted)`

## `LosSantosAlive.PRBridge.PrArrestInvoker`
- method `public static bool TryArrest(Rage.Ped officer, Rage.Ped suspect, bool frontCuffs, ref string error)`

## `LosSantosAlive.PRBridge.PrBackupInvoker`
- method `public static bool TryRequestBackup(string requestText, ref string error)`

## `LosSantosAlive.PRBridge.PrBackupInvoker+BackupKind`
- field `public int32 value__`
- field `public static literal BackupKind Patrol = 0`
- field `public static literal BackupKind StatePatrol = 1`
- field `public static literal BackupKind FemalePatrol = 2`
- field `public static literal BackupKind StateFemalePatrol = 3`
- field `public static literal BackupKind K9 = 4`
- field `public static literal BackupKind StateK9 = 5`
- field `public static literal BackupKind SWAT = 6`
- field `public static literal BackupKind NOOSE = 7`
- field `public static literal BackupKind EMS = 8`
- field `public static literal BackupKind Fire = 9`
- field `public static literal BackupKind Coroner = 10`
- field `public static literal BackupKind AnimalControl = 11`
- field `public static literal BackupKind PoliceTransport = 12`
- field `public static literal BackupKind Panic = 13`
- field `public static literal BackupKind Group = 14`
- field `public static literal BackupKind OfficerDown = 15`
- field `public static literal BackupKind Pursuit = 16`
- field `public static literal BackupKind AirPursuit = 17`
- field `public static literal BackupKind NooseAirPursuit = 18`
- field `public static literal BackupKind SpikeStrips = 19`

## `LosSantosAlive.PRBridge.PrBackupInvoker+ResponseCode`
- field `public int32 value__`
- field `public static literal ResponseCode Code1 = 0`
- field `public static literal ResponseCode Code2 = 1`
- field `public static literal ResponseCode Code3 = 2`

## `LosSantosAlive.PRBridge.PrCalloutPedHydrator`
- method `public static bool TryHydrate(Rage.Ped ped, string json, ref string error)`

## `LosSantosAlive.PRBridge.PrDataExtractor`
- method `public static bool TryBuildPedRecordJson(Rage.Ped ped, ref string json, bool includeNexusMdt)`
- method `public static bool TryBuildVehicleRecordJson(Rage.Vehicle vehicle, ref string json)`

## `LosSantosAlive.PRBridge.PrDismissInvoker`
- method `public static bool TryDismiss(Rage.Ped suspect, ref string error)`

## `LosSantosAlive.PRBridge.PrDocumentHandoffBuilder`
- method `public static bool IsSupportedCommand(string command)`
- method `public static bool TryBuild(string command, Rage.Ped giver, Rage.Ped recipient, ref string json, ref string error)`

## `LosSantosAlive.PRBridge.PrLsaControlInvoker`
- method `public static bool TrySetControlledByLsa(Rage.Ped ped, bool controlledByLsa, ref string error)`

## `LosSantosAlive.PRBridge.PrNamedPipeServer`
- method `public static void Start()`
- method `public static void Stop()`

## `LosSantosAlive.PRBridge.PrSearchInvoker`
- method `public static bool TrySearch(Rage.Ped officer, Rage.Ped suspect, ref string error)`

## `LosSantosAlive.PRBridge.PrStateTracker`
- method `public static void Initialize()`
- method `public static void Shutdown()`
- method `public static bool IsStopped(Rage.Ped ped)`
- method `public static bool IsArrested(Rage.Ped ped)`
- method `public static bool IsPatDown(Rage.Ped ped)`
- method `public static bool IsSurrendered(Rage.Ped ped)`
- method `public static string GetLastIdentification(Rage.Ped ped)`
- method `public static string BuildPedStateJson(Rage.Ped ped)`

## `LosSantosAlive.PRBridge.PrSuspectCommandInvoker`
- method `public static bool WarmUp()`
- method `public static bool TryExecute(string command, Rage.Ped officer, Rage.Ped suspect, ref string error)`
- method `public static bool TryExecute(string command, Rage.Ped officer, Rage.Ped suspect, ref string handoffJson, ref string error)`
- method `public static bool IsGiveInformationCommand(string command)`

## `LosSantosAlive.PRBridge.VehicleCheckRequestHandler`
- method `public static bool TryQueue(string requestId, string officerHandle, string vehicleHandle, Rage.Vehicle vehicle, string requestedPlate, System.Action`1<string> onCompleted)`

---

# Appendix D — source/evidence map

| Claim family | Primary evidence |
|---|---|
| Type/method/field/property/event signatures | CLR metadata from `LosSantosAlive.dll`, `LosSantosAlive.Interop.dll`, `LosSantosAlive.PRBridge.dll` |
| Integration/action execution relationship | IL call flow for readable manager/registry methods + metadata |
| Server message names / model / audio rates / port | Shipped `server.bundle.mjs` and `config/constants.js` |
| User config | Shipped `plugins/LosSantosAlive/LosSantosAlive.config` |
| Existing normalized action vocabulary | Shipped server bundle |
| “stable/brittle” labels | Engineering assessment based on exposed public registry/manager/event design vs private/transport coupling |

## Bottom line
Hotfix #3 already contains enough structured extension surface that we **do not need to fork or recreate Los Santos Alive** to build meaningful enhancements. The most defensible path is to treat LSA as an actor runtime: register an integration, add actions, enrich context, coordinate through `NpcState`, observe real playback/interaction lifecycle, and use the special-turn/reflex/content registries where appropriate. Raw transport or Harmony against obfuscated internals should remain fallback tools.