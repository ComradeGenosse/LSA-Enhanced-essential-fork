using System;
using System.Collections.Generic;
using System.Linq;
using Rage;

namespace LSA.Intelligence
{
    // Owner-fiber observations only. A social scene is native evidence of
    // shared presence/activity, not permission to speak. C-06 and the Core
    // player/Essential quiet proofs remain independent mandatory gates.
    internal sealed class DirectorSocialScenes
    {
        internal sealed class Scene
        {
            public string Id,Kind,Speaker,Player,Owner,Role,Host,Vehicle;
            public int World,Revision,OwnerRevision;
            public long Created,Expires,ClaimedAt;
            public string ClaimedTicket;
        }
        sealed class Track
        {
            public string Owner;
            public string Vehicle;
            public bool Near,WasShared,EntryPending;
            public string Activity;
            public long NearSince,IdleSince,TripSince,LastSeen,LastSharedExit,NextPublish;
            public long LastTransition=-90000,LastPlayerTurnVersion=-1,LastInteraction=-600000;
            public long LastGreeting=-600000,LastEntry=-600000,LastIdle=-600000,LastTravel=-600000,LastCuriosity=-600000;
            public string LastEntryVehicle;
            public Rage.Vector3 LastPlayer,LastActor;
            public Scene Current;
        }
        readonly Func<long> clock;
        readonly bool testing;
        readonly Dictionary<string,Track> actors=new Dictionary<string,Track>();
        readonly Dictionary<string,Scene> scenes=new Dictionary<string,Scene>();
        public DirectorSocialScenes(Func<long> clock,bool testing=false){this.clock=clock;this.testing=testing;}
        public void Reset(){actors.Clear();scenes.Clear();}
        public void Retire(string owner){
            foreach(var key in actors.Where(x=>x.Value.Owner==owner).Select(x=>x.Key).ToArray())
                actors.Remove(key);
            foreach(var key in scenes.Where(x=>x.Value.Owner==owner).Select(x=>x.Key).ToArray())
                scenes.Remove(key);
        }
        static bool Live(Ped ped)=>ped!=null && ped.Exists() && !ped.IsDead;
        static string VehicleHandle(Ped ped){
            try{var car=ped.CurrentVehicle;return car!=null&&car.Exists()?car.Handle.ToString():null;}
            catch{return null;}
        }
        static string Role(Ped actor,Ped player,string handle) {
            if(handle==null)return "none";
            try{
                var car=player.CurrentVehicle;
                if(car==null || !car.Exists() || car.Handle.ToString()!=handle)return "unknown";
                var driver=car.Driver;
                return driver!=null && driver.Exists() &&
                    (driver.Handle==actor.Handle && driver.MemoryAddress==actor.MemoryAddress)
                    ?"driver":driver!=null && driver.Exists() &&
                    (driver.Handle==player.Handle && driver.MemoryAddress==player.MemoryAddress)
                    ?"passenger":"unknown";
            }catch{return "unknown";}
        }
        Scene Emit(Track track,string kind,string speaker,string player,string owner,
                   int revision,string host,int world,string vehicle,string role,long now) {
            var scene=new Scene{
                Id=Guid.NewGuid().ToString("D"),Kind=kind,Speaker=speaker,Player=player,
                Owner=owner,OwnerRevision=revision,Host=host,World=world,
                Role=role,Vehicle=vehicle,Revision=1,Created=now,Expires=now+15000
            };
            if(track.Current!=null)scenes.Remove(track.Current.Id);
            track.Current=scene;track.NextPublish=now;scenes[scene.Id]=scene;return scene;
        }
        public object[] Sample(IEnumerable<EntityAnchor> current,
              IEnumerable<OwnedParticipant> roster,string host,int world,uint gameTick,long playerTurnVersion=-1) {
            var now=clock();var output=new List<object>();
            foreach(var id in scenes.Where(x=>x.Value.ClaimedTicket==null?
                x.Value.Expires<=now : now-x.Value.ClaimedAt>120000).Select(x=>x.Key).ToArray())
                scenes.Remove(id);
            var live=current.ToArray();
            var playerAnchor=live.FirstOrDefault(a=>a.Kind=="player");
            var playerPed=playerAnchor?.Entity as Ped;
            if(!Live(playerPed)){Reset();return output.ToArray();}
            foreach(var anchor in live.Where(a=>a.Kind=="ped" && a.OwnerLifetime!=null && a.Observer).Take(16)) {
                var ped=anchor.Entity as Ped;
                if(!Live(ped))continue;
                var owner=roster.FirstOrDefault(o=>o!=null&&o.Ped!=null&&
                    o.Lifetime==anchor.OwnerLifetime&&o.Ped.Handle==ped.Handle&&o.Current?.Invoke()==true);
                if(owner==null)continue;
                var state=owner.DirectorOwner?.Invoke();
                if(state==null||state.Suspended||state.Revision<=0)continue;
                Track track;
                if(!actors.TryGetValue(anchor.CaptureRef,out track) || track.Owner!=owner.Lifetime) {
                    track=new Track{Owner=owner.Lifetime,NearSince=now,IdleSince=now,TripSince=now};
                    actors[anchor.CaptureRef]=track;
                }
                double distance;
                try{distance=ped.Position.DistanceTo(playerPed.Position);}catch{continue;}
                string actorCar=VehicleHandle(ped),playerCar=VehicleHandle(playerPed);
                var sharedCar=actorCar!=null&&actorCar==playerCar;
                var near=distance<=16 || sharedCar;
                if(playerTurnVersion>=0) {
                    if(track.LastPlayerTurnVersion>=0 &&
                       playerTurnVersion!=track.LastPlayerTurnVersion) {
                        track.IdleSince=now;track.LastInteraction=now;
                    }
                    track.LastPlayerTurnVersion=playerTurnVersion;
                }
                var movement=track.LastSeen>0 && track.LastSeen>=now-1200 &&
                    (ped.Position.DistanceTo(track.LastActor)>0.3f ||
                     playerPed.Position.DistanceTo(track.LastPlayer)>0.3f);
                if(!sharedCar && track.WasShared)track.LastSharedExit=now;
                if(sharedCar && !track.WasShared) {
                    track.TripSince=now;track.EntryPending=true;
                }
                if(!near){track.Near=false;track.NearSince=now;track.IdleSince=now;}
                else if(!track.Near){track.Near=true;track.NearSince=now;track.IdleSince=now;}
                if(movement||sharedCar||!near)track.IdleSince=now;
                string kind=null;
                // Boarding is an edge, not a per-tick prompt. Brief re-entry
                // into the same vehicle never creates a second opening.
                if(sharedCar && track.EntryPending && now-track.TripSince>=(testing?400:700) &&
                   now-track.LastEntry>=(testing?5000:20000) &&
                   (track.LastEntryVehicle!=actorCar || now-track.LastEntry>=(testing?25000:90000))) {
                    kind="shared_vehicle_entry";track.LastEntry=now;track.LastEntryVehicle=actorCar;
                    track.EntryPending=false;
                }
                if(kind==null && near && !sharedCar && now-track.NearSince>=(testing?600:1200) &&
                   now-track.LastGreeting>=(testing?30000:300000) && track.LastGreeting<track.NearSince) {
                    kind="reunion";track.LastGreeting=now;
                }
                if(kind==null && near && !sharedCar &&
                   now-track.IdleSince>=(testing?10000:40000) &&
                   now-track.LastIdle>=(testing?30000:120000)) {
                    kind="shared_idle";track.LastIdle=now;track.IdleSince=now;
                }
                if(kind==null && sharedCar &&
                   now-track.TripSince>=(testing?15000:45000) &&
                   now-track.LastTravel>=(testing?45000:150000)) {
                    kind="travel";track.LastTravel=now;
                }
                if(kind==null && near && now-track.NearSince>=(testing?30000:95000) &&
                   now-track.LastInteraction>=(testing?10000:25000) &&
                   now-track.LastCuriosity>=(testing?90000:240000)) {
                    kind="personal_curiosity";track.LastCuriosity=now;
                }
                if(kind==null && near && !sharedCar && track.Activity!=null &&
                   track.Activity!=state.Mode && now-track.LastTransition>=(testing?30000:90000) &&
                   (state.Mode=="follow" || state.Mode=="wait")) {
                    kind="activity_transition";track.LastTransition=now;
                }
                track.Activity=state.Mode;
                track.WasShared=sharedCar;track.Vehicle=actorCar;
                track.LastSeen=now;track.LastActor=ped.Position;track.LastPlayer=playerPed.Position;
                // Existing scene remains admissible only while its source
                // relation (same vehicle or physical proximity) is current.
                if(track.Current!=null) {
                    var valid=track.Current.Vehicle!=null?sharedCar&&actorCar==track.Current.Vehicle:near&&!sharedCar;
                    if(!valid || track.Current.Expires<=now &&
                       (track.Current.ClaimedTicket==null ||
                        now-track.Current.ClaimedAt>120000) ||
                       track.Current.OwnerRevision!=state.Revision) {
                        scenes.Remove(track.Current.Id);track.Current=null;
                    }
                }
                if(kind!=null)Emit(track,kind,anchor.CaptureRef,playerAnchor.CaptureRef,
                    owner.Lifetime,state.Revision,host,world,actorCar,
                    Role(ped,playerPed,actorCar),now);
                // A native social frame may arrive just before the companion
                // receives the fresh observer situation. Replay the SAME
                // source scene ID at a bounded cadence, never create a
                // second opportunity or a second speech ticket.
                if(track.Current!=null && track.Current.ClaimedTicket==null &&
                   now>=track.NextPublish) {
                    output.Add(Frame(track.Current,gameTick));
                    track.NextPublish=now+1000;
                }
            }
            foreach(var key in actors.Where(x=>x.Value.LastSeen<now-30000).Select(x=>x.Key).ToArray())
                actors.Remove(key);
            return output.ToArray();
        }
        static object Frame(Scene scene,uint gameTick)=>new {
            socialVersion=1,hostRunId=scene.Host,worldEpoch=scene.World,
            sampledGameTick=gameTick,sceneId=scene.Id,sceneType=scene.Kind,
            speakerCaptureRef=scene.Speaker,playerCaptureRef=scene.Player,
            ownerIncarnationId=scene.Owner,ownerProofRevision=scene.OwnerRevision,
            role=scene.Role
        };
        // Explicit user debug invitation uses the identical scene ledger and
        // native C-06/Essential stock path as automatic opportunities. The
        // current Essential-selected promoted NPC, not arbitrary user-supplied
        // PedId or character text, determines the receiver.
        public object Manual(IEnumerable<EntityAnchor> current,
            IEnumerable<OwnedParticipant> roster,Ped selected,string host,int world,uint gameTick) {
            var now=clock();
            var player=current.FirstOrDefault(a=>a.Kind=="player");
            var local=player?.Entity as Ped;
            if(!Live(selected) || !Live(local) ||
               selected.Position.DistanceTo(local.Position)>20)return null;
            var anchor=current.FirstOrDefault(a=>a.Kind=="ped" && a.Observer &&
                a.OwnerLifetime!=null && a.Entity is Ped ped &&
                ped.Handle==selected.Handle && ped.MemoryAddress==selected.MemoryAddress);
            if(anchor==null)return null;
            var owner=roster.FirstOrDefault(o=>o!=null && o.Current?.Invoke()==true &&
                o.Ped!=null && o.Ped.Handle==selected.Handle &&
                o.Ped.MemoryAddress==selected.MemoryAddress &&
                o.Lifetime==anchor.OwnerLifetime);
            var state=owner?.DirectorOwner?.Invoke();
            if(state==null || state.Suspended || state.Revision<=0)return null;
            Track track;
            if(!actors.TryGetValue(anchor.CaptureRef,out track) || track.Owner!=owner.Lifetime) {
                track=new Track{Owner=owner.Lifetime,Near=true,NearSince=now,IdleSince=now,TripSince=now};
                actors[anchor.CaptureRef]=track;
            }
            // Explicit user action can initiate a fresh opportunity, but a
            // duplicate click cannot queue overlapping native scenes.
            if(track.Current!=null && track.Current.Expires>now &&
               track.Current.Kind=="manual")return null;
            string car=VehicleHandle(selected),playerCar=VehicleHandle(local);
            var shared=car!=null && car==playerCar;
            var scene=Emit(track,"manual",anchor.CaptureRef,player.CaptureRef,
                owner.Lifetime,state.Revision,host,world,shared?car:null,
                Role(selected,local,shared?car:null),now);
            return Frame(scene,gameTick);
        }
        public bool Current(DirectorAdmission.Request request) {
            if(request==null || string.IsNullOrEmpty(request.DecisionKey) ||
               !request.DecisionKey.StartsWith("social:",StringComparison.Ordinal))return false;
            Scene scene;
            if(!scenes.TryGetValue(request.ObservationId??"",out scene) ||
               scene.ClaimedTicket==null && scene.Expires<=clock() ||
               scene.ClaimedTicket!=null &&
               (scene.ClaimedTicket!=request.TicketId ||
                clock()-scene.ClaimedAt>120000))return false;
            return request.DecisionKey=="social:"+scene.Id &&
               request.ObservationRevision==scene.Revision &&
               request.SpeakerCaptureRef==scene.Speaker &&
               request.PlayerCaptureRef==scene.Player &&
               request.OwnerIncarnationId==scene.Owner &&
               request.ProofRevision==scene.OwnerRevision &&
               request.HostRunId==scene.Host && request.WorldEpoch==scene.World;
        }
        public bool Claim(DirectorAdmission.Request request) {
            if(!Current(request))return false;
            var scene=scenes[request.ObservationId];
            if(scene.ClaimedTicket!=null)return false;
            scene.ClaimedTicket=request.TicketId;scene.ClaimedAt=clock();return true;
        }
    }
}
