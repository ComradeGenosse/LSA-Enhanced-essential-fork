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

        // Essential queue and the registry stop APIs only. No raw task natives and no broad task clearing.
        sealed class EssentialActivityWorld : IActivityWorld
        {
            sealed class SeatMemory { public bool Enter, Exit, Stay; }
            readonly PromotedCharactersIntegration host;
            // Entity references live exclusively in host.Host.Anchors.
            readonly Dictionary<string, string> own = new Dictionary<string, string>();
            readonly Dictionary<string, SeatMemory> seats = new Dictionary<string, SeatMemory>();
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
                if (slotKind == "here") {
                    var position = encounter.Ped.Position;
                    return new AnchorResult { Ok = true, Ref = Guid.NewGuid().ToString("D"), SlotKind = "here", Band = "at", Label = "here", X = position.X, Y = position.Y, Z = position.Z };
                }
                return new AnchorResult { Reason = "place_unsupported" };
            }
            public PreflightResult Preflight(string encounterId, string capability)
            {
                var sample = Sample(encounterId);
                if (!sample.Alive || sample.Dead) return new PreflightResult { Reason = "actor_dead" };
                if (sample.Injured) return new PreflightResult { Reason = "actor_injured" };
                if (sample.Scripted) return new PreflightResult { Reason = "scripted_state" };
                if (sample.Directed) return new PreflightResult { Reason = "directed_interaction" };
                if (sample.Reflex) return new PreflightResult { Reason = "reflex_active" };
                if (capability == "sit_on_ground" && sample.InVehicle) return new PreflightResult { Reason = "on_foot_required" };
                if (capability == "hold_position" && sample.FollowPaused && !sample.FollowOnFoot) return new PreflightResult { Already = true };
                if (capability == "follow_person" && sample.FollowOnFoot && sample.TargetSame) return new PreflightResult { Already = true };
                if (capability == "sit_on_ground" && sample.SitOnGround) return new PreflightResult { Already = true };
                return new PreflightResult { Ok = true };
            }
            public bool Dispatch(string encounterId, string capability, string targetRef)
            {
                var encounter = Find(encounterId);
                if (encounter == null || !PromotedCharactersIntegration.SameIncarnation(encounter)) return false;
                var ped = encounter.Ped;
                if (capability == "follow_person") {
                    var anchor=host.Host.Anchors.Resolve(targetRef);
                    var target=anchor?.Entity as Ped;
                    if (target==null || anchor.Kind!="player" || !AnchorLive(targetRef)) return false;
                    NpcFocus.SetFocus(ped, target, "lsa_activity");
                    NpcActionQueue.QueueNpcAction("followtarget", null, null, ped, target);
                    own[encounterId] = "followtarget";
                } else if (capability == "hold_position") { NpcActionQueue.QueueNpcAction("waithere", ped); own[encounterId] = "waithere"; }
                else if (capability == "sit_on_ground") { NpcActionQueue.QueueNpcAction("sitonground", ped); own[encounterId] = "sitonground"; }
                else if (capability == "resume_ambient") { NpcActionQueue.QueueNpcAction("resumeactivity", ped); own[encounterId] = "resumeactivity"; }
                else return false;
                return true;
            }
            public void NoteForeign(string encounterId) { if (encounterId != null) {own.Remove(encounterId);RefreshPrimaryOwner(Find(encounterId));} }
            public void Cancel(string encounterId, string capability, bool stopIfCurrent)
            {
                if (!stopIfCurrent || encounterId == null || !own.ContainsKey(encounterId)) return;
                var encounter = Find(encounterId);
                if (encounter == null || !PromotedCharactersIntegration.SameIncarnation(encounter)) return;
                var state = NpcStateStore.GetStateForActiveBehavior(encounter.Ped);
                if (capability == "follow_person") { NpcActions.ClearFollowFlags(state); FollowBehavior.StopFollowTarget(state); }
                else if (capability == "sit_on_ground") ComplianceBehavior.StopSitOnGround(state);
                own.Remove(encounterId);
            }
            public ModeSample Sample(string encounterId)
            {
                var sample = new ModeSample { Alive = false, Dead = true, DistanceBand = "far" };
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
                return sample;
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
                return anchor!=null && anchor.Kind=="player" && anchor.Entity is Ped &&
                    ReferenceEquals(anchor.Entity,Game.LocalPlayer?.Character) && anchor.Consumers.Contains(LSA.Intelligence.AnchorConsumer.ActTarget);
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
