using System;
using System.Collections.Generic;
using System.Linq;
using LSA.Activities;
using LosSantosAlive.NPC;
using LosSantosAlive.NPC.Behaviors;
using LosSantosAlive.NPC.Memory;
using Rage;
using Rage.Native;

namespace LSA.PromotedCharacters
{
    public sealed partial class PromotedCharactersIntegration
    {
        partial void BindActivityWorld(StepRunner runner) { runner.Bind(new EssentialActivityWorld(this)); }

        // Essential's only native completion event. It is pushed as a bounded callback record and consumed on the owner fiber.
        partial void AttachActivityEvents() { MovementBehavior.ApproachFinished += OnEssentialApproachFinished; }
        partial void DetachActivityEvents() { MovementBehavior.ApproachFinished -= OnEssentialApproachFinished; }
        void OnEssentialApproachFinished(Ped actor, Ped target, bool ok, string reason) { PushApproachFinished(actor, target, ok, reason); }

        // ACT2/ACT3 use Essential queue/stop APIs. ACT6 is an ACT-owned, gated native extension:
        // actual GTA navigation tasks, never a second activity scheduler or free-form command.
        sealed class EssentialActivityWorld : IActivityWorld
        {
            sealed class SeatMemory { public bool Enter, Exit, Stay; }
            // Evidence for the ACT runner's single current step; not a task controller.
            sealed class NavMemory {
                public string PlaceRef, Capability;
                public ulong PedHandle, VehicleHandle;
                public IntPtr PedAddress, VehicleAddress;
                public float InitialDistance, BestDistance, MovedMeters;
                public Vector3 LastPosition;
                public uint IssuedAt, LastProgressAt, LastSampleAt;
                public bool Progress, TaskSeen;
                public int ArrivalSamples;
            }
            static readonly Dictionary<string, Vector3> Landmarks = new Dictionary<string, Vector3>(StringComparer.OrdinalIgnoreCase) {
                {"los santos international airport", new Vector3(-1037f,-2738f,13.75f)},
                {"lsia", new Vector3(-1037f,-2738f,13.75f)},
                {"airport", new Vector3(-1037f,-2738f,13.75f)},
                {"del perro pier", new Vector3(-1847f,-1225f,13f)},
                {"vespucci beach", new Vector3(-1394f,-1022f,5f)},
                {"sandy shores airfield", new Vector3(1732f,3297f,41f)},
                {"paleto bay", new Vector3(-100f,6400f,31f)}
            };
            // Capabilities this binding executes through Essential and can verify from a named state read.
            // follow_vehicle, give_item, take_item, scenario_at and every extension row stay out on purpose.
            static readonly HashSet<string> Implemented = new HashSet<string> { "stop_and_face", "approach_person", "walk_away_from", "exit_vehicle", "begin_driving", "take_cover", "enter_vehicle_seat", "scenario_here", "grab_item", "clear_held_item", "walk_to", "drive_to" };
            public bool Supports(string capability) => capability != null && Implemented.Contains(capability);
            readonly PromotedCharactersIntegration host;
            // Entity references live exclusively in host.Host.Anchors.
            readonly Dictionary<string, string> own = new Dictionary<string, string>();
            readonly Dictionary<string, SeatMemory> seats = new Dictionary<string, SeatMemory>();
            readonly Dictionary<string, NavMemory> navigation = new Dictionary<string, NavMemory>();
            public EssentialActivityWorld(PromotedCharactersIntegration host) { this.host = host; }
            public uint GameTime => unchecked((uint)Game.GameTime);

            public bool TryAcquire(string ownerAlias, string ownershipToken, out string encounterId, out string incarnationId, out string reason)
            {
                encounterId = incarnationId = null; reason = "actor_not_owned";
                var encounter = host.encounters.Values.FirstOrDefault(item => item.OwnerAlias == ownerAlias && item.OwnershipToken == ownershipToken && item.Registration != null);
                if (encounter == null || encounter.Ped == null) return false;
                if (!PromotedCharactersIntegration.SameIncarnation(encounter)) { reason = "actor_retired"; return false; }
                encounterId = encounter.Id; incarnationId = encounter.Registration.IncarnationId; reason = null; return true;
            }
            public bool SameIncarnation(string encounterId, string incarnationId)
            {
                var encounter = Find(encounterId);
                return encounter != null && encounter.Registration != null && encounter.Registration.IncarnationId == incarnationId && PromotedCharactersIntegration.SameIncarnation(encounter);
            }
            public AnchorResult Resolve(string encounterId, string role, string slotKind)
            {
                var encounter = Find(encounterId);
                if (encounter == null) return new AnchorResult { Reason = "actor_unavailable" };
                if (slotKind == "player") {
                    var player = Game.LocalPlayer.Character;
                    if (player == null || !player.Exists() || player.MemoryAddress == IntPtr.Zero) return new AnchorResult { Reason = "target_invalid" };
                    try { if (NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS")) return new AnchorResult { Reason = "target_invalid" }; } catch { return new AnchorResult { Reason = "target_invalid" }; }
                    var handle=Convert.ToUInt64(player.Handle);var address=player.MemoryAddress;
                    var anchor=host.Host.Anchors.Retain(player,handle,address,"player",null,
                        ()=>player.Exists() && Convert.ToUInt64(player.Handle)==handle && player.MemoryAddress==address,
                        host.Host.MonotonicMs,false,LSA.Intelligence.AnchorConsumer.ActTarget);
                    if(anchor==null) return new AnchorResult { Reason = "budget_exhausted" };
                    return new AnchorResult { Ok = true, Ref = anchor.CaptureRef, SlotKind = "player", Band = Distance(encounter.Ped, player), Label = null };
                }
                if (slotKind == "player_vehicle") {
                    var player = Game.LocalPlayer.Character;
                    if (player == null || !player.Exists()) return new AnchorResult { Reason = "vehicle_invalid" };
                    Vehicle vehicle = null;
                    try { vehicle = player.IsInAnyVehicle(false) ? player.CurrentVehicle : player.LastVehicle; } catch { }
                    if (vehicle == null || !vehicle.Exists() || vehicle.MemoryAddress == IntPtr.Zero || !vehicle.IsAlive) return new AnchorResult { Reason = "vehicle_invalid" };
                    var vehicleHandle = Convert.ToUInt64(vehicle.Handle); var vehicleAddress = vehicle.MemoryAddress;
                    var held = host.Host.Anchors.Retain(vehicle, vehicleHandle, vehicleAddress, "vehicle", null,
                        () => vehicle.Exists() && Convert.ToUInt64(vehicle.Handle) == vehicleHandle && vehicle.MemoryAddress == vehicleAddress && vehicle.IsAlive,
                        host.Host.MonotonicMs, false, LSA.Intelligence.AnchorConsumer.ActTarget);
                    if (held == null) return new AnchorResult { Reason = "budget_exhausted" };
                    return new AnchorResult { Ok = true, Ref = held.CaptureRef, SlotKind = "player_vehicle", Band = PlaceTable.Band(encounter.Ped.Position.X - vehicle.Position.X, encounter.Ped.Position.Y - vehicle.Position.Y, encounter.Ped.Position.Z - vehicle.Position.Z), Label = null };
                }
                if (slotKind == "here") {
                    var position = encounter.Ped.Position;
                    return new AnchorResult { Ok = true, Ref = Guid.NewGuid().ToString("D"), SlotKind = "here", Band = "at", Label = "here", X = position.X, Y = position.Y, Z = position.Z };
                }
                if (slotKind == "waypoint" || slotKind == "near_player" || slotKind != null && slotKind.StartsWith("named:", StringComparison.Ordinal)) {
                    Vector3 destination; string label; string resolvedKind;
                    if (slotKind == "waypoint") {
                        // Sprite 8 is the player's real map waypoint. No client/model coordinate is accepted.
                        try {
                            var blip = NativeFunction.CallByName<int>("GET_FIRST_BLIP_INFO_ID", 8);
                            if (blip == 0 || !NativeFunction.CallByName<bool>("DOES_BLIP_EXIST", blip))
                                return new AnchorResult { Reason = "place_unresolved" };
                            destination = NativeFunction.CallByName<Vector3>("GET_BLIP_INFO_ID_COORD", blip);
                            // Waypoint blips often supply Z=0. Refuse an unsampled surface rather than invent height.
                            if (Math.Abs(destination.Z) < 0.01f) {
                                float? ground = World.GetGroundZ(new Vector3(destination.X,destination.Y,1000f),false,true);
                                if (!ground.HasValue) return new AnchorResult { Reason = "place_unresolved" };
                                destination.Z = ground.Value;
                            }
                        } catch { return new AnchorResult { Reason = "place_unresolved" }; }
                        label = "Player waypoint"; resolvedKind = "waypoint";
                    } else if (slotKind == "near_player") {
                        var player = Game.LocalPlayer.Character;
                        if (player == null || !player.Exists()) return new AnchorResult { Reason = "target_invalid" };
                        destination = player.GetOffsetPosition(new Vector3(3f,3f,0f));
                        label = "Near player"; resolvedKind = "near_player";
                    } else {
                        var query = slotKind.Substring("named:".Length).Trim();
                        if (!Landmarks.TryGetValue(query, out destination))
                            return new AnchorResult { Reason = "place_unresolved" };
                        label = query; resolvedKind = "named";
                    }
                    if (!ValidPlace(destination)) return new AnchorResult { Reason = "place_unresolved" };
                    var actorPos = encounter.Ped.Position;
                    return new AnchorResult { Ok = true, Ref = Guid.NewGuid().ToString("D"), SlotKind = resolvedKind, Label = label,
                        Band = PlaceTable.Band(actorPos.X-destination.X,actorPos.Y-destination.Y,actorPos.Z-destination.Z),
                        X = destination.X, Y = destination.Y, Z = destination.Z };
                }
                return new AnchorResult { Reason = "place_unsupported" };
            }
            static bool ValidPlace(Vector3 value) =>
                !float.IsNaN(value.X) && !float.IsNaN(value.Y) && !float.IsNaN(value.Z) &&
                !float.IsInfinity(value.X) && !float.IsInfinity(value.Y) && !float.IsInfinity(value.Z) &&
                Math.Abs(value.X) < 9000 && Math.Abs(value.Y) < 9000 && value.Z > -150 && value.Z < 2500;
            static float FlatDistance(Vector3 a, Vector3 b) {
                var dx = a.X-b.X; var dy = a.Y-b.Y; return (float)Math.Sqrt(dx*dx + dy*dy);
            }
            static float Distance3(Vector3 a, Vector3 b) {
                var dx=a.X-b.X;var dy=a.Y-b.Y;var dz=a.Z-b.Z;
                return (float)Math.Sqrt(dx*dx+dy*dy+dz*dz);
            }
            // GTA script-task hash, not the native invocation hash.
            static int NavTaskHash(string capability) =>
                capability=="walk_to"?unchecked((int)0x2A89B8A7u):unchecked((int)0x21D33957u);
            static int NavStatus(Ped ped,string capability) =>
                NativeFunction.CallByName<int>("GET_SCRIPT_TASK_STATUS",ped,NavTaskHash(capability));
            // Resolve a native street node close to the requested destination.
            // Never drive directly to landmark coordinates off the road.
            static bool RoadTarget(StepArgs args) {
                if (args==null || !args.HasPlace) return false;
                var original=new Vector3(args.PlaceTarget.X,args.PlaceTarget.Y,args.PlaceTarget.Z);
                try {
                    var road=World.GetNextPositionOnStreet(original);
                    if (!ValidPlace(road) || FlatDistance(original,road)>85f ||
                        Math.Abs(original.Z-road.Z)>20f ||
                        !NativeFunction.CallByName<bool>("IS_POINT_ON_ROAD",road.X,road.Y,road.Z,0)) return false;
                    var target=args.PlaceTarget;target.X=road.X;target.Y=road.Y;target.Z=road.Z;
                    args.PlaceTarget=target;return true;
                } catch { return false; }
            }
            public PreflightResult Preflight(string encounterId, string capability, StepArgs args)
            {
                var sample = Sample(encounterId, args);
                if (!sample.Alive || sample.Dead) return new PreflightResult { Reason = "actor_dead" };
                if (sample.Injured) return new PreflightResult { Reason = "actor_injured" };
                if (sample.Scripted) return new PreflightResult { Reason = "scripted_state" };
                if (sample.Directed) return new PreflightResult { Reason = "directed_interaction" };
                if (sample.Reflex) return new PreflightResult { Reason = "reflex_active" };
                if (capability == "sit_on_ground" && sample.InVehicle) return new PreflightResult { Reason = "on_foot_required" };
                if (capability == "hold_position" && sample.FollowPaused && !sample.FollowOnFoot) return new PreflightResult { Already = true };
                if (capability == "follow_person" && sample.FollowOnFoot && sample.TargetSame) return new PreflightResult { Already = true };
                if (capability == "sit_on_ground" && sample.SitOnGround) return new PreflightResult { Already = true };
                if (capability == "stop_and_face" || capability == "approach_person" || capability == "walk_away_from") {
                    if (sample.InVehicle) return new PreflightResult { Reason = "on_foot_required" };
                    if (sample.TargetDistance < 0) return new PreflightResult { Reason = "target_retired" };
                    if (capability == "stop_and_face" && sample.TargetDistance > 50f) return new PreflightResult { Reason = "target_out_of_range" };
                    if (capability == "approach_person" && sample.TargetDistance > 100f) return new PreflightResult { Reason = "target_out_of_range" };
                    if (capability == "stop_and_face" && sample.StopFaceMode && sample.StopFaceSame && sample.Facing) return new PreflightResult { Already = true };
                    if (capability == "approach_person" && sample.TargetDistance <= CompletionAdapters.ApproachArrivedMeters) return new PreflightResult { Already = true };
                    if (capability == "walk_away_from" && sample.TargetDistance >= CompletionAdapters.WalkAwayCompleteMeters) return new PreflightResult { Already = true };
                }
                if (capability == "exit_vehicle" && !sample.InVehicle) return new PreflightResult { Already = true };
                if (capability == "walk_to" || capability == "drive_to") {
                    if (args == null || !args.HasPlace || !ValidPlace(new Vector3(args.PlaceTarget.X,args.PlaceTarget.Y,args.PlaceTarget.Z)))
                        return new PreflightResult { Reason = "place_unresolved" };
                    if (capability == "walk_to" && sample.InVehicle) return new PreflightResult { Reason = "on_foot_required" };
                    if (capability == "drive_to") {
                        if (!sample.InVehicle || !sample.IsDriver) return new PreflightResult { Reason = "driver_required" };
                        if (!RoadTarget(args)) return new PreflightResult { Reason = "navigation_failed" };
                    }
                    // A nearby NPC is not a completed navigation. Require a real task and observed movement.
                    var destination = new Vector3(args.PlaceTarget.X,args.PlaceTarget.Y,args.PlaceTarget.Z);
                    if (Distance3(Find(encounterId).Ped.Position,destination) <= (capability == "walk_to" ? 3f : 8f))
                        return new PreflightResult { Reason = "already_satisfied" };
                }
                if (capability == "begin_driving") {
                    if (!sample.InVehicle) return new PreflightResult { Reason = "in_vehicle_required" };
                    if (!sample.IsDriver) return new PreflightResult { Reason = "driver_required" };
                }
                if (capability == "take_cover" && sample.CoverMode) return new PreflightResult { Already = true };
                if (capability == "enter_vehicle_seat") {
                    var vehicle = host.Host.Anchors.Resolve(args?.Vehicle)?.Entity as Vehicle;
                    if (vehicle == null || !vehicle.Exists() || !vehicle.IsAlive) return new PreflightResult { Reason = "vehicle_invalid" };
                    if (sample.InVehicle && sample.VehicleIsAnchor && SeatMatches(sample, args.Seat)) return new PreflightResult { Already = true };
                    if (sample.InVehicle) return new PreflightResult { Reason = "state_blocked" };
                    if (vehicle.Speed >= 1.0f) return new PreflightResult { Reason = "vehicle_moving" };
                    if (!SeatFree(vehicle, args.Seat)) return new PreflightResult { Reason = "seat_occupied" };
                }
                if (capability == "scenario_here") {
                    if (sample.InVehicle) return new PreflightResult { Reason = "on_foot_required" };
                    // UseScenario bypasses the executor and does not clear these, so ACT will not start over them.
                    if (BlocksScenario(encounterId)) return new PreflightResult { Reason = "state_blocked" };
                    if (sample.ScenarioActive) return new PreflightResult { Already = true };
                }
                if (capability == "grab_item" && sample.HoldingItem && sample.HeldItemName == args?.ItemName) return new PreflightResult { Already = true };
                if (capability == "clear_held_item" && !sample.HoldingItem) return new PreflightResult { Already = true };
                return new PreflightResult { Ok = true };
            }
            static bool SeatMatches(ModeSample sample, string seat) => seat == "driver" ? sample.IsDriver : seat == "passenger" ? sample.SeatIndex == 0 : seat == "rear" ? sample.SeatIndex >= 1 : seat == "any_passenger" && sample.SeatIndex >= 0 && !sample.IsDriver;
            static bool SeatFree(Vehicle vehicle, string seat)
            {
                var indexes = seat == "driver" ? new[] { -1 } : seat == "passenger" ? new[] { 0 } : seat == "rear" ? new[] { 1, 2 } : new[] { 0, 1, 2 };
                try { foreach (var index in indexes) if (NativeFunction.CallByName<bool>("IS_VEHICLE_SEAT_FREE", vehicle, index, false)) return true; } catch { }
                return false;
            }
            bool BlocksScenario(string encounterId)
            {
                var encounter = Find(encounterId);
                if (encounter?.Ped == null) return true;
                try {
                    var state = NpcStateStore.TryGetState(encounter.Ped);
                    if (state == null) return true;
                    return state.TakeCoverMode || state.EnterDriverSeatWhenPlayerVehicleNearby || state.EnterPassengerSeatWhenPlayerVehicleNearby || state.EnterBackPassengerSeatWhenPlayerVehicleNearby || state.DriveToXWhenBothSeated || state.AssignedVehicleSeatEntryActive;
                } catch { return true; }
            }
            public bool Dispatch(string encounterId, string capability, StepArgs args)
            {
                var encounter = Find(encounterId);
                if (encounter == null || !PromotedCharactersIntegration.SameIncarnation(encounter)) return false;
                var ped = encounter.Ped;
                if (capability == "follow_person" || capability == "stop_and_face" || capability == "approach_person" || capability == "walk_away_from") {
                    var anchor=host.Host.Anchors.Resolve(args.Target);
                    var target=anchor?.Entity as Ped;
                    if (target==null || anchor.Kind!="player" || !AnchorLive(args.Target)) return false;
                    var command = capability == "follow_person" ? "followtarget" : args.Command;
                    if (command == null) return false;
                    NpcFocus.SetFocus(ped, target, "lsa_activity");
                    NpcActionQueue.QueueNpcAction(command, null, null, ped, target);
                    own[encounterId] = command;
                } else if (capability == "hold_position") { NpcActionQueue.QueueNpcAction("waithere", ped); own[encounterId] = "waithere"; }
                else if (capability == "sit_on_ground") { NpcActionQueue.QueueNpcAction("sitonground", ped); own[encounterId] = "sitonground"; }
                else if (capability == "resume_ambient") { NpcActionQueue.QueueNpcAction("resumeactivity", ped); own[encounterId] = "resumeactivity"; }
                else if (capability == "exit_vehicle") { NpcActionQueue.QueueNpcAction("exitvehicle", ped); own[encounterId] = "exitvehicle"; }
                else if (capability == "begin_driving") { NpcActionQueue.QueueNpcAction("startdriving", ped); own[encounterId] = "startdriving"; }
                else if (capability == "take_cover") { NpcActionQueue.QueueNpcAction("takecover", ped); own[encounterId] = "takecover"; }
                else if (capability == "enter_vehicle_seat") {
                    // The vehicle is the one Essential resolves for the player. ACT only verifies it afterwards and cancels on a mismatch.
                    if (args.Command == null || !AnchorLive(args.Vehicle) || host.Host.Anchors.Resolve(args.Vehicle)?.Kind != "vehicle") return false;
                    NpcActionQueue.QueueNpcAction(args.Command, "", "", ped);
                    own[encounterId] = args.Command;
                }
                else if (capability == "walk_to" || capability == "drive_to") {
                    if (args == null || !args.HasPlace || !ValidPlace(new Vector3(args.PlaceTarget.X,args.PlaceTarget.Y,args.PlaceTarget.Z)))
                        return false;
                    var state = NpcStateStore.GetStateForActiveBehavior(ped);
                    if (state == null || state.HasActiveReflex || state.InDirectedInteraction) return false;
                    Vehicle vehicle = null;
                    if (capability == "drive_to") {
                        vehicle = ped.CurrentVehicle;
                        if (vehicle == null || !vehicle.Exists() || !vehicle.IsAlive || ped.SeatIndex != -1 || !RoadTarget(args)) return false;
                    } else if (ped.IsInAnyVehicle(false)) return false;
                    // Supersede only our own held Essential modes before installing this ACT-owned task.
                    if (state.FollowPlayerOnFoot) { NpcActions.ClearFollowFlags(state); FollowBehavior.StopFollowTarget(state); }
                    if (state.SitOnGroundMode) ComplianceBehavior.StopSitOnGround(state);
                    if (capability == "drive_to") {
                        // Essential's free-drive mode is persistent: simply issuing the
                        // GTA route task leaves its background reissuer alive, which can
                        // overwrite ACT6 navigation every few seconds. Clear that stock
                        // vehicle mode using Essential's own registered stop API BEFORE
                        // installing our single owner-scoped navigation task. This is a
                        // transfer of task ownership, not a repeated per-tick reset.
                        VehicleBehavior.StopAllVehicleCommands(ped,state);
                        state.StayUnderLsaControl = true;
                    }
                    var dest = new Vector3(args.PlaceTarget.X,args.PlaceTarget.Y,args.PlaceTarget.Z);
                    if (capability == "walk_to")
                        NativeFunction.CallByName<int>("TASK_FOLLOW_NAV_MESH_TO_COORD",ped,dest.X,dest.Y,dest.Z,1.0f,-1,2.5f,0,0f);
                    else
                        NativeFunction.CallByName<int>("TASK_VEHICLE_DRIVE_TO_COORD_LONGRANGE",ped,vehicle,dest.X,dest.Y,dest.Z,18f,786603,8f);
                    navigation[encounterId] = new NavMemory {
                        PlaceRef=args.Place, Capability=capability, PedHandle=Convert.ToUInt64(ped.Handle), PedAddress=ped.MemoryAddress,
                        VehicleHandle=vehicle == null ? 0 : Convert.ToUInt64(vehicle.Handle),
                        VehicleAddress=vehicle == null ? IntPtr.Zero : vehicle.MemoryAddress,
                        InitialDistance=FlatDistance(ped.Position,dest), BestDistance=FlatDistance(ped.Position,dest), LastPosition=ped.Position,
                        IssuedAt=GameTime, LastProgressAt=GameTime, LastSampleAt=GameTime
                    };
                    own[encounterId] = capability;
                }
                else if (capability == "grab_item") { if (args.ItemName == null) return false; NpcActionQueue.QueueNpcAction("grabitem", args.ItemName, "", ped); own[encounterId] = "grabitem"; }
                else if (capability == "clear_held_item") { NpcActionQueue.QueueNpcAction("clearhelditem", ped); own[encounterId] = "clearhelditem"; }
                else if (capability == "scenario_here") {
                    if (args.ScenarioName == null || args.Scenario == "sit_bench") return false;
                    var state = NpcStateStore.GetStateForActiveBehavior(ped);
                    // UseScenario does not clear follow. A player-directed scenario replaces the companion follow through the registered stop APIs.
                    if (state.FollowPlayerOnFoot) { NpcActions.ClearFollowFlags(state); FollowBehavior.StopFollowTarget(state); }
                    NpcActions.UseScenario(ped, args.ScenarioName);
                    own[encounterId] = "usescenario";
                }
                else return false;
                return true;
            }
            public void NoteForeign(string encounterId) { if (encounterId != null) {own.Remove(encounterId); navigation.Remove(encounterId); RefreshPrimaryOwner(Find(encounterId));} }
            public void Cancel(string encounterId, string capability, bool stopIfCurrent)
            {
                if (!stopIfCurrent || encounterId == null || !own.ContainsKey(encounterId)) return;
                var encounter = Find(encounterId);
                if (encounter == null || !PromotedCharactersIntegration.SameIncarnation(encounter)) return;
                var state = NpcStateStore.GetStateForActiveBehavior(encounter.Ped);
                // Only the registry's stop APIs. Capabilities with a supersede or none cancel path have nothing to call.
                if (capability == "follow_person") { NpcActions.ClearFollowFlags(state); FollowBehavior.StopFollowTarget(state); }
                else if (capability == "sit_on_ground") ComplianceBehavior.StopSitOnGround(state);
                else if (capability == "approach_person") MovementBehavior.StopApproachTarget(state);
                else if (capability == "walk_away_from") CombatBehavior.StopWalkAwayFromTarget(encounter.Ped, state, false);
                else if (capability == "take_cover") CombatBehavior.StopTakeCover(encounter.Ped, state, false);
                else if (capability == "begin_driving") VehicleBehavior.StopVehicleTaskOnly(encounter.Ped);
                else if (capability == "enter_vehicle_seat") VehicleBehavior.StopAllVehicleCommands(encounter.Ped, state);
                else if ((capability == "walk_to" || capability == "drive_to") && navigation.TryGetValue(encounterId,out var nav) &&
                         nav.Capability == capability && nav.PedHandle == Convert.ToUInt64(encounter.Ped.Handle) &&
                         nav.PedAddress == encounter.Ped.MemoryAddress) {
                    // Never overwrite a newer controller's task.
                    var currentTask=false;
                    try { var status=NavStatus(encounter.Ped,capability);currentTask=status==0 || status==1; } catch {}
                    if (currentTask && capability == "walk_to" && !encounter.Ped.IsInAnyVehicle(false))
                        NativeFunction.CallByName<int>("TASK_STAND_STILL",encounter.Ped,1);
                    else if (currentTask && capability == "drive_to") {
                        Vehicle current = null;
                        try { current = encounter.Ped.CurrentVehicle; } catch { }
                        // Never stop a different vehicle's task after a driver or vehicle change.
                        if (current != null && current.Exists() &&
                            Convert.ToUInt64(current.Handle) == nav.VehicleHandle &&
                            current.MemoryAddress == nav.VehicleAddress && encounter.Ped.SeatIndex == -1)
                            VehicleBehavior.StopVehicleTaskOnly(encounter.Ped);
                    }
                }
                else if (capability == "grab_item") NpcActions.ClearHeldItem(encounter.Ped);
                own.Remove(encounterId); navigation.Remove(encounterId);
            }
            public ModeSample Sample(string encounterId, StepArgs args)
            {
                var sample = new ModeSample { Alive = false, Dead = true, DistanceBand = "far", TargetDistance = -1f, SeatIndex = -1 };
                var encounter = Find(encounterId);
                if (encounter?.Ped == null || !encounter.Ped.Exists()) return sample;
                NpcState state = null;
                try { state = NpcStateStore.TryGetState(encounter.Ped); } catch { }
                sample.Alive = !encounter.Ped.IsDead; sample.Dead = encounter.Ped.IsDead;
                sample.X = encounter.Ped.Position.X; sample.Y = encounter.Ped.Position.Y; sample.Z = encounter.Ped.Position.Z;
                sample.FollowOnFoot = state != null && state.FollowPlayerOnFoot;
                sample.FollowPaused = state != null && state.FollowPaused;
                sample.SitOnGround = state != null && state.SitOnGroundMode;
                sample.Directed = state != null && state.InDirectedInteraction;
                sample.Reflex = state != null && state.HasActiveReflex;
                sample.ReflexTime = state != null ? state.LastReflexTime : 0;
                sample.Suspended = encounter.Suspended;
                try { sample.Scripted = Scripted() || encounter.Suspended; } catch { sample.Scripted = true; }
                try { sample.Injured = NativeFunction.CallByName<bool>("IS_PED_INJURED", encounter.Ped); } catch { }
                try { sample.InVehicle = NativeFunction.CallByName<bool>("IS_PED_IN_ANY_VEHICLE", encounter.Ped, false); } catch { }
                var player = Game.LocalPlayer?.Character;
                sample.TargetValid = false; sample.TargetSame = false;
                if (player != null && player.Exists()) {
                    sample.DistanceBand = Distance(encounter.Ped, player);
                    foreach (var anchor in host.Host.Anchors.Current.Where(a=>a.Kind=="player" && a.Consumers.Contains(LSA.Intelligence.AnchorConsumer.ActTarget)))
                        if (ReferenceEquals(anchor.Entity,player) && host.Host.Anchors.Resolve(anchor.CaptureRef)!=null) { sample.TargetValid = true; sample.TargetSame = true; }
                }
                var memory = false;
                try { memory = PedContinuityMemoryService.TryGetMemory(encounter.Ped, out PedContinuityMemory _); } catch { }
                sample.Wandering = !memory;
                sample.ContinuityReached = false;
                sample.ControlReleased = state == null || encounter.Suspended;
                if (state != null) SampleActThree(sample, encounter.Ped, state, args);
                if (args != null && args.HasPlace) SampleNavigation(sample, encounter.Ped, encounterId, args);
                return sample;
            }
            // Named Essential flags and GTA reads only. Every value is observed state, never inferred from a command.
            void SampleActThree(ModeSample sample, Ped actor, NpcState state, StepArgs args)
            {
                sample.StopFaceMode = state.StopAndFaceTargetMode; sample.ApproachMode = state.ApproachTargetMode;
                sample.WalkAwayMode = state.WalkAway; sample.CoverMode = state.TakeCoverMode;
                sample.AssignedSet = state.AssignedVehicle != null && state.AssignedVehicle.Exists();
                sample.SeatEntryActive = state.AssignedVehicleSeatEntryActive;
                try { sample.HoldingItem = state.HeldItem != null && state.HeldItem.IsHoldingItem; sample.HeldItemName = state.HeldItem?.ItemName; } catch { }
                if (args == null) return;
                if (args.Target != null) {
                    var anchor = host.Host.Anchors.Resolve(args.Target);
                    var target = anchor?.Entity as Ped;
                    if (target != null && target.Exists() && AnchorLive(args.Target)) {
                        var dx = target.Position.X - actor.Position.X; var dy = target.Position.Y - actor.Position.Y; var dz = target.Position.Z - actor.Position.Z;
                        var flat = Math.Sqrt(dx * dx + dy * dy);
                        sample.TargetDistance = (float)Math.Sqrt(flat * flat + dz * dz);
                        sample.StopFaceSame = state.StopAndFaceTargetPed != null && ReferenceEquals(state.StopAndFaceTargetPed, target);
                        sample.ApproachSame = state.ApproachTargetPed != null && ReferenceEquals(state.ApproachTargetPed, target);
                        if (flat > 0.01) {
                            var radians = actor.Heading * Math.PI / 180.0;
                            var cosine = (-Math.Sin(radians) * dx + Math.Cos(radians) * dy) / flat;
                            sample.Facing = cosine >= Math.Cos(CompletionAdapters.FacingToleranceDegrees * Math.PI / 180.0);
                        }
                    }
                }
                if (sample.InVehicle) {
                    try {
                        var current = actor.CurrentVehicle;
                        if (current != null && current.Exists()) {
                            sample.VehicleSpeed = current.Speed;
                            sample.SeatIndex = actor.SeatIndex;
                            sample.IsDriver = sample.SeatIndex == -1;
                            sample.VehicleIsAnchor = SameVehicle(current, host.Host.Anchors.Resolve(args.Vehicle)?.Entity as Vehicle);
                        }
                    } catch { }
                }
                if (sample.AssignedSet) sample.AssignedIsAnchor = SameVehicle(state.AssignedVehicle, host.Host.Anchors.Resolve(args.Vehicle)?.Entity as Vehicle);
                if (args.ScenarioName != null) { try { sample.ScenarioActive = NativeFunction.CallByName<bool>("IS_PED_USING_SCENARIO", actor, args.ScenarioName); } catch { } }
            }
            void SampleNavigation(ModeSample sample, Ped actor, string encounterId, StepArgs args) {
                if (!navigation.TryGetValue(encounterId,out var item) || item.PlaceRef != args.Place ||
                    item.PedHandle != Convert.ToUInt64(actor.Handle) || item.PedAddress != actor.MemoryAddress) return;
                sample.NavIssued = true;
                var position = new Vector3(args.PlaceTarget.X,args.PlaceTarget.Y,args.PlaceTarget.Z);
                sample.NavDistance = Distance3(actor.Position,position);
                var now = GameTime;
                int task;
                try {task=NavStatus(actor,item.Capability);}catch{sample.NavTaskLost=true;return;}
                if(task==1)item.TaskSeen=true;
                sample.NavTaskSeen=item.TaskSeen;
                // 7 is complete; any other unexpected state means this task is gone.
                if ((task!=0 && task!=1 && task!=7) ||
                    (task==7 && (!item.TaskSeen ||
                       sample.NavDistance>(item.Capability=="drive_to"?8f:3f)))) {
                    sample.NavTaskLost=true;return;
                }
                if (item.Capability == "drive_to") {
                    Vehicle current = null;
                    try { current=actor.CurrentVehicle; } catch {}
                    sample.NavVehicleSame=current!=null && current.Exists() && current.IsAlive &&
                        Convert.ToUInt64(current.Handle)==item.VehicleHandle && current.MemoryAddress==item.VehicleAddress;
                    if (!sample.NavVehicleSame) return;
                } else sample.NavVehicleSame = true;
                // Driving legitimately moves away from the goal for turns, junctions and roundabouts.
                // Establish progress from actual displacement under the owned task; judge final arrival
                // against the original retained target separately.
                var displacement=Distance3(actor.Position,item.LastPosition);
                var elapsed=unchecked(now-item.LastSampleAt);item.LastSampleAt=now;
                // Do not mistake a teleport or scripted reposition for navigation.
                var max=(item.Capability=="drive_to"?90f:12f)*Math.Max(0.2f,elapsed/1000f)+4f;
                if(displacement>max){sample.NavTaskLost=true;return;}
                if(displacement>=1f){
                    item.LastPosition=actor.Position;
                    if(task==1){item.MovedMeters+=displacement;item.LastProgressAt=now;}
                    if(item.MovedMeters>=2f)item.Progress=true;
                }
                if (sample.NavDistance < item.BestDistance) item.BestDistance=sample.NavDistance;
                sample.NavProgress=item.Progress;
                var close=sample.NavDistance <= (item.Capability=="drive_to"?8f:3f);
                var stopped=item.Capability!="drive_to" || sample.VehicleSpeed<4f;
                item.ArrivalSamples=close && stopped && item.Progress && item.TaskSeen ? item.ArrivalSamples+1 : 0;
                sample.NavArrived=item.ArrivalSamples>=3;
                // Do not repeatedly issue tasks or fight another controller. Report loss after bounded stall.
                sample.NavStuck=!sample.NavArrived && unchecked(now-item.LastProgressAt)>35000u &&
                    unchecked(now-item.IssuedAt)>35000u;
            }
            static bool SameVehicle(Vehicle left, Vehicle right)
            {
                try { return left != null && right != null && left.Exists() && right.Exists() && left.MemoryAddress == right.MemoryAddress && Convert.ToUInt64(left.Handle) == Convert.ToUInt64(right.Handle); } catch { return false; }
            }
            public void BeginOwnership(string encounterId)
            {
                var encounter = Find(encounterId);
                if (encounter == null || !PromotedCharactersIntegration.SameIncarnation(encounter)) throw new InvalidOperationException("actor_retired");
                var state = NpcStateStore.GetStateForActiveBehavior(encounter.Ped);
                seats[encounterId] = new SeatMemory { Enter = state.EnterPassengerSeatWhenPlayerEnters, Exit = state.ExitVehicleWhenPlayerExits, Stay = state.StayUnderLsaControl };
                state.EnterPassengerSeatWhenPlayerEnters = false;
                state.ExitVehicleWhenPlayerExits = false;
                state.StayUnderLsaControl = true;
                encounter.Mode = "activity";
                encounter.Owner=PrimaryBehaviorOwner.Transition(encounter.Owner,"act","activity",unchecked((uint)Game.GameTime));
            }
            public void EndOwnership(string encounterId, bool preempted)
            {
                if (encounterId == null || !seats.ContainsKey(encounterId)) return;
                navigation.Remove(encounterId);
                own.Remove(encounterId);
                var memory = seats[encounterId]; seats.Remove(encounterId);
                var encounter = Find(encounterId);
                if (encounter == null || !PromotedCharactersIntegration.SameIncarnation(encounter)) return;
                if(preempted) {RefreshPrimaryOwner(encounter);return;}
                try {
                    var state = NpcStateStore.GetStateForActiveBehavior(encounter.Ped);
                    state.EnterPassengerSeatWhenPlayerEnters = memory.Enter;
                    state.ExitVehicleWhenPlayerExits = memory.Exit;
                    state.StayUnderLsaControl = memory.Stay;
                } catch { }
                RefreshPrimaryOwner(encounter);
            }
            public bool AnchorLive(string captureRef) {
                var anchor=host.Host.Anchors.Resolve(captureRef);
                if (anchor==null || !anchor.Consumers.Contains(LSA.Intelligence.AnchorConsumer.ActTarget)) return false;
                if (anchor.Kind=="player") return anchor.Entity is Ped && ReferenceEquals(anchor.Entity,Game.LocalPlayer?.Character);
                if (anchor.Kind=="vehicle") { var vehicle=anchor.Entity as Vehicle; return vehicle!=null && vehicle.Exists() && vehicle.IsAlive; }
                return false;
            }
            Encounter Find(string encounterId) => encounterId == null ? null : host.encounters.Values.FirstOrDefault(item => item.Id == encounterId);
            static string Distance(Ped actor, Ped other)
            {
                var dx = actor.Position.X - other.Position.X; var dy = actor.Position.Y - other.Position.Y; var dz = actor.Position.Z - other.Position.Z;
                return PlaceTable.Band(dx, dy, dz);
            }
        }
    }
}
