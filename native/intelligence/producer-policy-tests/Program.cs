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
