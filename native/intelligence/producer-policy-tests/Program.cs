using System;
using System.Collections.Generic;
using System.Linq;
using LSA.Intelligence;

static class Program
{
    static int checks;
    static void Check(bool condition,string label){if(!condition)throw new Exception(label);checks++;}
    static void Main()
    {
        var modes=new Dictionary<string,object>{{"ps1.producers","off"}};
        var policy=NativeProducerPolicy.FromConfig(modes,new Dictionary<string,object>{{"state","on"}},"shadow");
        var sensors=new SensorAdapters(policy){Enabled=true};
        int witnesses=0;sensors.WitnessEvaluator=_=>{witnesses++;return new List<WitnessReceipt>();};
        string[] names={"ped_damage","player_damage","vehicle_damage","shooting","state","action","playback","radio"};
        foreach(var name in names){Check(!sensors.Enqueue(new RawSignal{producer=name,kind="test"}),"master off isolates alternate producer "+name);sensors.RecordDamageCallback(name);}
        sensors.Sample("p",new StateSample(),1,1);sensors.Sample("p",new StateSample{Dead=true},2,2);
        sensors.Shooting("p",false,1,1);sensors.Shooting("p",true,2,2);
        sensors.Vehicle("v",new VehicleSample(),1,1);sensors.Vehicle("v",new VehicleSample{Engine=true},2,2);
        sensors.Radio("v","RADIO_01_CLASS_ROCK",1,1,1,1);
        Check(!sensors.Damage("ped_damage","p",null,5,0,"bullet",1,1,true),"disabled damage cannot enqueue");
        Check(sensors.Count==0&&sensors.Counters.Count==0&&sensors.DamageCallbacks.Values.All(x=>x==0)&&witnesses==0,"disabled adapters have no effects");
        foreach(var only in names){
            var families=names.ToDictionary(x=>x,x=>(object)(x==only?"on":"off"));
            var independent=new SensorAdapters(new NativeProducerPolicy("on",families,"shadow")){Enabled=true};
            foreach(var name in names)Check(independent.Enqueue(new RawSignal{producer=name,kind="test",Critical=true})==(name==only),"independent producer "+only+" vs "+name);
            Check(independent.Take().producerSequence==1,"disabled siblings consume no sequence");
            // Existing critical/routine backpressure rules remain unchanged.
            int accepted=0;for(int i=0;i<256;i++)if(independent.Enqueue(new RawSignal{producer=only,kind="test",Critical=true}))accepted++;
            Check(accepted==256,"critical capacity preserved");
            Check(!independent.Enqueue(new RawSignal{producer=only,kind="test",Critical=true}),"overflow stays bounded");
            Check(independent.Count==256&&independent.Dropped==1,"loss is explicitly counted");
            independent.Reset();Check(independent.Enqueue(new RawSignal{producer=only,kind="test"}),"reset retains configured gate");
        }
        foreach(var bad in new object[]{true,1,"ON","disabled"}){
            bool refused=false;try{NativeProducerPolicy.FromConfig(new Dictionary<string,object>{{"ps1.producers",bad}},null,"off");}catch(ArgumentException){refused=true;}
            Check(refused,"invalid literal cannot enable producers");
        }
        Check(NativeProducerPolicy.FromConfig(null,null,"off").Allows("state"),"legacy state enabled");
        Check(!NativeProducerPolicy.FromConfig(null,null,"off").Allows("radio"),"radio keeps separate default off");
        var single=new NativeProducerPolicy("on",new Dictionary<string,object>{{"shooting","on"}},"shadow");
        Check(single.Allows("shooting")&&names.Where(x=>x!="shooting").All(x=>!single.Allows(x)),"one explicit producer request cannot start siblings");
        // M9 state sampler: never part of the legacy "all producers" default.
        Check(!NativeProducerPolicy.FromConfig(null,null,"off").M9,"legacy default never enables M9");
        Check(!new NativeProducerPolicy().M9&&new NativeProducerPolicy().Request("m9")=="off","bare default keeps M9 off");
        Check(!NativeProducerPolicy.FromConfig(new Dictionary<string,object>{{"ps1.producers","on"}},null,"off").M9,"producers on alone does not request M9");
        foreach(var id in new[]{"events.crash","events.rollover","events.airborne","events.water","events.wanted","events.wasted","events.busted"})
            foreach(var literal in new[]{"on","shadow"}){
                var requested=NativeProducerPolicy.FromConfig(new Dictionary<string,object>{{"ps1.producers","on"},{id,literal}},null,"off");
                Check(requested.M9&&requested.Request("m9")=="on",id+"="+literal+" requests M9");
                Check(!NativeProducerPolicy.FromConfig(new Dictionary<string,object>{{"ps1.producers","off"},{id,literal}},null,"off").M9,"master off blocks M9 "+id);
            }
        foreach(var bad in new object[]{true,1,"ON","disabled","off"}){
            var malformed=NativeProducerPolicy.FromConfig(new Dictionary<string,object>{{"ps1.producers","on"},{"events.crash",bad}},null,"off");
            Check(!malformed.M9,"malformed or off event literal never starts M9 and never throws");
        }
        var m9Only=new NativeProducerPolicy("on",new Dictionary<string,object>{{"m9","on"}},"off");
        Check(m9Only.M9&&!m9Only.Any&&!m9Only.Damage,"M9 alone is not an ordinary PS1 producer");
        Check(names.All(x=>!m9Only.Allows(x)),"M9 request cannot start sibling producers");
        var explicitOff=new NativeProducerPolicy("on",new Dictionary<string,object>{{"state","on"},{"m9","off"}},"off","on");
        Check(!explicitOff.M9,"explicit native m9=off wins over capability request");
        bool rollover=false;try{new NativeProducerPolicy("on",new Dictionary<string,object>{{"rollover","on"}});}catch(ArgumentException){rollover=true;}
        Check(rollover,"individual M9 family names stay unregistered native producers");
        bool badM9=false;try{new NativeProducerPolicy("on",new Dictionary<string,object>{{"m9",true}});}catch(ArgumentException){badM9=true;}
        Check(badM9,"malformed m9 literal is refused");
        var sensorsOnly=new SensorAdapters(m9Only){Enabled=true};
        Check(!sensorsOnly.Enqueue(new RawSignal{producer="m9",kind="test"}),"M9 has no signal queue path");
        var witness=WitnessPolicy.Evaluate(new WitnessGeometry{EventKind="m9_incident",Observer=Guid.NewGuid().ToString("D"),SampledGameTick=5,DistanceMeters=30,SameInterior=true,ClearLosInFront=true});
        Check(witness.Status=="witnessed"&&witness.Channel=="visual"&&witness.SampledGameTick==5&&!witness.KnowsTarget&&!witness.KnowsSource,"m9 incident visual witness is source-time only");
        Check(WitnessPolicy.Evaluate(new WitnessGeometry{EventKind="m9_incident",Observer=Guid.NewGuid().ToString("D"),DistanceMeters=41,SameInterior=true,ClearLosInFront=true}).Status=="did_not_witness","m9 range bound");
        Check(WitnessPolicy.Evaluate(new WitnessGeometry{EventKind="m9_incident",Observer=Guid.NewGuid().ToString("D"),DistanceMeters=10,SameInterior=true,ClearLosInFront=false}).Status=="did_not_witness","blocked line is not a witness");
        Check(WitnessPolicy.FreshCallbackWindow(900,920,1000,1050),
              "callback owner-fiber sight within 100ms is eligible");
        Check(!WitnessPolicy.FreshCallbackWindow(900,1100,1000,1050)&&
              !WitnessPolicy.FreshCallbackWindow(900,920,1000,1101)&&
              !WitnessPolicy.FreshCallbackWindow(900,920,1000,999),
              "stale and future callback samples cannot prove witnessing");
        Check(WitnessPolicy.FreshCallbackWindow(uint.MaxValue-10,10,1000,1020),
              "game tick rollover preserves valid bounded callback sample");
        var ledger=new BodyDiscoveryLedger();
        Check(ledger.NoteDead("body",100)&&!ledger.CanDiscover("nathan","body",1599),
              "newly deceased is not an immediate discovery");
        Check(ledger.CanDiscover("nathan","body",1600)&&ledger.MarkSeen("nathan","body"),
              "body can be discovered once after bounded delay");
        Check(!ledger.CanDiscover("nathan","body",1700)&&ledger.CanDiscover("other","body",1700),
              "distinct owner-fiber witnesses remain independent");
        Check(!ledger.CanDiscover("other","body",30200),"corpse TTL is bounded");
        ledger.Retire("nathan");Check(ledger.SeenCount==0,"retirement clears witness");
        ledger.Reset();Check(ledger.BodyCount==0,"world reset clears corpse evidence");
        // Anchor retirement, not corpse age, releases lifetime tracking.
        // Expiring a tombstone while the corpse is retained would replay discovery.
        var capacity=new BodyDiscoveryLedger();
        bool allBodies=true,allPairs=true;
        for(int i=0;i<BodyDiscoveryLedger.MaxRetainedBodies;i++)
            allBodies &= capacity.NoteDead("body"+i,1000);
        Check(allBodies&&capacity.BodyCount==256,
              "all 256 retained native anchors fit without the prior 128-body stall");
        for(int i=0;i<BodyDiscoveryLedger.MaxRetainedBodies;i++)
            for(int j=0;j<16;j++) {
                string observer="observer"+j,bodyRef="body"+i;
                allPairs &= capacity.CanDiscover(observer,bodyRef,2500) &&
                            capacity.MarkSeen(observer,bodyRef);
            }
        Check(allPairs&&capacity.SeenCount==4096,
              "all 16 bounded observers may witness each of 256 retained corpses");
        Check(!capacity.CanDiscover("observer0","body0",32000) &&
              !capacity.NoteDead("fresh",32000),
              "expired retained corpse stays non-replayable and full anchor ledger fails closed");
        capacity.Retire("body0");
        Check(capacity.NoteDead("fresh",32000)&&
              capacity.CanDiscover("observer0","fresh",33500),
              "retired anchor reclaims corpse and pair capacity for new lifetime");
        var visual=WitnessPolicy.Evaluate(new WitnessGeometry {EventKind="vehicle_damage",Observer="nathan",
            Target="vehicle",DistanceMeters=10,SameInterior=true,ClearLosInFront=true,SampledGameTick=77});
        Check(visual.Status=="witnessed"&&visual.Channel=="visual"&&visual.KnowsTarget&&!visual.KnowsSource,
              "fresh impact sight does not invent an attacker");
        visual=WitnessPolicy.Evaluate(new WitnessGeometry {EventKind="body_discovered",Observer="nathan",
            Target="body",DistanceMeters=10,SameInterior=true,ClearLosInFront=false});
        Check(visual.Status!="witnessed","blocked corpse visibility cannot discover a body");
        var bodyProducer=new SensorAdapters(new NativeProducerPolicy("on",
            new Dictionary<string,object>{{"state","on"}})){Enabled=true};
        Check(!bodyProducer.BodyDiscovered("body",new WitnessReceipt {Observer="nathan",
            Status="witnessed",Channel="visual",Basis="native_callback",SampledGameTick=10},10,1600),
            "callback cannot impersonate sampled body discovery");
        Check(bodyProducer.BodyDiscovered("body",new WitnessReceipt {Observer="nathan",
            Status="witnessed",Channel="visual",Basis="sampled_state",SampledGameTick=10},10,1600) &&
            bodyProducer.Take().kind=="body_discovered",
            "bounded owner-fiber corpse producer");
        Console.WriteLine("PASS "+checks+" portable production producer policy/queue assertions (not GTA)");
    }
}
