using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using LosSantosAlive.NPC;
using Rage;

namespace LSA.AGM.E0
{
    // A separate command-free assembly. Loaded only inside the already-running,
    // exact-pinned Essential AppDomain. It NEVER adopts, tasks or deletes any ped.
    public sealed class LabEssentialProbe : MarshalByRefObject
    {
        private const string CoreSha="9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
        private readonly ConcurrentQueue<Request> queue=new ConcurrentQueue<Request>();
        private readonly ConcurrentDictionary<int,string> snapshots=new ConcurrentDictionary<int,string>();
        private readonly ConcurrentDictionary<int,string> applied=new ConcurrentDictionary<int,string>();
        private volatile bool running;
        private sealed class Request
        {
            public int Handle;
            public long Address;
            public uint Model;
            public bool Enable;
        }
        public override object InitializeLifetimeService()=>null;
        public string CoreStatus
        {
            get{
                try{
                    var cores=AppDomain.CurrentDomain.GetAssemblies().Where(a=>a.GetName().Name=="LosSantosAlive").ToArray();
                    if(cores.Length!=1)return "core_missing_or_ambiguous";
                    using(var sha=SHA256.Create()){
                        var actual=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(cores[0].Location)))
                            .Replace("-","").ToLowerInvariant();
                        return actual==CoreSha?"core_ready":"core_pin_mismatch";
                    }
                }catch{return "core_identity_unavailable";}
            }
        }
        public bool Start()
        {
            if(CoreStatus!="core_ready")return false;
            if(running)return true;
            running=true;
            GameFiber.StartNew(()=>{
                while(running){
                    try{
                        for(int i=0;i<8 && queue.TryDequeue(out var req);i++)Apply(req);
                        foreach(var kv in applied.ToArray()) {
                            // Observations remain attributed to exact actor handles;
                            // caller separately checks handle+address+model.
                            var ped=Resolve(kv.Key,0,0);
                            var state=ped==null?null:NpcStateStore.TryGetState(ped);
                            snapshots[kv.Key]=state==null?"npc_state_absent":
                                "reflex="+state.HasActiveReflex+";directed="+state.InDirectedInteraction+
                                ";stay="+state.StayUnderLsaControl+";free_drive="+state.DriveToXWhenBothSeated;
                        }
                    }catch{}
                    GameFiber.Sleep(200);
                }
            });
            return true;
        }
        private static Ped Resolve(int handle,long address,uint model)
        {
            foreach(var p in World.GetAllPeds()){
                if(p==null||!p.Exists()||p.Handle!=handle)continue;
                if(address!=0 && p.MemoryAddress.ToInt64()!=address)continue;
                if(model!=0 && (uint)p.Model.Hash!=model)continue;
                return p;
            }
            return null;
        }
        private void Apply(Request req)
        {
            try{
                var p=Resolve(req.Handle,req.Address,req.Model);
                if(p==null){applied[req.Handle]="actor_missing";return;}
                var state=req.Enable?NpcStateStore.GetStateForActiveBehavior(p):NpcStateStore.TryGetState(p);
                if(state!=null){
                    state.StayUnderLsaControl=req.Enable;
                    if(req.Enable){
                        state.EnterPassengerSeatWhenPlayerEnters=false;
                        state.ExitVehicleWhenPlayerExits=false;
                        state.DriveToXWhenBothSeated=false;
                        state.AccompliceMode=false;
                    }
                }
                // On the off control no new Essential NpcState is created.
                applied[req.Handle]=req.Enable?(state==null?"state_missing":"yield_on"):"yield_off";
            }catch(Exception e){applied[req.Handle]="error:"+e.GetType().Name;}
        }
        public bool RequestYield(int handle,long address,uint model,bool enable)
        {
            if(!running||handle<=0||address==0||model==0||queue.Count>=32)return false;
            applied.TryRemove(handle,out _);
            queue.Enqueue(new Request{Handle=handle,Address=address,Model=model,Enable=enable});
            return true;
        }
        public string Applied(int handle)=>applied.TryGetValue(handle,out var status)?status:"pending";
        public string GetSnapshot(int handle)=>snapshots.TryGetValue(handle,out var status)?status:"not_sampled";
        public void Stop(){running=false;}
    }
}