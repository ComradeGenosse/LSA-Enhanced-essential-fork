using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Intelligence
{
    public sealed class RawSignal
    {
        public string signalId=Guid.NewGuid().ToString("D"), producer, kind, target, source;
        public long producerSequence, receivedMs;
        public uint gameTick;
        public Dictionary<string,object> facts=new Dictionary<string,object>();
        public List<WitnessReceipt> witnessReceipts=new List<WitnessReceipt>();
        public bool Critical;
    }
    // Used by real callbacks and state sampling; no native/model/storage/action dependencies.
    public sealed class SensorAdapters
    {
        readonly object gate=new object();
        readonly LinkedList<RawSignal> queue=new LinkedList<RawSignal>();
        readonly Dictionary<string,long> sequences=new Dictionary<string,long>();
        readonly Dictionary<string,StateSample> baselines=new Dictionary<string,StateSample>();
        readonly Dictionary<string,long> lastShot=new Dictionary<string,long>();
        readonly Dictionary<string,VehicleSample> vehicles=new Dictionary<string,VehicleSample>();
        readonly Dictionary<string,long> received=new Dictionary<string,long>();
        public Func<RawSignal,List<WitnessReceipt>> WitnessEvaluator {get;set;}
        public Dictionary<string,long> Counters {get {lock(gate) return new Dictionary<string,long>(received);}}
        readonly Dictionary<string,long> damageCallbacks=new Dictionary<string,long>{{"ped_damage",0},{"player_damage",0},{"vehicle_damage",0}};
        public Dictionary<string,long> DamageCallbacks {get {lock(gate) return new Dictionary<string,long>(damageCallbacks);}}
        public void RecordDamageCallback(string producer) {lock(gate) if(Enabled && damageCallbacks.ContainsKey(producer)) damageCallbacks[producer]=Math.Min(int.MaxValue,damageCallbacks[producer]+1);}
        public bool Enabled {get;set;}
        public long Dropped {get;private set;}
        public int Count {get {lock(gate) return queue.Count;}}
        RadioSample radioBaseline;
        long radioSamples,radioEdges,radioNativeFailures;
        public long RadioSamples {get {lock(gate) return radioSamples;}}
        public long RadioEdges {get {lock(gate) return radioEdges;}}
        public long RadioNativeFailures {get {lock(gate) return radioNativeFailures;}}
        public void NoteRadioSample() {lock(gate) radioSamples=Math.Min(int.MaxValue,radioSamples+1);}
        public void NoteRadioNativeFailure() {lock(gate) radioNativeFailures=Math.Min(int.MaxValue,radioNativeFailures+1);}
        static void Note(ref long value) { value=Math.Min(int.MaxValue,value+1); }
        public bool Enqueue(RawSignal signal)
        {
            lock(gate) {
                if(!Enabled) return false;
                if(!received.ContainsKey(signal.kind)) received[signal.kind]=0;
                received[signal.kind]=Math.Min(int.MaxValue,received[signal.kind]+1);
                if(!sequences.ContainsKey(signal.producer)) sequences[signal.producer]=0;
                signal.producerSequence=++sequences[signal.producer];
                // Reserve 64 of 256 for critical involvement. Never grow under a storm.
                int routine=queue.Count(s=>!s.Critical);
                if(!signal.Critical && routine>=192) { Dropped++; return false; }
                if(queue.Count>=256) {
                    var victim=queue.First; while(victim!=null && victim.Value.Critical) victim=victim.Next;
                    if(victim==null) { Dropped++; return false; } queue.Remove(victim); Dropped++;
                }
                queue.AddLast(signal); return true;
            }
        }
        public RawSignal Take() { lock(gate) { if(queue.Count==0) return null; var s=queue.First.Value; queue.RemoveFirst(); return s; } }
        public bool Damage(string producer,string target,string attacker,int damage,int armour,string classification,uint tick,long now, bool critical, object collision = null)
        {
            if(damage<0 || damage>100000 || armour<0 || armour>100000) return false;
            var signal=new RawSignal {producer=producer,kind=producer=="vehicle_damage"?"vehicle_damage":"damage",target=target,source=attacker,gameTick=tick,receivedMs=now,Critical=critical};
            signal.facts.Add("damage",damage); signal.facts.Add("armour",armour);
            signal.facts.Add("classification",classification??"unknown"); if(collision!=null) signal.facts.Add("collision",collision);
            return Enqueue(signal);
        }
        RawSignal Prepare(RawSignal signal)
        {try {signal.witnessReceipts=WitnessEvaluator?.Invoke(signal)??new List<WitnessReceipt>();}catch {signal.witnessReceipts=new List<WitnessReceipt>();}return signal;}
        void Edge(string captureRef,string kind,Dictionary<string,object> facts,uint tick,long now,bool critical=false)
        { Enqueue(Prepare(new RawSignal {producer="state",kind=kind,target=captureRef,facts=facts,gameTick=tick,receivedMs=now,Critical=critical})); }
        public void Sample(string captureRef,StateSample current,uint tick,long now)
        {
            if(!Enabled) return;
            if(!baselines.TryGetValue(captureRef,out var old)) { baselines[captureRef]=current; return; }
            if(!old.VehicleBaseline) {old.Vehicle=current.Vehicle;old.Driver=current.Driver;}
            if(!old.Dead && current.Dead) Edge(captureRef,"death",new Dictionary<string,object>(),tick,now,true);
            if(current.Health!=old.Health || current.Armour!=old.Armour || current.Injured!=old.Injured)
                Edge(captureRef,"injury_state",new Dictionary<string,object>{{"health",current.Health},{"armour",current.Armour},{"injured",current.Injured}},tick,now);
            if(current.Vehicle!=old.Vehicle || current.Driver!=old.Driver)
                Edge(captureRef,"vehicle_transition",new Dictionary<string,object>{{"vehicle",current.Vehicle},{"driver",current.Driver}},tick,now);
            if(current.Activity!=old.Activity) Edge(captureRef,"activity_changed",new Dictionary<string,object>{{"activity",current.Activity}},tick,now);
            if(current.Presence!=old.Presence) Edge(captureRef,"presence_changed",new Dictionary<string,object>{{"presence",current.Presence}},tick,now);
            if(current.Location!=old.Location) {
                if(old.PendingLocation!=current.Location) { current.PendingLocation=current.Location; current.PendingSince=now; current.Location=old.Location; }
                else if(now-old.PendingSince<1000) { current.PendingLocation=old.PendingLocation; current.PendingSince=old.PendingSince; current.Location=old.Location; }
                else Edge(captureRef,"location_changed",new Dictionary<string,object>{{"location",current.Location}},tick,now);
            }
            baselines[captureRef]=current;
        }
        public RawSignal Shooting(string captureRef,bool shooting,uint tick,long now)
        {
            if(!Enabled) return null;
            string key="shot:"+captureRef;
            if(!baselines.TryGetValue(key,out var old)) { baselines[key]=new StateSample {Shooting=shooting}; return null; }
            if(shooting && !old.Shooting && (!lastShot.TryGetValue(captureRef,out var previous) || now-previous>=500)) {
                lastShot[captureRef]=now;var signal=Prepare(new RawSignal {producer="shooting",kind="firing",source=captureRef,gameTick=tick,receivedMs=now});Enqueue(signal);old.Shooting=shooting;return signal;
            }
            old.Shooting=shooting;
            return null;
        }
        public void Vehicle(string captureRef,VehicleSample current,uint tick,long now)
        {
            if(!Enabled) return;
            if(vehicles.TryGetValue(captureRef,out var old) && (old.Engine!=current.Engine || old.HealthBand!=current.HealthBand || old.SpeedBand!=current.SpeedBand || old.Driver!=current.Driver))
                Edge(captureRef,"vehicle_state",new Dictionary<string,object>{{"engine",current.Engine},{"healthBand",current.HealthBand},{"speedBand",current.SpeedBand},{"driver",current.Driver}},tick,now);
            vehicles[captureRef]=current;
        }
        public static bool ValidRadioStation(string station)
        {
            if(string.IsNullOrEmpty(station) || station.Length>64) return false;
            for(int i=0;i<station.Length;i++) { char c=station[i]; if(!((c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_')) return false; }
            return true;
        }
        public static string RadioStationClasses(string station)
        {
            if(string.IsNullOrEmpty(station)) return "empty";
            if(station.Length>64) return "long";
            bool lower=false,upper=false,digit=false,underscore=false,other=false;
            for(int i=0;i<station.Length;i++) {
                char c=station[i];
                if(c>='a'&&c<='z') lower=true;
                else if(c>='A'&&c<='Z') upper=true;
                else if(c>='0'&&c<='9') digit=true;
                else if(c=='_') underscore=true;
                else other=true;
            }
            string classes="";
            if(lower) classes="lower";
            if(upper) classes=classes.Length==0?"upper":classes+"+upper";
            if(digit) classes=classes.Length==0?"digit":classes+"+digit";
            if(underscore) classes=classes.Length==0?"underscore":classes+"+underscore";
            if(other) classes=classes.Length==0?"other":classes+"+other";
            return classes.Length==0?"empty":classes;
        }
        public void Radio(string vehicle,string station,uint trackHash,uint tick,long now)
        {
            if(!Enabled) return;
            if(!ValidRadioStation(station)) { station=""; trackHash=0; }
            var current=new RadioSample {Vehicle=vehicle,Station=station??"",TrackHash=trackHash};
            if(current.Station.Length==0) current.TrackHash=0;
            if(radioBaseline!=null && radioBaseline.Vehicle==current.Vehicle && radioBaseline.Station==current.Station && radioBaseline.TrackHash==current.TrackHash) return;
            bool establishing=radioBaseline==null;
            radioBaseline=current;
            if(establishing) return;
            lock(gate) Note(ref radioEdges);
            bool stopped=current.Station.Length==0;
            Enqueue(new RawSignal {
                producer="radio",kind=stopped?"radio_stopped":"radio_changed",target=vehicle,source=null,gameTick=tick,receivedMs=now,Critical=false,
                facts=new Dictionary<string,object>{{"station",stopped?"":current.Station},{"trackHash",(long)current.TrackHash}}
            });
        }
        public void Retire(string captureRef) { baselines.Remove(captureRef); baselines.Remove("shot:"+captureRef); lastShot.Remove(captureRef);vehicles.Remove(captureRef);foreach(var state in baselines.Values) if(state.Vehicle==captureRef) state.VehicleBaseline=false; }
        public void Reset() { lock(gate) {queue.Clear();sequences.Clear();baselines.Clear();lastShot.Clear();vehicles.Clear();received.Clear();radioBaseline=null;radioSamples=0;radioEdges=0;radioNativeFailures=0;foreach(var k in damageCallbacks.Keys.ToArray()) damageCallbacks[k]=0;Dropped=0;} }
    }
    public sealed class StateSample
    {
        public int Health,Armour;
        public bool Dead,Injured,Driver,Shooting;
        public bool VehicleBaseline=true;
        public string Vehicle,Activity,Location,Presence,PendingLocation;
        public long PendingSince;
    }
    public sealed class VehicleSample {public bool Engine;public int HealthBand,SpeedBand;public string Driver;}
    public sealed class RadioSample { public string Vehicle; public string Station; public uint TrackHash; }
}
