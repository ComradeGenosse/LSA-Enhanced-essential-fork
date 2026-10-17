using System;
using System.Collections.Generic;
using System.Linq;
using Rage;
using Rage.Native;

namespace LSA.Intelligence
{
    // Owner-fiber observations only. A social scene is native evidence of
    // shared presence/activity, not permission to speak. C-06 and the Core
    // player/Essential quiet proofs remain independent mandatory gates.
    internal sealed class DirectorSocialScenes
    {
        internal sealed class Scene
        {
            public string Id,Kind,Speaker,Player,Owner,Role,Host;
            public int World,Revision,OwnerRevision,Vehicle;
            public long Created,Expires;
            public string ClaimedTicket;
        }
        sealed class Track
        {
            public string Owner;
            public int Vehicle;
            public bool Near,WasShared,EntryPending;
            public string Activity;
            public long NearSince,IdleSince,TripSince,LastSeen,LastSharedExit;
            public long LastTransition=-90000;
            public long LastGreeting=-600000,LastEntry=-600000,LastIdle=-600000,LastTravel=-600000;
            public int LastEntryVehicle;
            public Rage.Vector3 LastPlayer,LastActor;
            public Scene Current;
        }
        readonly Func<long> clock;
        readonly Dictionary<string,Track> actors=new Dictionary<string,Track>();
        readonly Dictionary<string,Scene> scenes=new Dictionary<string,Scene>();
        public DirectorSocialScenes(Func<long> clock){this.clock=clock;}
        public void Reset(){actors.Clear();scenes.Clear();}
        public void Retire(string owner){
            foreach(var key in actors.Where(x=>x.Value.Owner==owner).Select(x=>x.Key).ToArray())
                actors.Remove(key);
            foreach(var key in scenes.Where(x=>x.Value.Owner==owner).Select(x=>x.Key).ToArray())
                scenes.Remove(key);
        }
        static bool Live(Ped ped)=>ped!=null && ped.Exists() && !ped.IsDead;
        static int VehicleHandle(Ped ped){
            try{var car=ped.CurrentVehicle;return car!=null&&car.Exists()?car.Handle:0;}
            catch{return 0;}
        }
        static string Role(Ped actor,Ped player,int handle) {
            if(handle==0)return "none";
            try{
                var car=player.CurrentVehicle;
                if(car==null || !car.Exists() || car.Handle!=handle)return "unknown";
                var driver=NativeFunction.CallByName<int>("GET_PED_IN_VEHICLE_SEAT",car,-1);
                return driver==actor.Handle?"driver":driver==player.Handle?"passenger":"unknown";
            }catch{return "unknown";}
        }
        Scene Emit(Track track,string kind,string speaker,string player,string owner,
                   int revision,string host,int world,int vehicle,string role,long now) {
            var scene=new Scene{
                Id=Guid.NewGuid().ToString("D"),Kind=kind,Speaker=speaker,Player=player,
                Owner=owner,OwnerRevision=revision,Host=host,World=world,
                Role=role,Vehicle=vehicle,Revision=1,Created=now,Expires=now+10000
            };
            track.Current=scene;scenes[scene.Id]=scene;return scene;
        }
        public object[] Sample(IEnumerable<EntityAnchor> current,
              IEnumerable<OwnedParticipant> roster,string host,int world,uint gameTick) {
            var now=clock(),output=new List<object>();
            foreach(var id in scenes.Where(x=>x.Value.Expires<=now).Select(x=>x.Key).ToArray())
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
                var actorCar=VehicleHandle(ped),playerCar=VehicleHandle(playerPed);
                var sharedCar=actorCar!=0&&actorCar==playerCar;
                var near=distance<=16 || sharedCar;
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
                if(sharedCar && track.EntryPending && now-track.TripSince>=700 &&
                   now-track.LastEntry>=20000 &&
                   (track.LastEntryVehicle!=actorCar || now-track.LastEntry>=90000)) {
                    kind="shared_vehicle_entry";track.LastEntry=now;track.LastEntryVehicle=actorCar;
                    track.EntryPending=false;
                }
                if(kind==null && near && !sharedCar && now-track.NearSince>=1200 &&
                   now-track.LastGreeting>=300000 && track.LastGreeting<track.NearSince) {
                    kind="reunion";track.LastGreeting=now;
                }
                if(kind==null && near && !sharedCar &&
                   now-track.IdleSince>=40000 && now-track.LastIdle>=120000) {
                    kind="shared_idle";track.LastIdle=now;track.IdleSince=now;
                }
                if(kind==null && sharedCar &&
                   now-track.TripSince>=45000 && now-track.LastTravel>=150000) {
                    kind="travel";track.LastTravel=now;
                }
                if(kind==null && near && !sharedCar && track.Activity!=null &&
                   track.Activity!=state.Mode && now-track.LastTransition>=90000 &&
                   (state.Mode=="follow" || state.Mode=="wait")) {
                    kind="activity_transition";track.LastTransition=now;
                }
                track.Activity=state.Mode;
                track.WasShared=sharedCar;track.Vehicle=actorCar;
                track.LastSeen=now;track.LastActor=ped.Position;track.LastPlayer=playerPed.Position;
                // Existing scene remains admissible only while its source
                // relation (same vehicle or physical proximity) is current.
                if(track.Current!=null) {
                    var valid=track.Current.Vehicle!=0?sharedCar&&actorCar==track.Current.Vehicle:near&&!sharedCar;
                    if(!valid || track.Current.OwnerRevision!=state.Revision) {
                        scenes.Remove(track.Current.Id);track.Current=null;
                    }
                }
                if(kind==null)continue;
                var scene=Emit(track,kind,anchor.CaptureRef,playerAnchor.CaptureRef,
                    owner.Lifetime,state.Revision,host,world,actorCar,
                    Role(ped,playerPed,actorCar),now);
                output.Add(new {
                    socialVersion=1,hostRunId=host,worldEpoch=world,sampledGameTick=gameTick,
                    sceneId=scene.Id,sceneType=scene.Kind,speakerCaptureRef=scene.Speaker,
                    playerCaptureRef=scene.Player,ownerIncarnationId=scene.Owner,
                    ownerProofRevision=scene.OwnerRevision,role=scene.Role
                });
            }
            foreach(var key in actors.Where(x=>x.Value.LastSeen<now-30000).Select(x=>x.Key).ToArray())
                actors.Remove(key);
            return output.ToArray();
        }
        public bool Current(DirectorAdmission.Request request) {
            if(request==null || string.IsNullOrEmpty(request.DecisionKey) ||
               !request.DecisionKey.StartsWith("social:",StringComparison.Ordinal))return false;
            Scene scene;
            if(!scenes.TryGetValue(request.ObservationId??"",out scene) ||
               scene.Expires<=clock() || scene.ClaimedTicket!=null &&
               scene.ClaimedTicket!=request.TicketId)return false;
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
            scene.ClaimedTicket=request.TicketId;return true;
        }
    }
}
