# Focused P2 native seams

October 2, 2026. This investigation is limited to the P2 owner/recreation/control path. Primary local evidence is the currently pinned Essential DLL, its metadata/IL and the existing compile-only RPH SDK. No live game was inspected.

| Evidence | Pin / result |
| --- | --- |
| Essential Hotfix #3 `LosSantosAlive.dll` | SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| RPH compile-only SDK | SHA-256 `5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0` |
| Public P1 integration contract | Existing independently pinned `IIntegration`, `IntegrationManager.Register`, `IntegrationJsonBlock` evidence; unchanged |
| Focused P2 public metadata | [Machine-readable signatures](../lsa-essential-e1-candidate/docs/promoted-characters-native-metadata.json); emitted from the pinned DLL using `native-metadata --characters` |

## Concrete existing Essential APIs

| Used seam | Direct evidence / purpose |
| --- | --- |
| `NpcTargeting.GetPlayerConversationPed()` / `GetCurrentSpeakerPed()` | Public pinned methods `0x0600047b` / `0x06000480`; current explicitly selected/conversation target, without nearest/fuzzy fallback |
| `ActorContextProvider.Populate(ActorContext, Ped)` | Public method `0x060012b8`; synchronous core model demographics/archetype/role capture, followed by integration enrichment |
| `NpcActions.FollowTarget(Ped)` / `WaitHere(Ped)` | Public methods `0x0600025a` / `0x0600025c`; reuse native actions instead of implementing a competing TASK scheduler |
| `NpcFocus.SetFocus(Ped, Ped, string)` | Public typed focus seam; explicit follow targets the player |
| `NpcStateStore.TryGetState(Ped)` / `GetStateForActiveBehavior(Ped)` | Public state seam; persistent companion mode lives in the existing native behavior stack |
| `NpcState.EnterPassengerSeatWhenPlayerEnters`, `ExitVehicleWhenPlayerExits` | Public Boolean fields; pinned `VehicleBehavior.Update` (`0x06000950`) reads both flags in its IL |
| `FollowPlayerOnFoot`, `FollowPaused`, `StayUnderLsaControl`, `InDirectedInteraction`, `AccompliceMode`, `DemoteToPassiveRuntime()` | Public native behavior/state flags and demotion; suspend P2 without issuing Rockstar task replacements; keep offensive accomplice mode off |
| `NpcActions.HasExclusiveControl(Ped)` | Public method `0x060002e7`; adopted persistent/mission entity needs existing native LSA control |
| `ReleaseExclusiveControlForExternalSystem(Ped, string, bool)` | Public method `0x060002ec`; its pinned IL clears native follow/destination/vehicle flags, demotes state, notifies integration control change, and includes `Rage.TaskInvoker.Clear`. Therefore P2 invokes it only on an explicit safe dismissal, never during guarded scripted suspension |
| `SessionIdentityIntegration.Owner.Register/Retire/TryResolveCurrent` | Existing production P1 authored owner roster and separate current-user factual pipe; no replacement identity store or fake session nonce |

The symbols are statically established; follower routing, native state callbacks/cadence and physical task outcomes remain GTA acceptance items.

## RAGE spawning and variation APIs

The compile-only SDK XML and a successful real-reference `net481` build establish `Ped(Model, Vector3, float)`, `Model.IsValid/IsPed/Hash`, `Entity.Exists/MemoryAddress/IsPersistent/Delete/Dismiss`, `GetOffsetPosition`, `World.GetGroundZ(Vector3, bool, bool)`, `Game.LocalPlayer`, and generic `NativeFunction.CallByName<T>`.

The RPH project's [ped constructor documentation](https://docs.ragepluginhook.net/html/M_Rage_Ped__ctor_1.htm) independently describes model/position/heading creation. Its [ped methods](https://docs.ragepluginhook.net/html/Methods_T_Rage_Ped.htm) describe explicit deletion and persistence dismissal. The shipped SDK reference, rather than the age of that web documentation, determines compilation compatibility.

The same pinned SDK XML exposes `Game.AddConsoleCommands(System.Reflection.MethodInfo[])` and writable `ConsoleCommandAttribute.Name/Description`. P2 registers explicitly named static console inputs through those existing APIs. Their worker performs bounded loopback HTTP only; all native ped work remains in Essential Update. Actual console registration/focus behavior is a GTA check.

Standard model-relative appearance uses the native [component variation contract](https://github.com/citizenfx/natives/blob/master/PED/SetPedComponentVariation.md), [drawable read contract](https://github.com/citizenfx/natives/blob/master/PED/GetPedDrawableVariation.md), [variation count](https://github.com/citizenfx/natives/blob/master/PED/GetNumberOfPedDrawableVariations.md), and [prop contract](https://github.com/citizenfx/natives/blob/master/PED/SetPedPropIndex.md). Capture stores only supported standard slots and indexes; model parts reporting zero writable variations are omitted. Restore verifies drawable/texture availability for the actual recreated model before calling setters. These GTA native names are runtime-resolved by RPH; successful compilation does not validate their dispatch/visual fidelity in the installed Enhanced runtime.

Player controls guard `IS_CUTSCENE_ACTIVE`, `IS_CUTSCENE_PLAYING`, `IS_PLAYER_SWITCH_IN_PROGRESS`, `GET_MISSION_FLAG`, `NETWORK_IS_SESSION_ACTIVE`, `IS_ENTITY_A_MISSION_ENTITY` and `DOES_ENTITY_BELONG_TO_THIS_SCRIPT`. The native [mission-entity ownership contract](https://github.com/citizenfx/natives/blob/master/ENTITY/SetEntityAsMissionEntity.md) distinguishes protection from script ownership. P2 never steals mission entities with a grab-from-other-script call. P2 does not infer authored identity from those flags; only explicit P1 ownership can identify a durable person.

During a guarded state P2 updates only its existing behavior flags/demotion, without TASK, teleport, deletion or task clearing. Existing owned peds are never teleported on summon. A new ped is created only while the player is alive/on foot/outdoors/on supported ground; expiration/script state are rechecked after the constructor's possible model-loading yield. Unsupported spawn/variation calls throw into bounded optional failure, leaving P1/profile data intact.

## Evidence-based limits

There is no safely implemented exact freemode head blend/face/overlay/tattoo/third-party customization export/import in this pinned seam. P2 preserves standard components/props and model and documents the fidelity gap. It does not restore inventory/health or infer unique people from appearance.

The selected nearby ground test is conservative but does not prove obstacle-free, interior, traffic or mission choreography safety. Physical acceptance must verify it. GTA script ownership also does not distinguish every addon sharing RPH's script context. No universal Rockstar-vs-third-party task-owner proof, scene observation or mission participation is claimed. P2 defers commands and suspends optional behavior; later PERCEPTION/SCENE_DIRECTOR work can coordinate richer reactions only with demonstrated native authority.
