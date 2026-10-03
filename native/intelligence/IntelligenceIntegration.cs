using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using LosSantosAlive.Audio;
using LosSantosAlive.Context;
using LosSantosAlive.Integrations;
using LosSantosAlive.NPC;
using LosSantosAlive.NPC.Perception;
using Rage;
using Rage.Native;

namespace LSA.Intelligence
{
    public sealed class OwnedParticipant
    {
        public Ped Ped;
        public string Lifetime;
        public Func<bool> Current;
    }
    public sealed class IntelligenceIntegration : IIntegration
    {
        readonly EntityAnchors anchors=new EntityAnchors();
        readonly SensorAdapters sensors=new SensorAdapters();
        readonly Stopwatch clock=Stopwatch.StartNew();
        readonly Func<OwnedParticipant[]> roster;
        readonly string pipeName;
        IntelligenceChannel channel;
        IDamageSensors damage;
        volatile HashSet<string> criticalIndex=new HashSet<string>();
        volatile Dictionary<Ped,string> actionIndex=new Dictionary<Ped,string>();
        volatile Dictionary<uint,EntityAnchor> callbackEntities=new Dictionary<uint,EntityAnchor>();
        volatile uint callbackTick;
        Dictionary<string,bool> capabilities=new Dictionary<string,bool>();
        readonly HashSet<string> announced=new HashSet<string>();
        readonly HashSet<string> pendingAnnouncements=new HashSet<string>();
        readonly List<string> pendingRetirements=new List<string>();
        string conversationRef;
        PerceptionSnapshot discoverySnapshot;
        Ped discoveryPlayer;
        OwnedParticipant[] discoveryOwned=new OwnedParticipant[0];
        int discoveryAllowance;
        long deferredDiscovery;
        uint previousTick,snapshotTick;
        long nextDiscovery,nextState,nextShot,nextRefresh,nextDiagnostics,nextLog,snapshotChangedAt,snapshotCadence;
        int discoveryCursor,stateCursor,connectionVersion;
        long staleRejected,retiredAnchors;
        volatile bool damageReady;
        int damagePinAttempt;
        bool stopped,started,playback;
        public string Id=>"intelligence";
        public bool IsAvailable=>started&&!stopped;
        static readonly string[] capabilityNames={"snapshot","pedDamage","playerDamage","vehicleDamage","shooting","state","action","playback","witness","awareness"};
        public IntelligenceIntegration(Func<OwnedParticipant[]> roster,string pipeName="LSA.Intelligence.v1") {if(pipeName==null||!System.Text.RegularExpressions.Regex.IsMatch(pipeName,"^[A-Za-z0-9_.-]{1,80}$")) throw new ArgumentException();this.roster=roster;this.pipeName=pipeName;capabilities=capabilityNames.ToDictionary(k=>k,k=>false);}
        static bool Pinned(System.Reflection.Assembly assembly,string pin)
        {try {if(new FileInfo(assembly.Location).Length>16*1024*1024) return false;using(var h=SHA256.Create()) return BitConverter.ToString(h.ComputeHash(File.ReadAllBytes(assembly.Location))).Replace("-","").ToLowerInvariant()==pin;}catch{return false;}}
        public void Initialize()
        {
            if(started||stopped) return;
            try {
                if(!Pinned(typeof(IIntegration).Assembly,"9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653")) return;
                sensors.Enabled=true;anchors.Retired+=OnRetired;
                capabilities["shooting"]=true;capabilities["state"]=true;capabilities["action"]=true;
                // Do not load a second tracker assembly. Essential already loads the library.
                AppDomain.CurrentDomain.AssemblyLoad+=AssemblyLoaded;QueueDamagePin();
                try {NpcPlaybackCoordinator.PlaybackStarted+=PlaybackStarted;NpcPlaybackCoordinator.PlaybackEnded+=PlaybackEnded;playback=true;capabilities["playback"]=true;}
                catch {try{NpcPlaybackCoordinator.PlaybackStarted-=PlaybackStarted;NpcPlaybackCoordinator.PlaybackEnded-=PlaybackEnded;}catch{}}
                channel=new IntelligenceChannel(pipeName,Guid.NewGuid().ToString("D"),()=>capabilities);channel.Start();
                previousTick=unchecked((uint)Game.GameTime);started=true;Game.LogTrivial("[PS] native_adapter_loaded shadow");
            } catch {Shutdown();Game.LogTrivial("[PS] optional_initialization_failed");}
        }
        void AssemblyLoaded(object sender,AssemblyLoadEventArgs e) {if(e.LoadedAssembly.GetName().Name=="DamageTrackerLib") QueueDamagePin();}
        void QueueDamagePin()
        {
            var loaded=AppDomain.CurrentDomain.GetAssemblies().Where(a=>a.GetName().Name=="DamageTrackerLib").ToArray();
            if(loaded.Length>1) {damageReady=false;return;}
            if(loaded.Length!=1 || Interlocked.CompareExchange(ref damagePinAttempt,1,0)!=0) return;
            var expected=loaded[0];
            // One startup/deferred-load pin read, off the native Update path.
            ThreadPool.QueueUserWorkItem(_=>{try {var current=AppDomain.CurrentDomain.GetAssemblies().Where(a=>a.GetName().Name=="DamageTrackerLib").ToArray();damageReady=!stopped&&current.Length==1&&ReferenceEquals(current[0],expected)&&Pinned(expected,"64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750");}catch{damageReady=false;}});
        }
        // Keeps optional DamageTracker type resolution outside ordinary host initialization.
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        void TryDamage() {try{damage=new DamageSensors(sensors,(h,e)=>CallbackAnchor(h,e,false),(h,e)=>CallbackAnchor(h,e,true),r=>r!=null&&criticalIndex.Contains(r),()=>clock.ElapsedMilliseconds,()=>callbackTick);}catch{damage=null;}}
        string CallbackAnchor(uint handle,object entity,bool vehicle)
        {return entity!=null && callbackEntities.TryGetValue(handle,out var a) && ReferenceEquals(entity,a.Entity) && (a.Kind=="vehicle")==vehicle?a.CaptureRef:null;}
        static bool Live(Entity entity,ulong handle,IntPtr address) => entity!=null && entity.Exists() && Convert.ToUInt64(entity.Handle)==handle && entity.MemoryAddress==address;
        EntityAnchor Retain(Entity entity,string kind,string owner=null,bool observer=false,Func<bool> current=null)
        {
            if(entity==null||!entity.Exists()) return null;
            ulong handle=Convert.ToUInt64(entity.Handle);var address=entity.MemoryAddress;
            var a=anchors.Retain(entity,handle,address,kind,owner,()=>Live(entity,handle,address)&&(current==null||current()),clock.ElapsedMilliseconds,observer);
            if(a!=null && announced.Add(a.CaptureRef)) pendingAnnouncements.Add(a.CaptureRef);return a;
        }
        void Announce(IEnumerable<EntityAnchor> batch) => channel?.Send("anchors",batch.Select(a=>new {captureRef=a.CaptureRef,kind=a.Kind,observer=a.Observer,owned=a.OwnerLifetime!=null,conversation=a.CaptureRef==conversationRef}).ToArray());
        void OnRetired(EntityAnchor a) {retiredAnchors=Math.Min(int.MaxValue,retiredAnchors+1);sensors.Retire(a.CaptureRef);announced.Remove(a.CaptureRef);pendingAnnouncements.Remove(a.CaptureRef);if(pendingRetirements.Count<256) pendingRetirements.Add(a.CaptureRef);else channel?.Dispose();}
        void FlushControls()
        {
            for(int i=0;i<pendingRetirements.Count;i+=32) channel?.Send("retire_batch",pendingRetirements.Skip(i).Take(32).ToArray());pendingRetirements.Clear();
            var current=anchors.Current.Where(a=>pendingAnnouncements.Contains(a.CaptureRef)).ToArray();
            for(int i=0;i<current.Length;i+=32) Announce(current.Skip(i).Take(32));pendingAnnouncements.Clear();
        }
        public void OwnerRetired(string lifetime) {
            try {
                // P2 can notice a terminal state before our next sample. Capture it
                // while the original registration/entity still exists, then revoke.
                foreach(var a in anchors.Current.Where(a=>a.OwnerLifetime==lifetime)) if(a.Entity is Ped p && Live(p,a.Handle,a.Address) && p.IsDead) Sample(a,callbackTick,clock.ElapsedMilliseconds);
                for(int n=0;n<32;n++) {var s=sensors.Take();if(s==null) break;Publish(s,clock.ElapsedMilliseconds);}
                anchors.RevokeOwner(lifetime);UpdateIndexes();FlushControls();
            }catch{Shutdown();}
        }
        void UpdateIndexes()
        {
            var live=anchors.Current.ToArray();
            criticalIndex=new HashSet<string>(live.Where(a=>a.Observer||a.Kind=="player").Select(a=>a.CaptureRef));
            actionIndex=live.Where(a=>a.Entity is Ped).GroupBy(a=>(Ped)a.Entity,new ReferenceComparer<Ped>()).ToDictionary(g=>g.Key,g=>g.First().CaptureRef,new ReferenceComparer<Ped>());
            callbackEntities=live.GroupBy(a=>(uint)a.Handle).ToDictionary(g=>g.Key,g=>g.First());
        }
        public void Update()
        {
            if(!IsAvailable) return;
            var budget=Stopwatch.StartNew();long now=clock.ElapsedMilliseconds;
            try {
                if(damageReady && damage==null) TryDamage();
                if(!damageReady && damage!=null) {damage.Dispose();damage=null;}
                uint tick=unchecked((uint)Game.GameTime);callbackTick=tick;
                if(tick<previousTick) {anchors.Clear();sensors.Reset();announced.Clear();UpdateIndexes();channel.Dispose();channel=new IntelligenceChannel(pipeName,Guid.NewGuid().ToString("D"),()=>capabilities);channel.Start();nextRefresh=0;Game.LogTrivial("[PS] clock_reset");}
                previousTick=tick;
                if(channel.ConnectionVersion!=connectionVersion) {connectionVersion=channel.ConnectionVersion;announced.Clear();nextRefresh=0;}
                if(now>=nextDiscovery) {
                    nextDiscovery=now+200;
                    var player=Game.LocalPlayer.Character;
                    foreach(var oldPlayer in anchors.Current.Where(a=>a.Kind=="player" && !ReferenceEquals(a.Entity,player))) anchors.Retire(oldPlayer.CaptureRef);
                    Retain(player,"player");
                    var owned=roster();var selected=NpcTargeting.GetPlayerConversationPed()??NpcTargeting.GetCurrentSpeakerPed();
                    if(selected==player) selected=null;
                    var selectedOwner=owned.FirstOrDefault(p=>p.Ped==selected);
                    conversationRef=selected==null?null:Retain(selectedOwner?.Ped??selected,"ped",selectedOwner?.Lifetime,true,selectedOwner?.Current)?.CaptureRef;
                    foreach(var p in owned.Take(16)) Retain(p.Ped,"ped",p.Lifetime,true,p.Current);
                    var observerHandles=new HashSet<ulong>(owned.Select(p=>Convert.ToUInt64(p.Ped.Handle)));if(selected!=null) observerHandles.Add(Convert.ToUInt64(selected.Handle));
                    foreach(var a in anchors.Current.Where(a=>a.Observer && !observerHandles.Contains(a.Handle)).ToArray()) anchors.Retire(a.CaptureRef);
                    bool snapshotAvailable=PerceptionSystem.TryGetSnapshot(out var snapshot)&&snapshot!=null&&snapshot.IsValid;
                    var updated=new Dictionary<string,bool>(capabilities);updated["snapshot"]=snapshotAvailable;
                    bool running=false;try{running=damage?.Running==true;}catch{}updated["pedDamage"]=running;updated["playerDamage"]=running;updated["vehicleDamage"]=running;capabilities=updated;
                    if(snapshotAvailable) {
                        uint stamp=unchecked((uint)snapshot.GameTime);
                        if(stamp!=snapshotTick) {snapshotCadence=snapshotChangedAt==0?0:now-snapshotChangedAt;snapshotChangedAt=now;snapshotTick=stamp;discoveryCursor=0;}
                        uint age=unchecked(tick-stamp);
                        // Stale snapshots provide no discovery evidence. Cadence remains diagnostic.
                        discoverySnapshot=age<=1000?snapshot:null;discoveryPlayer=player;discoveryOwned=owned;discoveryAllowance=512;
                    }
                    else discoverySnapshot=null;
                }
                if(discoverySnapshot!=null && discoveryPlayer!=null && discoveryPlayer.Exists() && unchecked(tick-(uint)discoverySnapshot.GameTime)<=1000) {
                    var peds=discoverySnapshot.AllPeds??new Ped[0];var vehicles=discoverySnapshot.AllVehicles??new Vehicle[0];int total=peds.Length+vehicles.Length;
                    for(int count=0;count<32 && discoveryAllowance>0 && discoveryCursor<total;count++,discoveryAllowance--,discoveryCursor++) {
                        if(budget.Elapsed.TotalMilliseconds>=1) {deferredDiscovery=Math.Min(int.MaxValue,deferredDiscovery+1);break;}
                        var e=discoveryCursor<peds.Length?(Entity)peds[discoveryCursor]:vehicles[discoveryCursor-peds.Length];
                        if(e==null||!e.Exists()||e==discoveryPlayer||e.Position.DistanceTo(discoveryPlayer.Position)>100) continue;
                        var p=e as Ped;var ownership=p==null?null:discoveryOwned.FirstOrDefault(o=>o.Ped==p);
                        Retain(ownership?.Ped??e,p==null?"vehicle":"ped",ownership?.Lifetime,false,ownership?.Current);
                    }
                }
                anchors.Cleanup(now,16,()=>budget.Elapsed.TotalMilliseconds<1);UpdateIndexes();
                var sources=anchors.Current.Where(a=>a.Kind!="vehicle").OrderByDescending(a=>a.Kind=="player").ThenByDescending(a=>a.Observer).ToArray();
                // Separate discovery and fast sampling budgets: discovery cannot starve firing reads.
                var sampling=Stopwatch.StartNew();
                if(now>=nextShot) {
                    nextShot=now+50;
                    foreach(var a in sources.Take(9)) {if(sampling.Elapsed.TotalMilliseconds>=1) break;if(anchors.Resolve(a.CaptureRef)==null) continue;sensors.Shooting(a.CaptureRef,NativeFunction.CallByName<bool>("IS_PED_SHOOTING",(Ped)a.Entity),tick,now);}
                }
                if(now>=nextState) {
                    nextState=now+200;
                    for(int n=0;n<25 && sources.Length>0;n++) {var a=sources[stateCursor++%sources.Length];if(sampling.Elapsed.TotalMilliseconds>=1) break;Sample(a,tick,now);}
                }
                if(now>=nextRefresh) {nextRefresh=now+1000;var active=anchors.Current.ToArray();for(int i=0;i<active.Length;i+=32) Announce(active.Skip(i).Take(32));}
                FlushControls();
                for(int n=0;n<32;n++) {var signal=sensors.Take();if(signal==null) break;Publish(signal,now);}
                if(now>=nextDiagnostics) {
                    nextDiagnostics=now+1000;int age=capabilities["snapshot"]?(int)Math.Min(int.MaxValue,(long)unchecked(tick-snapshotTick)):int.MaxValue;
                    var signals=sensors.Counters;
                    channel.Send("diagnostics",new {anchors=anchors.Count,observers=anchors.ObserverCount,snapshotAgeMs=age,snapshotCadenceMs=Clamp(snapshotCadence),dropped=Clamp(sensors.Dropped+channel.Dropped),staleRejected=Clamp(staleRejected),retiredAnchors=Clamp(retiredAnchors),deferredDiscovery=Clamp(deferredDiscovery),updateMicros=Clamp((long)(budget.Elapsed.TotalMilliseconds*1000)),capabilities,signals});
                    if(now>=nextLog) {nextLog=now+10000;Game.LogTrivial("[PS] shadow anchors="+anchors.Count+" observers="+anchors.ObserverCount+" snapshot_age_ms="+age+" snapshot_cadence_ms="+Clamp(snapshotCadence)+" dropped="+Clamp(sensors.Dropped+channel.Dropped)+" stale="+Clamp(staleRejected)+" retired="+Clamp(retiredAnchors)+" deferred="+Clamp(deferredDiscovery)+" update_us="+Clamp((long)(budget.Elapsed.TotalMilliseconds*1000))+" capabilities="+string.Join(",",capabilities.Where(c=>c.Value).Select(c=>c.Key))+" signals="+string.Join(",",signals.Select(c=>c.Key+":"+c.Value)));}
                }
            } catch {Game.LogTrivial("[PS] optional_update_failed");Shutdown();}
        }
        static int Clamp(long n)=>(int)Math.Min(int.MaxValue,Math.Max(0,n));
        void Sample(EntityAnchor a,uint tick,long now)
        {
            if(anchors.Resolve(a.CaptureRef)==null) return;var p=(Ped)a.Entity;
            var v=p.CurrentVehicle;var va=Retain(v,"vehicle");
            if(va!=null) {
                var driver=v.Driver;var driverAnchor=driver==null?null:anchors.Current.FirstOrDefault(a=>a.Entity is Ped && (Ped)a.Entity==driver);
                float health=NativeFunction.CallByName<float>("GET_VEHICLE_ENGINE_HEALTH",v),speed=NativeFunction.CallByName<float>("GET_ENTITY_SPEED",v);
                if(!float.IsNaN(health)&&!float.IsInfinity(health)&&!float.IsNaN(speed)&&!float.IsInfinity(speed)) sensors.Vehicle(va.CaptureRef,new VehicleSample {Engine=NativeFunction.CallByName<bool>("GET_IS_VEHICLE_ENGINE_RUNNING",v),HealthBand=Math.Max(0,Math.Min(10,(int)(health/100))),SpeedBand=Math.Max(0,Math.Min(10,(int)(speed/10))),Driver=driverAnchor?.CaptureRef},tick,now);
            }
            var state=NpcStateStore.TryGetState(p);
            string activity=state?.InDirectedInteraction==true?"directed":NativeFunction.CallByName<bool>("IS_PED_IN_ANY_VEHICLE",p,false)?"in_vehicle":NativeFunction.CallByName<bool>("IS_PED_RUNNING",p)?"running":NativeFunction.CallByName<bool>("IS_PED_WALKING",p)?"walking":"stationary";
            var zone=NativeFunction.CallByName<IntPtr>("GET_NAME_OF_ZONE",p.Position.X,p.Position.Y,p.Position.Z);
            string location=null;
            if(zone!=IntPtr.Zero) {
                var chars=new System.Text.StringBuilder(16);bool complete=false;
                for(int i=0;i<16;i++) {byte b=System.Runtime.InteropServices.Marshal.ReadByte(zone,i);if(b==0) {complete=true;break;}chars.Append((char)b);}location=complete?chars.ToString():null;
            }
            if(location==null || !System.Text.RegularExpressions.Regex.IsMatch(location,"^[A-Z0-9_]{1,16}$")) location="UNKNOWN";
            sensors.Sample(a.CaptureRef,new StateSample {Health=Math.Max(0,Math.Min(100000,p.Health)),Armour=Math.Max(0,Math.Min(100000,p.Armor)),Dead=p.IsDead,Injured=NativeFunction.CallByName<bool>("IS_PED_INJURED",p),Vehicle=va?.CaptureRef,Driver=v!=null&&v.Exists()&&v.Driver==p,Activity=activity,Location=location,Presence=a.OwnerLifetime!=null?"promoted":a.Observer?"conversation":"retained"},tick,now);
        }
        void Publish(RawSignal signal,long now)
        {
            if(now-signal.receivedMs>=30000) {staleRejected++;return;}
            if((signal.source!=null && anchors.Resolve(signal.source)==null) || (signal.target!=null && anchors.Resolve(signal.target)==null)) {staleRejected++;return;}
            channel.Send("signal",new {signal.signalId,signal.producer,signal.producerSequence,signal.kind,signal.target,signal.source,signal.gameTick,ageMs=Clamp(now-signal.receivedMs),signal.facts});
        }
        void Lifecycle(string kind,string pedId,object entity,bool interrupted,bool hadAudio)
        {
            if(!uint.TryParse(pedId,out var handle)) return;var target=CallbackAnchor(handle,entity,false);
            sensors.Enqueue(new RawSignal {producer="playback",kind=kind,target=target,gameTick=callbackTick,receivedMs=clock.ElapsedMilliseconds,facts=new Dictionary<string,object>{{"interrupted",interrupted},{"hadAudio",hadAudio}}});
        }
        void PlaybackStarted(NpcPlaybackStartedEvent e) {try{Lifecycle("playback_started",e.PedId,e.SpeakerPed,false,false);}catch{}}
        void PlaybackEnded(NpcPlaybackEndedEvent e) {try{Lifecycle("playback_ended",e.PedId,e.SpeakerPed,e.WasInterrupted,e.HadAudio);}catch{}}
        public void OnNpcActionExecuted(Ped ped,string actionName,bool succeeded)
        {
            if(!IsAvailable || ReferenceEquals(ped,null) || !actionIndex.TryGetValue(ped,out var target)) return;
            string action=actionName=="follow"?"follow":actionName=="wait"?"wait":"other";
            sensors.Enqueue(new RawSignal {producer="action",kind="action_callback",target=target,gameTick=callbackTick,receivedMs=clock.ElapsedMilliseconds,facts=new Dictionary<string,object>{{"action",action},{"succeeded",succeeded}}});
        }
        public void EnrichActor(Ped ped,ActorContext context) {} // No model-visible block.
        public void OnPedControlChanged(Ped ped,bool controlledByLsa) {}
        public void Shutdown()
        {
            if(stopped) return;stopped=true;sensors.Enabled=false;
            AppDomain.CurrentDomain.AssemblyLoad-=AssemblyLoaded;
            try{damage?.Dispose();}catch{}damage=null;
            if(playback) {try{NpcPlaybackCoordinator.PlaybackStarted-=PlaybackStarted;NpcPlaybackCoordinator.PlaybackEnded-=PlaybackEnded;}catch{}playback=false;}
            channel?.Dispose();anchors.Clear();sensors.Reset();UpdateIndexes();
        }
    }
}
