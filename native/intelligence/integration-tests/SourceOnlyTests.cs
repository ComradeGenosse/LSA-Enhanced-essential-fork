using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LSA.Intelligence;
using LSA.PromotedCharacters;
using Rage;
using LosSantosAlive.NPC;
using LosSantosAlive.NPC.Perception;

// Real production integration/queue/channel, offline game adapters. Pin checks
// remain covered by the original harness; reflection substitutes ONLY startup.
static class SourceOnlyTests
{
    public static readonly List<Dictionary<string,object>> WireFrames=new List<Dictionary<string,object>>();
    static int checks;
    static void Check(bool value,string label) {if(!value)throw new Exception("D2: "+label);checks++;}
    static object Get(object target,string field)=>target.GetType().GetField(field,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(target);
    static void Set(object target,string field,object value)=>target.GetType().GetField(field,BindingFlags.Instance|BindingFlags.NonPublic).SetValue(target,value);
    static void Call(object target,string method,params object[] args)=>target.GetType().GetMethod(method,BindingFlags.Instance|BindingFlags.NonPublic).Invoke(target,args);
    static readonly string[] producers={"ped_damage","player_damage","vehicle_damage","shooting","state","action","playback","radio"};
    static void PolicyAndQueue()
    {
        var off=new NativeProducerPolicy("off",new Dictionary<string,object>{{"shooting","on"}},"shadow");
        Check(!off.Any&&!off.Allows("shooting"),"per-producer request cannot override master off");
        var disabled=new SensorAdapters(off){Enabled=true};int witnesses=0;
        disabled.WitnessEvaluator=s=>{witnesses++;return new List<WitnessReceipt>();};
        foreach(var name in producers)Check(!disabled.Enqueue(new RawSignal{producer=name,kind="firing"}),"alternate Enqueue denied: "+name);
        disabled.Sample("p",new StateSample(),1,1);disabled.Sample("p",new StateSample{Dead=true},2,2);
        disabled.Shooting("p",false,1,1);disabled.Shooting("p",true,2,2);
        disabled.Vehicle("v",new VehicleSample(),1,1);disabled.Vehicle("v",new VehicleSample{Engine=true},2,2);
        disabled.Radio("v","RADIO_01_CLASS_ROCK",1,1,1,1);
        foreach(var name in producers) {disabled.RecordDamageCallback(name);Check(!disabled.Damage(name,"p",null,1,0,"unknown",1,1,false),"damage alternate path denied: "+name);}
        Check(disabled.Count==0&&disabled.Counters.Count==0&&disabled.DamageCallbacks.Values.All(x=>x==0)&&witnesses==0,
            "off adapters perform no event work or witness evaluation");
        Check(((System.Collections.IDictionary)Get(disabled,"baselines")).Count==0,
            "off sampler does not accumulate a hidden baseline");
        disabled.Reset();Check(!disabled.Enqueue(new RawSignal{producer="shooting"}),"reset cannot enable disabled family");
        foreach(var only in producers) {
            var modes=producers.ToDictionary(x=>x,x=>(object)(x==only?"on":"off"));
            var policy=new NativeProducerPolicy("on",modes,"shadow");
            modes[only]="off";Check(policy.Allows(only),"policy is immutable after configuration: "+only);
            var adapter=new SensorAdapters(policy){Enabled=true};
            foreach(var name in producers)Check(adapter.Enqueue(new RawSignal{producer=name,kind="test"})==(name==only),"independent family gate: "+only+"/"+name);
            Check(adapter.Count==1&&adapter.Take().producerSequence==1,"disabled families do not advance sequence");
            Check(adapter.Enqueue(new RawSignal{producer=only,kind="test"})&&adapter.Take().producerSequence==2,
                "enabled family preserves monotone sequence");
        }
        foreach(var invalid in new object[]{true,1,"ON","source"}) {
            bool rejected=false;try {new NativeProducerPolicy("on",new Dictionary<string,object>{{"state",invalid}});}catch(ArgumentException){rejected=true;}
            Check(rejected,"malformed native producer mode is refused");
        }
        bool unknown=false;try {new NativeProducerPolicy("on",new Dictionary<string,object>{{"rollover","on"}});}catch(ArgumentException){unknown=true;}
        Check(unknown,"unregistered M9 producer cannot be activated");
        var single=new NativeProducerPolicy("on",new Dictionary<string,object>{{"action","on"}},"shadow");
        Check(single.Allows("action")&&producers.Where(x=>x!="action").All(x=>!single.Allows(x)),"one producer does not implicitly activate siblings");
        Check(NativeProducerPolicy.FromConfig(null,null,"off").Allows("state"),"legacy config retains state producer");
        Check(!NativeProducerPolicy.FromConfig(new Dictionary<string,object>{{"ps2.observations","off"}},null,"off").Any,
            "explicit modular native configuration defaults unspecified PS1 off");
    }
    static Dictionary<string,object> Read(StreamReader reader)
    {
        var task=Task.Run(()=>reader.ReadLine());
        if(!task.Wait(3000)||task.Result==null)throw new Exception("D2 native source pipe timeout");
        return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(task.Result);
    }
    static List<Dictionary<string,object>> ThroughSample(StreamReader reader)
    {
        var result=new List<Dictionary<string,object>>();
        for(int i=0;i<20;i++){var frame=Read(reader);result.Add(frame);if((string)frame["type"]=="memory_current_owner_player")return result;}
        throw new Exception("D2 missing current-owner source sample");
    }
    static void SourceTransport()
    {
        var player=new Ped {Handle=810,MemoryAddress=new IntPtr(810)};
        var actor=new Ped {Handle=811,MemoryAddress=new IntPtr(811)};
        Game.LocalPlayer.Character=player;Game.GameTime=50000;NpcTargeting.Conversation=actor;NpcTargeting.CurrentSpeaker=null;
        PerceptionSystem.Snapshot=null;NpcStateStore.Sampled=new NpcState();
        var lifetime=Guid.NewGuid().ToString("D");var encounter=Guid.NewGuid().ToString("D");
        var host=new HostContext();host.ObserveGameTick((uint)Game.GameTime);
        var roster=new[]{new OwnedParticipant{Ped=actor,Lifetime=lifetime,EncounterId=encounter,Current=()=>actor.Existing}};
        IntelligenceIntegration integration=null;int samples=0;
        Func<object> owner=()=>{
            samples++;var anchors=(EntityAnchors)Get(integration,"anchors");
            var npc=anchors.Current.Single(a=>ReferenceEquals(a.Entity,actor));
            var p=anchors.Current.Single(a=>ReferenceEquals(a.Entity,player));
            return new {nativeOwnerPlayerProofVersion=1,source="native_p2_owner_fiber_current_only",hostRunId=host.HostRunId,worldEpoch=host.WorldEpoch,sampledGameTick=(uint)Game.GameTime,
                owners=new[]{new{observerCaptureRef=npc.CaptureRef,incarnationId=lifetime,encounterId=encounter,ownerAlias="promoted."+lifetime,hostRunId=host.HostRunId,worldEpoch=host.WorldEpoch,nativeActorPedId="811",sampledGameTick=(uint)Game.GameTime}},
                protagonist=new{source="native_player_model",key="franklin",playerCaptureRef=p.CaptureRef,sampledGameTick=(uint)Game.GameTime}};
        };
        var policy=new NativeProducerPolicy("off");string pipe="LSA.D2.Source."+Guid.NewGuid().ToString("N");
        integration=new IntelligenceIntegration(()=>roster,pipe,host,
            memoryAuthoritySample:()=>{throw new Exception("optional witness authority unavailable");},
            memoryCurrentOwnerPlayerSample:owner,producerPolicy:policy);
        var caps=(Dictionary<string,bool>)Get(integration,"capabilities");
        var channel=new IntelligenceChannel(pipe,Guid.NewGuid().ToString("D"),()=>caps,host.HostRunId,()=>host.WorldEpoch,true,false,true);
        Set(integration,"channel",channel);Set(integration,"started",true);
        // Run the exact production registration seam after the simulated pin.
        Call(integration,"InitializeProducerAdapters");Call(integration,"InitializeProducerAdapters");
        Check(Get(integration,"damage")==null&&!(bool)Get(integration,"playback"),"source-only installs no damage or playback producer callbacks");
        Call(integration,"TryDamage");Call(integration,"QueueDamagePin");
        Check(Get(integration,"damage")==null&&(int)Get(integration,"damagePinAttempt")==0,"alternate registration paths cannot activate damage");
        var sensors=(SensorAdapters)Get(integration,"sensors");
        Check(!sensors.Enabled&&sensors.WitnessEvaluator==null,"source-only has no event or witness adapter");
        int scans=PerceptionSystem.Scans,reads=PerceptionSystem.Reads;
        channel.Start();
        string firstStream=null;
        try {
            using(var client=new NamedPipeClientStream(".",pipe,PipeDirection.In)) {
                client.Connect(3000);using(var reader=new StreamReader(client)) {
                    var hello=Read(reader);firstStream=(string)hello["streamId"];WireFrames.Add(hello);Check((int)hello["memoryCurrentOwnerPlayerVersion"]==1,"source-only preserves negotiated D02 contract");
                    Check(!hello.ContainsKey("producerModes"),"closed legacy hello vocabulary retained");
                    integration.Update();var frames=ThroughSample(reader);WireFrames.AddRange(frames);
                    Check(frames.Any(f=>(string)f["type"]=="anchors")&&frames.Any(f=>(string)f["type"]=="observer_index"),"mandatory roster/index precede current-owner frame");
                    Check(!frames.Any(f=>(string)f["type"]=="signal"),"source-only pipe emits no optional event");
                    long sequence=0;foreach(var f in frames){Check(Convert.ToInt64(f["sequence"])==++sequence,"mandatory source sequence remains contiguous");}
                    Check(samples==1&&integration.CompletedUpdates==1,"one current sample on the existing update callback");
                    actor.Health-=20;integration.OnNpcActionExecuted(actor,"followtarget",true);
                    Call(integration,"Lifecycle","playback_started","811",actor,false,true);
                    Check(sensors.Count==0,"Core action/playback routes cannot bypass disabled producers");
                    Set(integration,"nextMemoryAuthority",0L);Set(integration,"nextState",0L);Game.GameTime+=10;integration.Update();
                    var more=ThroughSample(reader);WireFrames.AddRange(more);Check(!more.Any(f=>(string)f["type"]=="signal")&&samples==2,"fresh owner sample survives disabled state edges");
                    Check(more.All(f=>Convert.ToInt64(f["sequence"])>sequence),"source samples preserve source sequence");
                    Game.GameTime=0;host.ObserveGameTick(0);Set(integration,"nextMemoryAuthority",0L);integration.Update();
                    var world=ThroughSample(reader);WireFrames.AddRange(world);
                    Check(world.Any(f=>(string)f["type"]=="world_epoch"),"source-only carries ordered world boundary on the original stream");
                    Check(world.All(f=>(string)f["streamId"]==firstStream)&&host.WorldEpoch==2,"successful world send preserves the source stream");
                    Game.GameTime=10;Set(integration,"nextMemoryAuthority",0L);integration.Update();
                    var current=ThroughSample(reader);WireFrames.AddRange(current);
                    Check(!current.Any(f=>(string)f["type"]=="signal")&&samples==4,"next-world owner samples remain independent of optional producers");
                }
            }
            // Trigger the existing output channel's broken-writer retirement;
            // reconnect creates a fresh stream and replays only current roster.
            Set(integration,"nextMemoryAuthority",0L);integration.Update();System.Threading.Thread.Sleep(150);
            using(var reconnected=new NamedPipeClientStream(".",pipe,PipeDirection.In)) {
                reconnected.Connect(3000);using(var reader=new StreamReader(reconnected)) {
                    var hello=Read(reader);Check((string)hello["streamId"]!=firstStream,"disconnect/reconnect renews the native source stream");
                    Set(integration,"nextMemoryAuthority",0L);integration.Update();
                    var fresh=ThroughSample(reader);Check(Convert.ToInt64(fresh[0]["sequence"])==1,"reconnect starts sequence at current roster");
                    Check(fresh.Any(f=>(string)f["type"]=="observer_index")&&!fresh.Any(f=>(string)f["type"]=="signal"),"reconnect restores authority without activating producers");
                }
            }
            Check(PerceptionSystem.Reads==reads&&PerceptionSystem.Scans==scans,"source-only does not read optional discovery or create another scanner");
            Check(integration.RuntimeStatus().Contains("producer_mode=source_only"),"requested source-only mode reported independently");
            actor.Existing=false;integration.OwnerRetired(lifetime);
            Check(!((EntityAnchors)Get(integration,"anchors")).Current.Any(a=>a.OwnerLifetime==lifetime),"source-only retirement revokes the original owner anchor");
            integration.Shutdown();integration.Shutdown();long updates=integration.UpdateCalls;
            integration.Update();Check(integration.UpdateCalls==updates,"shutdown leaves no alternate update path");
        }finally{integration.Shutdown();host.Shutdown();NpcTargeting.Conversation=null;}
    }
    public static void Run() {PolicyAndQueue();SourceTransport();Console.WriteLine("PASS "+checks+" D2 source-only and independent producer assertions (offline, not GTA)");}
}
