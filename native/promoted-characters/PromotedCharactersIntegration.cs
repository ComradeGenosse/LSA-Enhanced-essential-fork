using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using LSA.SessionIdentity;
using LosSantosAlive.Context;
using LosSantosAlive.Context.Providers;
using LosSantosAlive.Integrations;
using LosSantosAlive.NPC;
using Rage;
using Rage.Native;

namespace LSA.PromotedCharacters
{
    internal sealed class PrimaryBehaviorOwner
    {
        public string owner { get; }
        public string mode { get; }
        public uint since { get; }
        PrimaryBehaviorOwner(string owner, string mode, uint since) { this.owner=owner; this.mode=mode; this.since=since; }
        public static PrimaryBehaviorOwner Transition(PrimaryBehaviorOwner previous,string owner,string mode,uint gameMs)
        {
            if (!new[]{"p2","act","essential_residual","none"}.Contains(owner) || !new[]{"follow","wait","sit","activity","unknown","idle"}.Contains(mode)) throw new ArgumentException("primary_owner_shape");
            return previous!=null && previous.owner==owner && previous.mode==mode ? previous : new PrimaryBehaviorOwner(owner,mode,gameMs);
        }
        public static PrimaryBehaviorOwner Residual(PrimaryBehaviorOwner previous,bool known,bool follow,bool paused,bool sit,bool foreign,uint gameMs)
        {
            var mode=!known || foreign || sit && (follow || paused) ? "unknown" : sit ? "sit" : follow || paused ? "follow" : "unknown";
            return Transition(previous,known ? "essential_residual" : "none",mode,gameMs);
        }
    }
    internal sealed class Encounter
    {
        public Ped Ped;
        public IntPtr Address;
        public ulong Handle;
        public string CaptureRef;
        public string Id = Guid.NewGuid().ToString("D"), OwnerAlias, OwnershipToken;
        public RegistrationToken Registration;
        public bool Created, Suspended;
        public string Mode = "unknown";
        public PrimaryBehaviorOwner Owner;
    }
    internal sealed class Capture
    {
        public Encounter Encounter;
        public long ExpiresAtUtc;
    }
    public sealed partial class PromotedCharactersIntegration : IIntegration
    {
        readonly string world, pipeName, identityPipeName;
        internal readonly HostContext Host;
        readonly Dictionary<string,Encounter> encounters = new Dictionary<string,Encounter>();
        readonly Dictionary<string,Capture> captures = new Dictionary<string,Capture>();
        readonly JavaScriptSerializer json = new JavaScriptSerializer {MaxJsonLength = 32768,RecursionLimit = 12};
        SessionIdentityIntegration identity;
        ControlChannel channel;
        long lastGameTime;
        bool prepared,shutdown;
        volatile bool shutdownRequested;
        string shutdownReason="none";
        public event Action<string> OwnerRetired;
        public LSA.Intelligence.OwnedParticipant[] PerceptionRoster() => encounters.Values.Where(e=>e.Registration!=null && Alive(e)).Select(e=> {
            var registration=e.Registration;
            // Read-only lifetime validity includes the terminal dead state until Retire;
            // no identity proof or action authority is inferred from this roster.
            return new LSA.Intelligence.OwnedParticipant {Ped=e.Ped,Lifetime=registration.IncarnationId,EncounterId=e.Id,Current=()=>ReferenceEquals(e.Registration,registration) && e.Ped.Exists() && e.Ped.MemoryAddress==e.Address && (e.Ped.IsDead || identity?.Owner?.TryResolveCurrent(e.Ped,out var claim)==true && claim.incarnationId==registration.IncarnationId)};
        }).ToArray();
        public string Id => "characterProfile";
        // Prepared integrations must receive Core.Update even on a late load.
        // Readiness is separate: no owner operation can run before Core creates
        // P1/P2's stores and channels on its own initialization/update fiber.
        public bool IsAvailable => prepared && !shutdown && (shutdownRequested || channel == null || identity?.IsAvailable == true);
        public bool IsReady => channel != null && identity?.IsAvailable == true && !shutdown && !shutdownRequested;
        internal string UnavailabilityReason => shutdown?shutdownReason:channel==null?"not_initialized":identity?.IsAvailable!=true?"identity_unavailable":"none";
        internal string IdentityRuntimeStatus => identity?.DiagnosticsStatus() ?? "identity_status=none";
        static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        public PromotedCharactersIntegration(string worldProfileId,string pipeName = "LSA.PromotedCharacters.v1",string identityPipeName = "LSA.SessionIdentity.v1",HostContext host = null)
        {
            if (worldProfileId == null || !Regex.IsMatch(worldProfileId,"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$") || !Regex.IsMatch(pipeName,"^[A-Za-z0-9_.-]{1,80}$") || !Regex.IsMatch(identityPipeName,"^[A-Za-z0-9_.-]{1,80}$")) throw new ArgumentException("Invalid P2 configuration.");
            world = worldProfileId; this.pipeName = pipeName; this.identityPipeName = identityPipeName;
            Host = host ?? new HostContext();
            Host.WorldChanged+=OnHostWorldChanged;
            talkTargets = new TalkTargetSelector(ped => EncounterFor(ped).Id);
        }
        public void Prepare()
        {
            if (prepared || shutdown) return;
            identity = SessionIdentityIntegration.InstallDeferred(identityPipeName);
            identity.ConfigureHostContext(Host.HostRunId,()=>Host.WorldEpoch);
            prepared = true;
        }
        public void Initialize()
        {
            if (!prepared || channel != null || shutdown) return;
            identity.Initialize();
            if (!identity.IsAvailable) { shutdown = true; Game.LogTrivial("[P2] identity_initialization_failed"); return; }
            channel = new ControlChannel(pipeName,Guid.NewGuid().ToString("D"),world,Host.HostRunId,Host.WorldEpoch); channel.Start(); lastGameTime = Game.GameTime;
            Host.ObserveGameTick(unchecked((uint)lastGameTime));
        }
        static bool Alive(Encounter encounter) => encounter?.Ped != null && encounter.Ped.Exists() && !encounter.Ped.IsDead && encounter.Ped.MemoryAddress == encounter.Address;
        Encounter EncounterFor(Ped ped)
        {
            if (ped == null || !ped.Exists() || ped.IsDead || ped == Game.LocalPlayer.Character) throw new InvalidOperationException("invalid_target");
            string handle = ped.Handle.ToString();
            if (encounters.TryGetValue(handle,out var existing)) {
                if (Alive(existing) && ReferenceEquals(existing.Ped,ped) && existing.Handle==Convert.ToUInt64(ped.Handle) && existing.Address==ped.MemoryAddress && Host.Anchors.Resolve(existing.CaptureRef)!=null) {
                    RetainEncounter(existing); return existing;
                }
                Retire(existing); encounters.Remove(handle);
            }
            if (encounters.Count >= 256) throw new InvalidOperationException("encounter_limit");
            var encounter = new Encounter {Ped = ped,Address = ped.MemoryAddress,Handle=Convert.ToUInt64(ped.Handle)};
            RetainEncounter(encounter); encounters.Add(handle,encounter); return encounter;
        }
        void RetainEncounter(Encounter encounter)
        {
            var ped=encounter.Ped; var handle=encounter.Handle;var address=encounter.Address;
            var registration=encounter.Registration;
            var anchor=Host.Anchors.Retain(ped,handle,address,"ped",registration?.IncarnationId,
                ()=>ped.Exists() && Convert.ToUInt64(ped.Handle)==handle && ped.MemoryAddress==address && ReferenceEquals(encounter.Registration,registration),
                Host.MonotonicMs,false,LSA.Intelligence.AnchorConsumer.P2Encounter);
            if(anchor==null) throw new InvalidOperationException("anchor_limit");
            encounter.CaptureRef=anchor.CaptureRef;
            if(encounter.Owner==null) RefreshPrimaryOwner(encounter);
        }
        static bool Scripted() => NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") || NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING") || NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") || NativeFunction.CallByName<bool>("GET_MISSION_FLAG") || NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE");
        static bool Safe(Encounter encounter,bool adopting = false)
        {
            if (!Alive(encounter)) return false;
            var state = NpcStateStore.TryGetState(encounter.Ped);
            bool missionEntity = encounter.Ped.IsPersistent || NativeFunction.CallByName<bool>("IS_ENTITY_A_MISSION_ENTITY",encounter.Ped);
            bool foreignScript = missionEntity && !NativeFunction.CallByName<bool>("DOES_ENTITY_BELONG_TO_THIS_SCRIPT",encounter.Ped,false);
            return NativeSafetyPolicy.CanControl(true,false,encounter.Ped == Game.LocalPlayer.Character,Scripted(),
                foreignScript || adopting && missionEntity && !NpcActions.HasExclusiveControl(encounter.Ped),state?.InDirectedInteraction == true);
        }
        void Retire(Encounter encounter) {
            try { activityRunner?.Retire(encounter.Id, encounter.Registration?.IncarnationId, unchecked((uint)Game.GameTime), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), activitySession); } catch { }
            // PS may sample the terminal state while the exact original lifetime
            // is still retained. Revoke it only after that factual callback.
            if (encounter.Registration != null) { try {OwnerRetired?.Invoke(encounter.Registration.IncarnationId);}catch{} }
            Host.Anchors.Retire(encounter.CaptureRef,LSA.Intelligence.AnchorRetirement.OwnerRevoked);
            if (encounter.Registration != null) identity?.Owner?.Retire(encounter.Registration);
            encounter.Registration = null; encounter.OwnerAlias = null; encounter.OwnershipToken = null;
            encounter.Owner=PrimaryBehaviorOwner.Transition(encounter.Owner,"none","unknown",unchecked((uint)Game.GameTime));
            encounter.Mode="unknown";
        }
        static void RefreshPrimaryOwner(Encounter encounter)
        {
            if(encounter==null)return;
            NpcState state=null;
            try {if(SameIncarnation(encounter))state=NpcStateStore.TryGetState(encounter.Ped);}catch{}
            encounter.Owner=PrimaryBehaviorOwner.Residual(encounter.Owner,state!=null,state?.FollowPlayerOnFoot==true,state?.FollowPaused==true,state?.SitOnGroundMode==true,state?.InDirectedInteraction==true || state?.HasActiveReflex==true,unchecked((uint)Game.GameTime));
            encounter.Mode=encounter.Owner.mode;
        }
        static void Suspend(Encounter encounter)
        {
            encounter.Suspended = true; // Set first, before any native control callback.
            var state = NpcStateStore.TryGetState(encounter.Ped);
            if (state != null) { state.FollowPlayerOnFoot = false; state.FollowPaused = true; state.EnterPassengerSeatWhenPlayerEnters = false; state.ExitVehicleWhenPlayerExits = false; state.StayUnderLsaControl = false; state.DemoteToPassiveRuntime(); }
            RefreshPrimaryOwner(encounter);
            // No TASK, teleport, delete, or automatic resume.
        }
        void ResetForClockDiscontinuity(long now,string reason)
        {
            // A save/world transition invalidates every live association. Clear
            // them before any operation that can fail so even failure cleanup
            // cannot inspect, task, dismiss or adopt a ped from the old world.
            var retired = encounters.Values.ToArray(); encounters.Clear(); captures.Clear();
            var previous = channel; channel = null; previous?.Dispose();
            foreach (var encounter in retired) Retire(encounter);
            // P1 may already have reset its owner store, or may do so later in
            // this Core update. Retiring an old-epoch token never clears a new
            // claim. No capture/control work is admitted during this reset tick.
            var replacement = new ControlChannel(pipeName,Guid.NewGuid().ToString("D"),world,Host.HostRunId,Host.WorldEpoch);
            replacement.Start(); channel = replacement; lastGameTime = now;
            ActivityClockReset(reason);
            // Pending loader commands carried the old world's expectations. The
            // optional bridge can never fail P2's own reset.
            try { talkTargets.ResetForWorldChange(Monotonic); } catch { }
            try { ResetLocal("native_stale"); } catch { }
            Game.LogTrivial("[P2] game_clock_reset");
        }
        void OnHostWorldChanged(int epoch,string reason)
        {
            if(!IsReady) return;
            // Clear P2's associations before anything that can fail; P1 then
            // rotates its independent factual epoch on this same Core owner.
            ResetForClockDiscontinuity(Game.GameTime,reason);
            identity.ResetForHostWorld(epoch,reason);
        }
        public void Update()
        {
            if (!IsAvailable) return;
            try
            {
                if (shutdownRequested) { Shutdown(); return; }
                if (!IsReady) { Initialize(); return; }
                long now = Game.GameTime;
                try {if(Host.ObserveGameTick(unchecked((uint)now))) return;}
                catch {Game.LogTrivial("[P2] game_clock_reset_failed");Shutdown();return;}
                lastGameTime = now;
                Host.Cleanup();
                foreach (var item in encounters.ToArray()) {
                    if (!Alive(item.Value)) { Retire(item.Value); encounters.Remove(item.Key); continue; }
                    if (item.Value.Registration != null && !Safe(item.Value) && !item.Value.Suspended) Suspend(item.Value);
                }
                foreach (var item in captures.Where(item => item.Value.ExpiresAtUtc <= Now).ToArray()) captures.Remove(item.Key);
                // One budget of four per tick: pipe requests first, then loader commands.
                int handled = 0;
                for (; handled < 4 && channel.TryTake(out var request); handled++) {
                    try { if (request.Cancelled || request.ExpiresAtUtc <= Now) throw new InvalidOperationException("native_stale"); request.Result = Handle(request); }
                    catch (InvalidOperationException error) { request.Reason = Regex.IsMatch(error.Message,"^[a-z][a-z0-9_]{0,63}$") ? error.Message : "native_operation_failed"; }
                    catch { request.Reason = "native_operation_failed"; }
                    finally { request.Done.Set(); }
                }
                ServeLocal(4 - handled);
                try { ActivityTick(now); } catch { DisableActivity(); }
            } catch { LSA.Intelligence.IntelligenceIntegration.LogStatus("[P2] optional_update_failed"); Shutdown("update_failed"); }
        }
        static void Fields(Dictionary<string,object> args,params string[] fields) { if (args.Count != fields.Length || fields.Any(field => !args.ContainsKey(field))) throw new InvalidOperationException("invalid_owner_arguments"); }
        static string Text(Dictionary<string,object> args,string key) { if (!args.TryGetValue(key,out var value) || !(value is string text) || text.Length > 80) throw new InvalidOperationException("invalid_owner_arguments"); return text; }
        static bool Alias(string alias) => Regex.IsMatch(alias,"^promoted\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
        Encounter Owned(string alias) => encounters.Values.SingleOrDefault(item => item.OwnerAlias == alias && Alive(item));
        object Binding(Encounter encounter,bool alreadyOwned = false)
        {
            if (!identity.Owner.TryResolveCurrent(encounter.Ped,out var claim)) throw new InvalidOperationException("ownership_conflict");
            return new {pedId = encounter.Ped.Handle.ToString(),encounterId = encounter.Id,ownerAlias = encounter.OwnerAlias,ownershipToken = encounter.OwnershipToken,claim,alreadyOwned};
        }
        object Handle(ControlRequest request)
        {
            var args = request.Args;
            // Read-only view of Essential's current NPC; no capture ticket is created.
            if (request.Operation == "current") { Fields(args); return CurrentView(); }
            if (request.Operation == "roster") {
                Fields(args); return new {owned = encounters.Values.Where(item => item.Registration != null && Alive(item)).Select(item => new {ownerAlias = item.OwnerAlias,status = item.Suspended ? "suspended" : "spawned"}).ToArray(),encounters = encounters.Values.Where(Alive).Select(item => item.Id).ToArray()};
            }
            if (request.Operation == "inspect") { Fields(args,"ownerAlias"); var item = Owned(Text(args,"ownerAlias")); return item == null ? null : Binding(item,true); }
            if (request.Operation == "capture") {
                Fields(args); var ped = CurrentPed();
                var encounter = EncounterFor(ped);
                if (!Safe(encounter,encounter.Registration == null)) throw new InvalidOperationException("scripted_state");
                if (captures.Count >= 16) throw new InvalidOperationException("capture_limit");
                string token = Guid.NewGuid().ToString("D"); captures.Add(token,new Capture {Encounter = encounter,ExpiresAtUtc = Now + 10000});
                var actor = new ActorContext(); ActorContextProvider.Populate(actor,ped);
                return new {captureToken = token,pedId = ped.Handle.ToString(),encounterId = encounter.Id,ownerAlias = encounter.OwnerAlias,
                    modelHash = ped.Model.Hash,appearance = Appearance(ped),actor = new {pedId = actor.PedId,gender = actor.Gender,ageRange = actor.AgeRange,archetypeName = actor.Archetype,roleName = actor.RoleName}};
            }
            if (request.Operation == "register") {
                Fields(args,"captureToken","ownerAlias"); string token = Text(args,"captureToken"),alias = Text(args,"ownerAlias");
                if (!captures.TryGetValue(token,out var capture) || capture.ExpiresAtUtc <= Now) throw new InvalidOperationException("native_stale"); captures.Remove(token);
                var encounter = capture.Encounter;
                // Selection can change during async preparation. Never promote a new target.
                var selected = CurrentPed();
                if (selected == null || !ReferenceEquals(selected,encounter.Ped) || selected.MemoryAddress!=encounter.Address ||
                    Convert.ToUInt64(selected.Handle)!=encounter.Handle || Host.Anchors.Resolve(encounter.CaptureRef)==null ||
                    !Safe(encounter,encounter.Registration == null)) throw new InvalidOperationException("native_stale");
                if (!Alias(alias)) throw new InvalidOperationException("invalid_owner_alias");
                if (encounter.OwnerAlias != null) { if (encounter.OwnerAlias != alias) throw new InvalidOperationException("ownership_conflict"); return Binding(encounter,true); }
                if (Owned(alias) != null || identity.Owner.TryResolveCurrent(encounter.Ped,out _)) throw new InvalidOperationException("ownership_conflict");
                encounter.Registration = identity.Owner.Register(encounter.Ped,alias,world); encounter.OwnerAlias = alias; encounter.OwnershipToken = Guid.NewGuid().ToString("D"); RetainEncounter(encounter);
                // Promotion records explicit ownership; it does not change the current
                // voice or force a task. Companion mode is a separate player choice.
                return Binding(encounter);
            }
            if (request.Operation == "spawn") {
                Fields(args,"ownerAlias","modelHash","appearance"); var alias = Text(args,"ownerAlias"); if (!Alias(alias)) throw new InvalidOperationException("invalid_owner_alias");
                var existing = Owned(alias); if (existing != null) return Binding(existing,true);
                if (Scripted()) throw new InvalidOperationException("scripted_state");
                var player = Game.LocalPlayer.Character;
                if (player == null || !player.Exists() || player.IsDead || NativeFunction.CallByName<bool>("IS_PED_IN_ANY_VEHICLE",player,false) || NativeFunction.CallByName<int>("GET_INTERIOR_FROM_ENTITY",player) != 0 || NativeFunction.CallByName<bool>("IS_ENTITY_IN_AIR",player)) throw new InvalidOperationException("unsafe_spawn_location");
                uint hash = Convert.ToUInt32(args["modelHash"]); var model = new Model(hash);
                if (!model.IsValid || !model.IsPed) throw new InvalidOperationException("invalid_ped_model");
                var appearance = args["appearance"] as Dictionary<string,object>; ValidateAppearance(appearance);
                var position = player.GetOffsetPosition(new Vector3(2.5f,2.5f,0)); float? ground = World.GetGroundZ(position,true,false);
                if (!ground.HasValue || Math.Abs(ground.Value - position.Z) > 3) throw new InvalidOperationException("unsafe_spawn_location"); position.Z = ground.Value;
                Ped ped = null; Encounter encounter = null;
                try {
                    // Constructor may yield while loading the model. Recheck safety
                    // and request expiry before publishing ownership or any task.
                    ped = new Ped(model,position,player.Heading);
                    if (request.Cancelled || request.ExpiresAtUtc <= Now || Scripted()) throw new InvalidOperationException("native_stale");
                    Restore(ped,appearance); encounter = EncounterFor(ped); encounter.Created = true;
                    encounter.Registration = identity.Owner.Register(ped,alias,world); encounter.OwnerAlias = alias; encounter.OwnershipToken = Guid.NewGuid().ToString("D"); RetainEncounter(encounter);
                    return Binding(encounter);
                } catch { if (encounter != null) Retire(encounter); if (ped != null && ped.Exists() && !Scripted()) ped.Delete(); throw; }
            }
            Fields(args,"ownerAlias","ownershipToken"); var owned = Owned(Text(args,"ownerAlias"));
            if (owned == null || !NativeSafetyPolicy.Current(Text(args,"ownershipToken"),owned.OwnershipToken)) throw new InvalidOperationException("native_stale");
            if (!Safe(owned)) throw new InvalidOperationException("scripted_state");
            switch (request.Operation) {
                case "follow":
                    NoteActivityCommand(owned, "follow");
                    NpcFocus.SetFocus(owned.Ped,Game.LocalPlayer.Character,"p2_player_command"); NpcActions.FollowTarget(owned.Ped); var follow = NpcStateStore.GetStateForActiveBehavior(owned.Ped);
                    follow.StayUnderLsaControl = true; follow.EnterPassengerSeatWhenPlayerEnters = true; follow.ExitVehicleWhenPlayerExits = true; follow.AccompliceMode = false;
                    owned.Mode = "follow"; owned.Owner=PrimaryBehaviorOwner.Transition(owned.Owner,"p2","follow",unchecked((uint)Game.GameTime)); owned.Suspended = false; break;
                case "wait": NoteActivityCommand(owned, "wait"); NpcActions.WaitHere(owned.Ped); var wait = NpcStateStore.GetStateForActiveBehavior(owned.Ped); wait.StayUnderLsaControl = true; wait.EnterPassengerSeatWhenPlayerEnters = false; wait.ExitVehicleWhenPlayerExits = false; owned.Mode = "wait"; owned.Owner=PrimaryBehaviorOwner.Transition(owned.Owner,"p2","wait",unchecked((uint)Game.GameTime)); owned.Suspended = false; break;
                case "dismiss": case "release": case "despawn":
                    NoteActivityCommand(owned, request.Operation);
                    if (request.Operation == "despawn" && !owned.Created) throw new InvalidOperationException("cannot_delete_adopted_ped");
                    // Retire proof first. Essential's original lifecycle closes exact
                    // sessions; no CharacterId-based rerouting is introduced.
                    Retire(owned); NpcActions.ReleaseExclusiveControlForExternalSystem(owned.Ped,"p2_player_dismissal",false);
                    if (request.Operation == "despawn") owned.Ped.Delete(); else if (owned.Created) owned.Ped.Dismiss(); break;
                default: throw new InvalidOperationException("invalid_owner_operation");
            }
            return new {status = request.Operation};
        }
        static object Appearance(Ped ped)
        {
            var components = new List<object>(); var props = new List<object>();
            for (int slot = 0; slot < 12; slot++) {
                int count = NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_DRAWABLE_VARIATIONS",ped,slot);
                if (count <= 0) continue; // Static model parts have no writable variation.
                int drawable = NativeFunction.CallByName<int>("GET_PED_DRAWABLE_VARIATION",ped,slot),texture = NativeFunction.CallByName<int>("GET_PED_TEXTURE_VARIATION",ped,slot);
                if (drawable < 0 || drawable >= count || !NativeSafetyPolicy.VariationAvailable(drawable,texture,count,NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_TEXTURE_VARIATIONS",ped,slot,drawable))) continue;
                components.Add(new {slot,drawable,texture,palette = NativeFunction.CallByName<int>("GET_PED_PALETTE_VARIATION",ped,slot)});
            }
            for (int slot = 0; slot < 8; slot++) {
                int count = NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_PROP_DRAWABLE_VARIATIONS",ped,slot);
                if (count <= 0) continue;
                int drawable = NativeFunction.CallByName<int>("GET_PED_PROP_INDEX",ped,slot),texture = drawable == -1 ? 0 : NativeFunction.CallByName<int>("GET_PED_PROP_TEXTURE_INDEX",ped,slot);
                if (drawable != -1 && (drawable < 0 || drawable >= count || !NativeSafetyPolicy.VariationAvailable(drawable,texture,count,NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_PROP_TEXTURE_VARIATIONS",ped,slot,drawable)))) continue;
                props.Add(new {slot,drawable,texture});
            }
            return new {version = 1,components,props};
        }
        static void ValidateAppearance(Dictionary<string,object> value)
        {
            if (value == null) throw new InvalidOperationException("invalid_appearance"); Fields(value,"version","components","props");
            if (Convert.ToInt32(value["version"]) != 1) throw new InvalidOperationException("invalid_appearance");
            foreach (var name in new [] {"components","props"}) {
                var items = value[name] as IList; int limit = name == "components" ? 12 : 8; if (items == null || items.Count > limit) throw new InvalidOperationException("invalid_appearance"); var slots = new HashSet<int>();
                foreach (var item in items) { var fields = item as Dictionary<string,object>; if (fields == null) throw new InvalidOperationException("invalid_appearance"); Fields(fields,name == "components" ? new [] {"slot","drawable","texture","palette"} : new [] {"slot","drawable","texture"}); int slot = Convert.ToInt32(fields["slot"]),drawable = Convert.ToInt32(fields["drawable"]),texture = Convert.ToInt32(fields["texture"]); if (slot < 0 || slot >= limit || !slots.Add(slot) || drawable < (name == "components" ? 0 : -1) || drawable > 4095 || texture < 0 || texture > 4095 || (name == "components" && (Convert.ToInt32(fields["palette"]) < 0 || Convert.ToInt32(fields["palette"]) > 3))) throw new InvalidOperationException("invalid_appearance"); }
            }
        }
        static void Restore(Ped ped,Dictionary<string,object> value)
        {
            foreach (Dictionary<string,object> item in (IList)value["components"]) {
                int slot = Convert.ToInt32(item["slot"]),drawable = Convert.ToInt32(item["drawable"]),texture = Convert.ToInt32(item["texture"]);
                if (drawable >= NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_DRAWABLE_VARIATIONS",ped,slot) || texture >= NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_TEXTURE_VARIATIONS",ped,slot,drawable)) throw new InvalidOperationException("appearance_unavailable");
                NativeFunction.CallByName<uint>("SET_PED_COMPONENT_VARIATION",ped,slot,drawable,texture,Convert.ToInt32(item["palette"]));
            }
            foreach (Dictionary<string,object> item in (IList)value["props"]) {
                int slot = Convert.ToInt32(item["slot"]),drawable = Convert.ToInt32(item["drawable"]),texture = Convert.ToInt32(item["texture"]);
                if (drawable == -1) { NativeFunction.CallByName<uint>("CLEAR_PED_PROP",ped,slot); continue; }
                if (drawable >= NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_PROP_DRAWABLE_VARIATIONS",ped,slot) || texture >= NativeFunction.CallByName<int>("GET_NUMBER_OF_PED_PROP_TEXTURE_VARIATIONS",ped,slot,drawable)) throw new InvalidOperationException("appearance_unavailable");
                NativeFunction.CallByName<uint>("SET_PED_PROP_INDEX",ped,slot,drawable,texture,true);
            }
        }
        public void EnrichActor(Ped ped,ActorContext context)
        {
            if (!IsReady || context?.IntegrationBlocks == null || context.PedId != ped?.Handle.ToString()) return;
            try { var encounter = EncounterFor(ped); context.IntegrationBlocks.Add(new IntegrationJsonBlock(Id,json.Serialize(new {version = 1,encounterId = encounter.Id,owner = encounter.Owner}))); } catch { }
        }
        public void OnPedControlChanged(Ped ped,bool controlledByLsa) { if (IsReady && !controlledByLsa && ped != null && encounters.TryGetValue(ped.Handle.ToString(),out var encounter) && encounter.Registration != null && !encounter.Suspended) { Suspend(encounter); PushActivity(ped, "", "control_lost", null); } }
        public void OnNpcActionExecuted(Ped ped,string actionName,bool succeeded) { PushActivity(ped, actionName, "executed", succeeded); }
        // A loader/lifetime fiber can request cleanup, but Core's own callback
        // must retire evidence and perform any native cleanup on its owner fiber.
        public void RequestShutdown() => shutdownRequested = true;
        public void Shutdown()
        {Shutdown("integration_shutdown");}
        internal void Shutdown(string reason)
        {
            if (shutdown) return; shutdownReason=reason; shutdown = true;
            Host.WorldChanged-=OnHostWorldChanged;
            ActivityShutdown();
            LSA.Intelligence.IntelligenceIntegration.LogStatus("[P2] shutdown reason="+shutdownReason);
            channel?.Dispose(); channel = null;
            try { talkTargets?.Shutdown(Monotonic); } catch { }
            CloseLocal();
            foreach (var encounter in encounters.Values) {
                try { if (Alive(encounter) && Safe(encounter)) { Suspend(encounter); if (encounter.Created) encounter.Ped.Dismiss(); } } catch { }
                // Failed optional native cleanup cannot keep an ownership claim.
                try { Retire(encounter); } catch { }
            }
            encounters.Clear(); captures.Clear();
            Host.Shutdown();
        }
    }
}
