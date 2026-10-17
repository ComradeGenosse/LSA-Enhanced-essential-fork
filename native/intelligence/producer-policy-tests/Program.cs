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
        Console.WriteLine("PASS "+checks+" portable production producer policy/queue assertions (not GTA)");
    }
}
