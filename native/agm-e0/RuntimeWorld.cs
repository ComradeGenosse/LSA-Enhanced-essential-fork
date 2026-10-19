using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Rage;
using Rage.Native;

namespace LSA.AGM.E0
{
    internal sealed class LabRuntime : IDisposable
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer {MaxJsonLength=512*1024};
        private const string PedName="a_m_m_business_01", VehicleName="asea", PropName="prop_cs_cardbox_01";
        private const string PickupName="PICKUP_HEALTH_STANDARD";
        private readonly string folder,logPath,journalPath;
        private readonly Stopwatch clock=Stopwatch.StartNew();
        private readonly StreamWriter writer;
        private Lease active;
        private uint lastSample, lastOperation, lastWorldTime, samples;
        private int spawnRound, spawnSuccess, spawnTotal, nativeWrites;
        private long sampleTicks, sampleMaxTicks, logBytes;
        private bool disposed, halted, journalRisk;
        private int cleanupFailures;
        private readonly int processId=Process.GetCurrentProcess().Id;
        private readonly long processStartUtc=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks;
        private string site="terminal", condition="essential_off", task="walk", day="day", nathan="absent";
        private string lastSensor="unknown";
        private readonly EssentialDomain essential;
        public readonly string RunId=Guid.NewGuid().ToString("N");
        private readonly string Epoch=Guid.NewGuid().ToString("N");
        public LabRuntime(string path, EntryPoint.Settings settings)
        {
            folder=path;Directory.CreateDirectory(folder);
            Directory.CreateDirectory(Path.Combine(folder,"logs"));
            logPath=Path.Combine(folder,"logs","agm-e0-"+DateTime.UtcNow.ToString("yyyyMMddTHHmmss")+"-"+RunId.Substring(0,8)+".jsonl");
            journalPath=Path.Combine(folder,"active-lease.json");
            writer=new StreamWriter(new FileStream(logPath,FileMode.CreateNew,FileAccess.Write,FileShare.Read),new UTF8Encoding(false)){AutoFlush=true};
            essential=new EssentialDomain(folder);
            lastWorldTime=unchecked((uint)Game.GameTime);
            Recovery();
            Log("environment",new { hostRunId=RunId,worldEpoch=Epoch,gameMs=Game.GameTime,
                process=Process.GetCurrentProcess().MainModule.FileName,
                version=FileVersionInfo.GetVersionInfo(Process.GetCurrentProcess().MainModule.FileName).FileVersion,
                essential=essential.Status, journalRisk });
        }
        public void Print(string message) {try {Game.Console.Print("[AGM-E0] "+message);}catch{} try {Game.LogTrivial("[AGM-E0] "+message);}catch{}}
        private object Stamp(object payload) => new {utc=DateTime.UtcNow.ToString("O"),hostRunId=RunId,worldEpoch=Epoch,
            gameMs=Game.GameTime,probe=active?.Probe,site,day,nathan,condition,task,payload};
        public void Log(string evt,object data)
        {
            if(disposed||halted)return;
            try {
                var json=Serializer.Serialize(new {type=evt,record=Stamp(data)});
                logBytes+=Encoding.UTF8.GetByteCount(json)+1;
                if(logBytes>Limits.MaxLogBytes) {Print("Log budget exceeded; cancelling.");Stop("log_budget");halted=true;return;}
                writer.WriteLine(json);
            }catch {halted=true; }
        }
        public void Fail(string reason,Exception ex) {Log("error",new {reason,type=ex.GetType().Name,message=ex.Message});}
        private static bool Scripted()
        {
            try {return NativeFunction.CallByName<bool>("GET_MISSION_FLAG") ||
                NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") ||
                NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING") ||
                NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") ||
                NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE");}
            catch{return true;}
        }
        private static uint Hash(string label) => NativeFunction.CallByName<uint>("GET_HASH_KEY",label);
        public void SetSite(string x) {if(Limits.Site(x)){site=x;Print("site="+site+" (operator-declared; not GPS-verified)");}else Print("Unknown site.");}
        public void SetCondition(string x) {if(Limits.Condition(x)){condition=x;Print("condition="+condition);}else Print("Unknown condition.");}
        public void SetTask(string x) {if(Limits.Task(x)){task=x;Print("task="+task);}else Print("Unknown task.");}
        public void SetDay(string x) {if(x=="day"||x=="night"){day=x;Print("day="+day);}else Print("day|night only");}
        public void SetNathan(string x) {if(x=="present"||x=="absent"){nathan=x;Print("nathan="+nathan+" (manual observation)");}else Print("present|absent only");}
        public void Status()
        {
            Print("active="+(active?.Probe??"none")+" ownerEntities="+(active?.Entities.Count??0)+
                " writes="+nativeWrites+" samples="+samples+" essential="+essential.Status+
                " log="+logPath+" journalRisk="+journalRisk+" halted="+halted);
        }
        private static bool Same(Owned e,Entity entity)
        {
            try {return entity!=null && entity.Exists() && entity.Handle==e.Handle &&
                entity.MemoryAddress.ToInt64()==e.Address && (uint)entity.Model.Hash==e.Model;}
            catch {return false;}
        }
        private static Vector3 Offscreen()
        {
            var player=Game.LocalPlayer.Character;
            if(player==null || !player.Exists())throw new InvalidOperationException("player_unavailable");
            var shifts=new[]{new Vector3(0,-60,0),new Vector3(-65,-45,0),new Vector3(65,-45,0),
                new Vector3(0,75,0)};
            foreach(var shift in shifts) {
                var candidate=player.GetOffsetPosition(shift);
                float? ground=World.GetGroundZ(candidate,true,false);
                if(!ground.HasValue || Math.Abs(ground.Value-candidate.Z)>20)continue;
                candidate.Z=ground.Value+0.25f;
                if(NativeFunction.CallByName<bool>("IS_SPHERE_VISIBLE",candidate.X,candidate.Y,candidate.Z,4f))continue;
                return candidate;
            }
            throw new InvalidOperationException("no_verified_offscreen_ground");
        }
        private static Model SafeModel(string name,string kind)
        {
            var model=new Model(Hash(name));
            if(!model.IsValid)throw new InvalidOperationException("invalid_model:"+kind);
            if(kind=="ped"&&!model.IsPed || kind=="vehicle"&&!model.IsVehicle)
                throw new InvalidOperationException("wrong_model_class:"+kind);
            return model;
        }
        private void Record(Owned e)
        {
            if(active==null || !Limits.CanAdd(active,e.Kind))throw new InvalidOperationException("lease_capacity");
            if(active.Entities.ContainsKey(e.Handle))throw new InvalidOperationException("duplicate_handle");
            active.Entities.Add(e.Handle,e);Journal();
            Log("create",new {e.Kind,e.Role,e.Handle,e.Model,e.CreatedGameMs,e.Incarnation,e.Persistent});
        }
        private Owned Register(Entity entity,string kind,string role)
        {
            if(entity==null||!entity.Exists()||entity.MemoryAddress==IntPtr.Zero)
                throw new InvalidOperationException("readback_failed");
            var e=new Owned{Handle=entity.Handle,Address=entity.MemoryAddress.ToInt64(),Model=(uint)entity.Model.Hash,
                CreatedGameMs=unchecked((uint)Game.GameTime),Kind=kind,Role=role,
                Token=Guid.NewGuid().ToString("N"),Persistent=true,
                StartX=entity.Position.X,StartY=entity.Position.Y,StartZ=entity.Position.Z};
            entity.IsPersistent=true;
            if(!entity.Exists()||(uint)entity.Model.Hash!=e.Model)
                throw new InvalidOperationException("model_readback_failed");
            Record(e);return e;
        }
        private Vector3 ScatteredPosition()
        {
            var origin=Offscreen();
            int index=active?.Entities.Count??0;
            var x=origin.X+((index%4)-1.5f)*6f;
            var y=origin.Y+(index/4)*6f;
            var candidate=new Vector3(x,y,origin.Z);
            var ground=World.GetGroundZ(candidate,true,false);
            if(!ground.HasValue)throw new InvalidOperationException("scatter_ground_missing");
            candidate.Z=ground.Value+0.25f;
            if(NativeFunction.CallByName<bool>("IS_SPHERE_VISIBLE",candidate.X,candidate.Y,candidate.Z,3f))
                throw new InvalidOperationException("scatter_visible");
            return candidate;
        }
        private Owned MakePed(string role,Vector3? position=null)
        {
            if(!Limits.CanAdd(active,"ped")) throw new InvalidOperationException("ped_budget");
            var p=position??ScatteredPosition();
            Ped ped=null;
            try{
                ped=new Ped(SafeModel(PedName,"ped"),p,0f);
                if(Scripted())throw new InvalidOperationException("world_changed_while_spawning");
                return Register(ped,"ped",role);
            }catch{try{if(ped!=null&&ped.Exists())ped.Delete();}catch{}throw;}
        }
        private Owned MakeVehicle(string role,Vector3? position=null)
        {
            if(!Limits.CanAdd(active,"vehicle"))throw new InvalidOperationException("vehicle_budget");
            var p=position??ScatteredPosition();
            p=World.GetNextPositionOnStreet(p);
            if(NativeFunction.CallByName<bool>("IS_SPHERE_VISIBLE",p.X,p.Y,p.Z,4f))
                throw new InvalidOperationException("vehicle_site_visible");
            Vehicle car=null;
            try {
                car=new Vehicle(SafeModel(VehicleName,"vehicle"),p,0f);
                if(Scripted())throw new InvalidOperationException("world_changed_while_spawning");
                return Register(car,"vehicle",role);
            }catch{try{if(car!=null&&car.Exists())car.Delete();}catch{}throw;}
        }
        private Owned MakeProp(string role)
        {
            if(!Limits.CanAdd(active,"prop"))throw new InvalidOperationException("prop_budget");
            Rage.Object item=null;
            try {
                item=new Rage.Object(SafeModel(PropName,"prop"),ScatteredPosition());
                if(Scripted())throw new InvalidOperationException("world_changed_while_spawning");
                return Register(item,"prop",role);
            }catch{try{if(item!=null&&item.Exists())item.Delete();}catch{}throw;}
        }
        private Owned MakePickup(string role)
        {
            if(!Limits.CanAdd(active,"pickup"))throw new InvalidOperationException("pickup_budget");
            var p=ScatteredPosition();int handle=0;
            try {
                handle=NativeFunction.CallByName<int>("CREATE_PICKUP",Hash(PickupName),p.X,p.Y,p.Z,0,1,true,Hash(PropName));
                if(handle==0 || !NativeFunction.CallByName<bool>("DOES_PICKUP_EXIST",handle))
                    throw new InvalidOperationException("pickup_readback_failed");
                var e=new Owned{Handle=handle,Address=0,Model=Hash(PickupName),
                    CreatedGameMs=unchecked((uint)Game.GameTime),Kind="pickup",Role=role,
                    Token=Guid.NewGuid().ToString("N"),Persistent=true,
                    StartX=p.X,StartY=p.Y,StartZ=p.Z};
                Record(e);return e;
            }catch {if(handle!=0)try{NativeFunction.CallByName<int>("REMOVE_PICKUP",handle);}catch{}throw;}
        }
        private Entity Find(Owned e)
        {
            try {
                if(e.Kind=="ped")return World.GetAllPeds().FirstOrDefault(x=>Same(e,x));
                if(e.Kind=="vehicle")return World.GetAllVehicles().FirstOrDefault(x=>Same(e,x));
                if(e.Kind=="prop")return World.GetAllObjects().FirstOrDefault(x=>Same(e,x));
            }catch{}
            return null;
        }
        private Ped PedFor(Owned e)=>Find(e) as Ped;
        private Vehicle VehicleFor(Owned e)=>Find(e) as Vehicle;
        private void TaskOwned(Owned actor,string policy,Owned target=null,Owned vehicle=null)
        {
            if(active==null||actor==null||actor.Kind!="ped"||
                !Limits.Owns(active,actor.Handle,actor.Address,actor.Model,actor.CreatedGameMs))
                throw new InvalidOperationException("task_target_not_owned");
            var ped=PedFor(actor);
            if(ped==null)throw new InvalidOperationException("actor_incarnation_lost");
            if(target!=null&&!Limits.Owns(active,target.Handle,target.Address,target.Model,target.CreatedGameMs))
                throw new InvalidOperationException("foreign_target");
            if(vehicle!=null&&!Limits.Owns(active,vehicle.Handle,vehicle.Address,vehicle.Model,vehicle.CreatedGameMs))
                throw new InvalidOperationException("foreign_vehicle");
            if(Scripted())throw new InvalidOperationException("scripted_world");
            var destination=ped.Position+new Vector3(12f,0f,0f);
            switch(policy){
                case "walk":
                    NativeFunction.CallByName<int>("TASK_FOLLOW_NAV_MESH_TO_COORD",ped,destination.X,destination.Y,destination.Z,1.5f,-1,0.5f,false,0f);break;
                case "guard":
                    NativeFunction.CallByName<int>("TASK_GUARD_CURRENT_POSITION",ped,15f,15f,true);break;
                case "flee":
                    if(target==null||PedFor(target)==null)throw new InvalidOperationException("target_missing");
                    NativeFunction.CallByName<int>("TASK_SMART_FLEE_PED",ped,PedFor(target),50f,-1,false,false);break;
                case "follow":
                    if(target==null||PedFor(target)==null)throw new InvalidOperationException("target_missing");
                    NativeFunction.CallByName<int>("TASK_FOLLOW_TO_OFFSET_OF_ENTITY",ped,PedFor(target),0f,-3f,0f,1.2f,-1,3f,true);break;
                case "combat":
                    if(target==null||PedFor(target)==null)throw new InvalidOperationException("target_missing");
                    NativeFunction.CallByName<int>("GIVE_WEAPON_TO_PED",ped,Hash("WEAPON_PISTOL"),48,false,true);
                    NativeFunction.CallByName<int>("TASK_COMBAT_PED",ped,PedFor(target),0,16);break;
                case "drive":
                    if(vehicle==null||VehicleFor(vehicle)==null)throw new InvalidOperationException("vehicle_missing");
                    NativeFunction.CallByName<int>("SET_PED_INTO_VEHICLE",ped,VehicleFor(vehicle),-1);
                    NativeFunction.CallByName<int>("TASK_VEHICLE_DRIVE_TO_COORD_LONGRANGE",ped,VehicleFor(vehicle),
                        destination.X+40,destination.Y+40,destination.Z,14f,786603,8f);break;
                case "chase":
                    if(vehicle==null||target==null||VehicleFor(vehicle)==null||PedFor(target)==null)
                        throw new InvalidOperationException("chase_refs_missing");
                    NativeFunction.CallByName<int>("SET_PED_INTO_VEHICLE",ped,VehicleFor(vehicle),-1);
                    NativeFunction.CallByName<int>("TASK_VEHICLE_CHASE",ped,PedFor(target));break;
                default:throw new InvalidOperationException("task_not_allowlisted");
            }
            actor.Task=policy; nativeWrites++;
            Log("task_issued",new{handle=actor.Handle,incarnation=actor.Incarnation,policy,
                target=target?.Handle,vehicle=vehicle?.Handle,essential=essential.Status});
            Journal();
        }
        public void Run(string name)
        {
            if(halted||journalRisk){Print("Runtime blocked by halt or unresolved orphan journal. Restart GTA or inspect/recover first.");return;}
            var denial=Limits.Deny(name,condition,site,true,Scripted(),active!=null);
            if(denial!=null){Print("DENIED "+denial);Log("denied",new{probe=name,denial});return;}
            if(condition=="essential_off" && essential.IsLoaded){
                Print("DENIED: Essential is loaded. essential_off requires Essential unloaded.");return;
            }
            if(condition!="essential_off" && !essential.Available){
                Print("DENIED: Essential bridge unavailable. Cannot claim yield comparison.");return;
            }
            if(condition=="yield_on"&&!essential.CanYield) {
                Print("DENIED: pinned Essential probe not ready. No unverified yield control.");return;
            }
            var player=Game.LocalPlayer.Character;
            if(player==null||!player.Exists()||player.IsDead){Print("DENIED player unavailable");return;}
            if(name=="e0.4" && nathan=="present"){
                Print("DENIED E0.4 live hostility with Nathan present. Test absent first.");return;
            }
            active=new Lease{Probe=name,Condition=condition,Site=site,RunId=RunId,Epoch=Epoch,
                StartedUtc=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),StartedGameMs=unchecked((uint)Game.GameTime)};
            spawnRound=spawnSuccess=spawnTotal=nativeWrites=0;samples=0;sampleTicks=sampleMaxTicks=0;
            lastSample=lastOperation=unchecked((uint)Game.GameTime);
            Log("probe_start",new{durationMs=Duration(),siteLabelOnly=true,lighting=day,nathanPresence=nathan,
                essential=essential.Status,gameVersion=FileVersionInfo.GetVersionInfo(Process.GetCurrentProcess().MainModule.FileName).FileVersion});
            try {
                if(name=="e0.1") { /* sequential bounded creation/readback in Tick */ }
                else if(name=="e0.2"||name=="e0.6") SetupTask(false);
                else if(name=="e0.3") SetupPersistence();
                else if(name=="e0.4") SetupTask(true);
                else if(name=="e0.5"){MakePed("area_subject");MakeVehicle("vehicle_subject");MakePickup("pickup_subject");}
                else if(name=="e0.7"){MakePed("cleanup_subject");MakeVehicle("cleanup_vehicle");MakeProp("cleanup_prop");}
                else if(name=="e0.8") SetupCapacity();
                Journal();Print("Started "+name+" / "+task+" / "+condition+". Use AGME0Cancel at any time.");
            }catch(Exception ex){Fail("setup_failed",ex);Stop("setup_failed");}
        }
        private int Duration()=>active?.Probe=="e0.3"?Limits.PersistenceDurationMs:
            active?.Probe=="e0.1"?50000:Limits.TaskDurationMs;
        private void SetupTask(bool hostile)
        {
            var actor=MakePed("actor");
            var target=(hostile||task=="flee"||task=="follow"||task=="combat"||task=="chase")?MakePed("opponent"):null;
            Owned car=(task=="drive"||task=="chase")?MakeVehicle("actor_vehicle"):null;
            if(hostile && task!="combat") throw new InvalidOperationException("e0.4_select_combat");
            if(condition!="essential_off"){
                var applied=essential.Yield(actor.Handle,actor.Address,actor.Model,condition=="yield_on");
                Log("yield_requested",new{actor=actor.Handle,condition,applied,essential=essential.Status});
                if(!applied)throw new InvalidOperationException("essential_yield_not_available");
            }
            TaskOwned(actor,hostile?"combat":task,target,car);
        }
        private void SetupPersistence()
        {
            var p=Game.LocalPlayer.Character.Position;
            foreach(int distance in new[]{100,250,400,800}){
                var position=new Vector3(p.X+distance,p.Y,p.Z);
                // GTA ground/streaming may refuse distant positions. Record failures, never fake persistence.
                try{MakePed("distance_"+distance,position);}catch(Exception ex){Log("spawn_failure",new{distance,error=ex.Message});}
            }
        }
        private void SetupCapacity()
        {
            // E0.8 intentionally exceeds normal per-experience draft (8+4)
            // while respecting the lab global cap (12+6).
            for(int i=0;i<Limits.Peds;i++)try{MakePed("load_ped_"+i);}catch(Exception e){Log("spawn_failure",new{kind="ped",i,error=e.Message});}
            for(int i=0;i<Limits.Vehicles;i++)try{MakeVehicle("load_vehicle_"+i);}catch(Exception e){Log("spawn_failure",new{kind="vehicle",i,error=e.Message});}
        }
        private void SequentialSpawn()
        {
            if(active==null||active.Probe!="e0.1"||spawnRound>=80)return;
            int kind=spawnRound%4;
            string k=kind==0?"ped":kind==1?"vehicle":kind==2?"prop":"pickup";
            spawnRound++;spawnTotal++;
            try {
                if(kind==0)MakePed("spawn_readback");if(kind==1)MakeVehicle("spawn_readback");
                if(kind==2)MakeProp("spawn_readback");if(kind==3)MakePickup("spawn_readback");
                spawnSuccess++;Log("spawn_trial",new{kind=k,round=spawnRound,result="pass"});
            }catch(Exception ex){Log("spawn_trial",new{kind=k,round=spawnRound,result="fail",reason=ex.Message});}
            CleanupOwned("e0.1_iteration");
        }
        private int NavHash(string policy) => policy=="walk"?unchecked((int)0x2A89B8A7u):
            policy=="drive"?unchecked((int)0x21D33957u):0;
        private void Sample(Owned e)
        {
            var entity=Find(e);
            if(e.Kind=="pickup"){
                bool exists=NativeFunction.CallByName<bool>("DOES_PICKUP_EXIST",e.Handle);
                bool collected=NativeFunction.CallByName<bool>("HAS_PICKUP_BEEN_COLLECTED",e.Handle);
                lastSensor=collected?"pickup_collected":"pickup_not_collected";
                Log("sensor",new{e.Handle,e.Incarnation,exists,collected,fluent=lastSensor});
                return;
            }
            if(entity==null) {
                e.Lost=true;Log("entity_lost",new{e.Handle,e.Incarnation,e.Kind});
                return;
            }
            var p=entity.Position;
            int taskStatus=-999;
            if(e.Task!=null&&NavHash(e.Task)!=0)
                try{taskStatus=NativeFunction.CallByName<int>("GET_SCRIPT_TASK_STATUS",entity,NavHash(e.Task));}catch{}
            bool driveable=false, inCombat=false, fleeing=false, alive=true;
            if(e.Kind=="vehicle")try{driveable=NativeFunction.CallByName<bool>("IS_VEHICLE_DRIVEABLE",entity,false);}catch{}
            if(e.Kind=="ped")try{
                inCombat=NativeFunction.CallByName<bool>("IS_PED_IN_COMBAT",entity,0);
                fleeing=NativeFunction.CallByName<bool>("IS_PED_FLEEING",entity);
                alive=!NativeFunction.CallByName<bool>("IS_PED_DEAD_OR_DYING",entity,true);
            }catch{}
            double moved=Math.Sqrt(Math.Pow(p.X-e.StartX,2)+Math.Pow(p.Y-e.StartY,2)+Math.Pow(p.Z-e.StartZ,2));
            var player=Game.LocalPlayer.Character;
            float distance=player!=null&&player.Exists()?Vector3.Distance(player.Position,p):-1f;
            lastSensor=e.Kind=="vehicle"?(driveable?"vehicle_driveable":"vehicle_undriveable"):"entity_exists";
            Log("sample",new{e.Handle,e.Incarnation,e.Kind,e.Role,e.Task,position=new[]{p.X,p.Y,p.Z},moved,
                distance,taskStatus,driveable,inCombat,fleeing,alive,persistent=entity.IsPersistent,
                essential=condition=="essential_off"?"not_loaded":essential.Snapshot(e.Handle)});
        }
        public void Truth(string value)
        {
            if(active?.Probe!="e0.5"){Print("AGME0Truth only during E0.5");return;}
            if(value!="pass"&&value!="fail"&&value!="unknown"){Print("pass|fail|unknown only");return;}
            Log("ground_truth",new {videoLabel=value,observedSensor=lastSensor,
                note="Operator must separately retain video/timecode; never infer truth from game readback."});
            Print("Ground truth label recorded: "+value);
        }
        public void Tick()
        {
            if(disposed||halted)return;
            uint ms=unchecked((uint)Game.GameTime);
            if(ms<lastWorldTime && lastWorldTime-ms>10000) {
                Log("epoch_discontinuity",new{previous=lastWorldTime,current=ms});
                Stop("world_epoch_change");
            }
            lastWorldTime=ms;
            if(active==null)return;
            if(Scripted()){Stop("mission_or_cutscene");return;}
            if(unchecked(ms-lastSample)<Limits.SampleMs)return;
            var watch=Stopwatch.StartNew();
            lastSample=ms;samples++;
            try {
                if(active.Probe=="e0.1"){
                    SequentialSpawn();
                    if(spawnRound>=80){Log("readback_summary",new{trials=spawnTotal,passed=spawnSuccess});Stop("completed");}
                    return;
                }
                foreach(var e in active.Entities.Values.ToArray())Sample(e);
                if(active.Probe=="e0.8")Log("pools",new{pedCapacity=World.PedCapacity,vehicleCapacity=World.VehicleCapacity,
                    objectCapacity=World.ObjectCapacity,actorCount=active.Entities.Count,
                    note="SDK capacities are pool size, not currently free slots"});
                if(active.Probe=="e0.6"||active.Probe=="e0.2"){
                    Log("coexistence",new{essential=essential.Status,sceneWrites=nativeWrites,
                        note="Essential snapshot is best-effort; speech/reflex interference needs log/video comparison"});
                }
                if(samples>Limits.PerProbeSamples){Stop("sample_cap");return;}
                if(unchecked(ms-active.StartedGameMs)>=Duration()) Stop("completed");
            }catch(Exception e){Fail("probe_failure",e);Stop("probe_exception");}
            finally {
                watch.Stop();sampleTicks+=watch.ElapsedTicks;sampleMaxTicks=Math.Max(sampleMaxTicks,watch.ElapsedTicks);
            }
        }
        public void Stop(string reason)
        {
            if(active==null)return;
            var lease=active;
            lease.Cancelled=true;
            cleanupFailures=0;
            Log("probe_stop",new{reason,lease=lease.Id,samples,spawnTotal,spawnSuccess,nativeWrites,
                avgSampleMs=samples==0?0:1000d*sampleTicks/Stopwatch.Frequency/samples,
                maxSampleMs=1000d*sampleMaxTicks/Stopwatch.Frequency});
            CleanupOwned(reason);
            active=null;
            if(cleanupFailures==0) {try {if(File.Exists(journalPath))File.Delete(journalPath);}catch{}}
            else {journalRisk=true;halted=true;}
            Print("Ended "+lease.Probe+" reason="+reason+" cleanupFailures="+cleanupFailures+" (inspect analyzer).");
        }
        private void CleanupOwned(string why)
        {
            if(active==null)return;
            foreach(var e in active.Entities.Values.ToArray().Reverse()){
                bool matched=false,deleted=false;
                try {
                    if(e.Kind=="pickup"){
                        matched=NativeFunction.CallByName<bool>("DOES_PICKUP_EXIST",e.Handle);
                        if(matched)NativeFunction.CallByName<int>("REMOVE_PICKUP",e.Handle);
                        deleted=!NativeFunction.CallByName<bool>("DOES_PICKUP_EXIST",e.Handle);
                    }else{
                        var entity=Find(e);
                        matched=entity!=null;
                        if(matched){entity.Delete();deleted=!entity.Exists();}
                        else if(e.Lost)deleted=true;
                    }
                }catch(Exception ex){Log("cleanup_error",new{e.Handle,why,error=ex.GetType().Name});}
                Log("cleanup",new{e.Handle,e.Incarnation,e.Kind,why,matched,deleted,orphan=!deleted});
                if(deleted)active.Entities.Remove(e.Handle);
                else cleanupFailures++;
                Journal();
            }
        }
        private void Journal()
        {
            if(active==null)return;
            try{
                var temp=journalPath+".tmp";
                File.WriteAllText(temp,Serializer.Serialize(new{runId=RunId,epoch=Epoch,
                    gameMs=Game.GameTime,processId,processStartUtc,lease=active.Id,entities=active.Entities.Values.ToArray()}));
                if(File.Exists(journalPath))File.Delete(journalPath);
                File.Move(temp,journalPath);
            }catch(Exception e){Log("journal_error",new{error=e.GetType().Name});}
        }
        private sealed class PendingJournal
        {
            public string runId,epoch,lease;
            public uint gameMs;
            public int processId;
            public long processStartUtc;
            public Owned[] entities;
        }
        private void Recovery()
        {
            if(!File.Exists(journalPath))return;
            journalRisk=true;
            try {
                var previous=Serializer.Deserialize<PendingJournal>(File.ReadAllText(journalPath));
                if(previous==null||previous.entities==null)throw new InvalidOperationException("invalid_journal");
                bool sameProcess=previous.processId==processId && previous.processStartUtc==processStartUtc;
                bool timeSafe=unchecked((uint)Game.GameTime)>=previous.gameMs;
                if(!sameProcess||!timeSafe||Scripted()) {
                    Log("recovery_refused",new{sameProcess,timeSafe,scripted=Scripted(),count=previous.entities.Length,
                        policy="manual inspection and fresh GTA process required"});
                    return;
                }
                // Handle+native address+model+position+OS process identity must all match.
                // If any element cannot be proven, never delete by numeric handle alone.
                var remaining=new List<Owned>();
                foreach(var e in previous.entities) {
                    bool deleted=false;
                    if(e.Kind!="pickup"){
                        var entity=Find(e);
                        if(entity!=null){
                            var p=entity.Position;
                            double distance=Math.Sqrt(Math.Pow(p.X-e.StartX,2)+Math.Pow(p.Y-e.StartY,2)+Math.Pow(p.Z-e.StartZ,2));
                            if(distance<=200){
                                try{entity.Delete();deleted=!entity.Exists();}catch{}
                            }
                        }
                    }
                    if(!deleted)remaining.Add(e);
                    Log("recovery_sweep",new{e.Handle,e.Incarnation,e.Kind,deleted,mode="same_process_guarded"});
                }
                if(remaining.Count==0){
                    File.Delete(journalPath);journalRisk=false;
                }else{
                    // Keep the durable journal, including collected pickup handles.
                    File.WriteAllText(journalPath,Serializer.Serialize(new {
                        previous.runId,previous.epoch,previous.lease,previous.gameMs,
                        previous.processId,previous.processStartUtc,entities=remaining.ToArray()}));
                    Log("recovery_incomplete",new{remaining=remaining.Count});
                }
            }catch(Exception e){Log("recovery_error",new{type=e.GetType().Name});}
        }
        public void Dispose()
        {
            if(disposed)return;
            try{Stop("dispose");}catch{}
            disposed=true;
            try{essential.Dispose();}catch{}
            try{writer.Dispose();}catch{}
        }
    }
}