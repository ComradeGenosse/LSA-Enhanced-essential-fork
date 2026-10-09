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
using LSA.PromotedCharacters;

namespace LSA.Intelligence
{
    public sealed class OwnedParticipant
    {
        public Ped Ped;
        public string Lifetime, EncounterId;
        public Func<bool> Current;
        public Func<object> PrimaryOwner;
    }
    public sealed class IntelligenceIntegration : IIntegration
    {
        readonly EntityAnchors anchors;
        readonly HostContext host;
        readonly bool ownsHost;
        readonly SensorAdapters sensors=new SensorAdapters();
        // Every retained lifetime uses the host's monotonic time axis.
        readonly Func<OwnedParticipant[]> roster;
        readonly string pipeName;
        readonly bool directorShadow;
        readonly DirectorAdmission director;
        IntelligenceChannel channel;
        IDamageSensors damage;
        volatile HashSet<string> criticalIndex=new HashSet<string>();
        volatile Dictionary<Ped,string> actionIndex=new Dictionary<Ped,string>();
        volatile Dictionary<uint,EntityAnchor> callbackEntities=new Dictionary<uint,EntityAnchor>();
        volatile uint callbackTick;
        sealed class AnchorWireState
        {
            public string CaptureRef,Kind;
            public bool Observer,Owned,Conversation;
            public bool Same(AnchorWireState other)=>other!=null&&Kind==other.Kind&&Observer==other.Observer&&Owned==other.Owned&&Conversation==other.Conversation;
            public bool Demotes(AnchorWireState other)=>other!=null&&(other.Observer&&!Observer||other.Conversation&&!Conversation);
            public bool Promotes(AnchorWireState other)=>other==null&&(Observer||Conversation)||other!=null&&(!other.Observer&&Observer||!other.Conversation&&Conversation);
        }
        Dictionary<string,bool> capabilities=new Dictionary<string,bool>();
        readonly object rosterGate=new object();
        readonly Dictionary<string,AnchorWireState> publishedAnchorStates=new Dictionary<string,AnchorWireState>();
        long situationRevision;
        readonly Dictionary<string,object> sampledSituations=new Dictionary<string,object>();
        readonly Dictionary<string,string> publishedObserverIndex=new Dictionary<string,string>();
        readonly System.Web.Script.Serialization.JavaScriptSerializer captureJson=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=8192};
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
        long staleRejected,retiredAnchors,witnessDeferred,witnessUnknown,witnessRejected;
        int lineOfSightBudget;
        volatile bool damageReady;
        int damagePinAttempt;
        bool stopped,started,playback;
        long updateCalls,completedUpdates,lastUpdateMs=-1,lastCompletedMs=-1;
        string shutdownReason="none";
        public string Id=>"intelligence";
        public bool IsAvailable=>started&&!stopped;
        public long UpdateCalls=>Interlocked.Read(ref updateCalls);
        public long CompletedUpdates=>Interlocked.Read(ref completedUpdates);
        public string ShutdownReason=>shutdownReason;
        static void Count(ref long value) {
            long current;
            do {current=Interlocked.Read(ref value);if(current>=int.MaxValue) return;}
            while(Interlocked.CompareExchange(ref value,current+1,current)!=current);
        }
        int Age(long timestamp)=>timestamp<0?int.MaxValue:Clamp(host.MonotonicMs-timestamp);
        internal string RuntimeStatus()=>"available="+IsAvailable+" update_calls="+UpdateCalls+" update_completed="+CompletedUpdates+" last_update_age_ms="+Age(Interlocked.Read(ref lastUpdateMs))+" last_completed_age_ms="+Age(Interlocked.Read(ref lastCompletedMs))+" last_game_tick="+callbackTick+" shutdown_reason="+ShutdownReason;
        internal static void LogStatus(string message) {try{Game.LogTrivial(message);}catch{}}
        static readonly string[] capabilityNames={"snapshot","pedDamage","playerDamage","vehicleDamage","shooting","state","action","playback","witness","awareness","playerSpeech"};
        public IntelligenceIntegration(Func<OwnedParticipant[]> roster,string pipeName="LSA.Intelligence.v1",HostContext host=null,bool directorShadow=false) {
            if(pipeName==null||!System.Text.RegularExpressions.Regex.IsMatch(pipeName,"^[A-Za-z0-9_.-]{1,80}$")) throw new ArgumentException();
            this.roster=roster;this.pipeName=pipeName;ownsHost=host==null;this.host=host??new HostContext();anchors=this.host.Anchors;
            this.directorShadow=directorShadow;
            // This preview endpoint never acquires C-11 speech authority.
            // Verified native C-06 + Essential intake are deliberately absent.
            director=new DirectorAdmission(()=>this.host.MonotonicMs,(r,stage)=>stage=="complete" ? DirectorC06Policy.CurrentPlayback(r,ReadDirectorC06(r)) : DirectorC06Policy.Safe(r,ReadDirectorC06(r)),()=>this.host.HostRunId,()=>this.host.WorldEpoch,false);
            this.host.WorldChanged+=WorldChanged;capabilities=capabilityNames.ToDictionary(k=>k,k=>false);
        }
        void WorldChanged(int epoch,string reason) {
            if(!IsAvailable) return;
            director.Reset();sensors.Reset();lock(rosterGate) {publishedAnchorStates.Clear();publishedObserverIndex.Clear();sampledSituations.Clear();}pendingRetirements.Clear();
            conversationRef=null;discoverySnapshot=null;discoveryOwned=new OwnedParticipant[0];UpdateIndexes();
            // Ordered control fact invalidates all prior observer state. Losing
            // it closes the bounded channel; reconnect republishes current host.
            if(channel?.Send("world_epoch",new {epoch,reason})!=true) {
                channel?.Dispose();channel=new IntelligenceChannel(pipeName,Guid.NewGuid().ToString("D"),()=>capabilities,host.HostRunId,()=>host.WorldEpoch,true,directorShadow);channel.Start();connectionVersion=0;
            }
            nextRefresh=nextDiscovery=nextState=nextShot=0;
            LogStatus("[PS] clock_reset");
        }
        static bool Pinned(System.Reflection.Assembly assembly,string pin)
        {try {if(new FileInfo(assembly.Location).Length>16*1024*1024) return false;using(var h=SHA256.Create()) return BitConverter.ToString(h.ComputeHash(File.ReadAllBytes(assembly.Location))).Replace("-","").ToLowerInvariant()==pin;}catch{return false;}}
        public void Initialize()
        {
            if(started||stopped) return;
            try {
                if(!Pinned(typeof(IIntegration).Assembly,"9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653")) return;
                sensors.Enabled=true;sensors.WitnessEvaluator=CaptureWitnesses;anchors.Retired+=OnRetired;
                capabilities["shooting"]=true;capabilities["state"]=true;capabilities["action"]=true;capabilities["witness"]=true;capabilities["playerSpeech"]=false;
                // Do not load a second tracker assembly. Essential already loads the library.
                AppDomain.CurrentDomain.AssemblyLoad+=AssemblyLoaded;QueueDamagePin();
                try {NpcPlaybackCoordinator.PlaybackStarted+=PlaybackStarted;NpcPlaybackCoordinator.PlaybackEnded+=PlaybackEnded;playback=true;capabilities["playback"]=true;}
                catch {try{NpcPlaybackCoordinator.PlaybackStarted-=PlaybackStarted;NpcPlaybackCoordinator.PlaybackEnded-=PlaybackEnded;}catch{}}
                channel=new IntelligenceChannel(pipeName,Guid.NewGuid().ToString("D"),()=>capabilities,host.HostRunId,()=>host.WorldEpoch,true,directorShadow);channel.Start();
                previousTick=unchecked((uint)Game.GameTime);started=true;Game.LogTrivial("[PS] native_adapter_loaded shadow");
            } catch {Shutdown("initialization_failed");LogStatus("[PS] optional_initialization_failed");}
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
        void TryDamage() {try{damage=new DamageSensors(sensors,(h,e)=>CallbackAnchor(h,e,false),(h,e)=>CallbackAnchor(h,e,true),r=>r!=null&&criticalIndex.Contains(r),()=>host.MonotonicMs,()=>callbackTick);}catch{damage=null;}}
        string CallbackAnchor(uint handle,object entity,bool vehicle)
        {return entity!=null && callbackEntities.TryGetValue(handle,out var a) && ReferenceEquals(entity,a.Entity) && (a.Kind=="vehicle")==vehicle?a.CaptureRef:null;}
        static bool Live(Entity entity,ulong handle,IntPtr address) => entity!=null && entity.Exists() && Convert.ToUInt64(entity.Handle)==handle && entity.MemoryAddress==address;
        EntityAnchor Retain(Entity entity,string kind,string owner=null,bool observer=false,Func<bool> current=null)
        {
            if(entity==null||!entity.Exists()) return null;
            ulong handle=Convert.ToUInt64(entity.Handle);var address=entity.MemoryAddress;
            var a=anchors.Retain(entity,handle,address,kind,owner,()=>Live(entity,handle,address)&&(current==null||current()),host.MonotonicMs,observer);
            return a;
        }
        AnchorWireState Describe(EntityAnchor a)=>new AnchorWireState {CaptureRef=a.CaptureRef,Kind=a.Kind,Observer=a.Observer,Owned=a.OwnerLifetime!=null,Conversation=a.CaptureRef==conversationRef};
        void OnRetired(EntityAnchor a) {retiredAnchors=Math.Min(int.MaxValue,retiredAnchors+1);sensors.Retire(a.CaptureRef);lock(rosterGate) {publishedAnchorStates.Remove(a.CaptureRef);publishedObserverIndex.Remove(a.CaptureRef);sampledSituations.Remove(a.CaptureRef);}if(pendingRetirements.Count<256) pendingRetirements.Add(a.CaptureRef);else channel?.Dispose();}
        void FlushControls(bool refreshRoster=false)
        {
            lock(rosterGate) {
                for(int i=0;i<pendingRetirements.Count;i+=32) if(channel?.Send("retire_batch",pendingRetirements.Skip(i).Take(32).ToArray())!=true) return;
                pendingRetirements.Clear();
                var current=anchors.Current.Select(Describe).OrderBy(a=>a.CaptureRef,StringComparer.Ordinal).ToArray();
                var demotions=current.Where(a=>publishedAnchorStates.TryGetValue(a.CaptureRef,out var old)&&a.Demotes(old)&&(refreshRoster||!a.Same(old))).ToArray();
                var promotions=current.Where(a=>publishedAnchorStates.TryGetValue(a.CaptureRef,out var old)?a.Promotes(old):a.Promotes(null)).ToArray();
                var demotionRefs=new HashSet<string>(demotions.Select(a=>a.CaptureRef));var promotionRefs=new HashSet<string>(promotions.Select(a=>a.CaptureRef));
                var stable=current.Where(a=>!demotionRefs.Contains(a.CaptureRef)&&!promotionRefs.Contains(a.CaptureRef)&&(refreshRoster||!publishedAnchorStates.TryGetValue(a.CaptureRef,out var old)||!a.Same(old))).ToArray();
                if(!SendAnchorStates(demotions)||!SendAnchorStates(stable)||!SendAnchorStates(promotions)) return;
                SendObserverIndex(refreshRoster);
                foreach(var batch in sampledSituations.Where(pair=>publishedAnchorStates.ContainsKey(pair.Key)).Select(pair=>pair.Value).Select((row,i)=>new {row,i}).GroupBy(item=>item.i/32)) if(channel?.Send("observer_situation",batch.Select(item=>item.row).ToArray())!=true) return;
                sampledSituations.Clear();
            }
        }
        OwnedParticipant Association(EntityAnchor anchor) => (roster()??new OwnedParticipant[0]).FirstOrDefault(p=>p!=null && ReferenceEquals(p.Ped,anchor.Entity) && p.Lifetime==anchor.OwnerLifetime && p.EncounterId!=null && Guid.TryParse(p.EncounterId,out var unused) && p.Current?.Invoke()==true);
        Dictionary<string,object> IndexRow(EntityAnchor anchor)
        {
            var row=new Dictionary<string,object>{{"captureRef",anchor.CaptureRef},{"kind",anchor.Kind},{"owned",anchor.OwnerLifetime!=null}};
            if(anchor.OwnerLifetime!=null) {var owner=Association(anchor);if(owner!=null) {row["encounterId"]=owner.EncounterId;row["incarnationId"]=owner.Lifetime;}}
            return row;
        }
        void SendObserverIndex(bool refresh)
        {
            var rows=anchors.Current.Where(a=>publishedAnchorStates.ContainsKey(a.CaptureRef)).OrderBy(a=>a.CaptureRef,StringComparer.Ordinal).Select(IndexRow).Where(row=>refresh || !publishedObserverIndex.TryGetValue((string)row["captureRef"],out var old) || old!=captureJson.Serialize(row)).ToArray();
            // A changed owned association cannot repurpose an existing turn ref.
            foreach(var row in rows) if(publishedObserverIndex.TryGetValue((string)row["captureRef"],out var prior) && prior!=captureJson.Serialize(row)) {
                anchors.Retire((string)row["captureRef"],AnchorRetirement.LifetimeMismatch);return;
            }
            for(int i=0;i<rows.Length;i+=32) {
                var batch=rows.Skip(i).Take(32).ToArray();if(channel?.Send("observer_index",batch)!=true) return;
                foreach(var row in batch) publishedObserverIndex[(string)row["captureRef"]]=captureJson.Serialize(row);
            }
        }
        bool SendAnchorStates(AnchorWireState[] states)
        {
            for(int i=0;i<states.Length;i+=32) {
                var batch=states.Skip(i).Take(32).ToArray();
                if(channel?.Send("anchors",batch.Select(a=>new {captureRef=a.CaptureRef,kind=a.Kind,observer=a.Observer,owned=a.Owned,conversation=a.Conversation}).ToArray())!=true) return false;
                foreach(var a in batch) publishedAnchorStates[a.CaptureRef]=a;
            }
            return true;
        }
        public void OwnerRetired(string lifetime) {
            try {
                // P2 can notice a terminal state before our next sample. Capture it
                // while the original registration/entity still exists, then revoke.
                foreach(var a in anchors.Current.Where(a=>a.OwnerLifetime==lifetime)) if(a.Entity is Ped p && Live(p,a.Handle,a.Address) && p.IsDead) Sample(a,callbackTick,host.MonotonicMs);
                for(int n=0;n<32;n++) {var s=sensors.Take();if(s==null) break;Publish(s,host.MonotonicMs);}
                anchors.RevokeOwner(lifetime);UpdateIndexes();FlushControls();
            }catch{Shutdown("owner_retirement_failed");}
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
            var budget=Stopwatch.StartNew();long now=host.MonotonicMs;
            Count(ref updateCalls);Interlocked.Exchange(ref lastUpdateMs,now);
            try {
                if(damageReady && damage==null) TryDamage();
                if(!damageReady && damage!=null) {damage.Dispose();damage=null;}
                uint tick=unchecked((uint)Game.GameTime);callbackTick=tick;
                if(ownsHost) host.ObserveGameTick(tick);
                previousTick=tick;
                lineOfSightBudget=8;
                if(channel.ConnectionVersion!=connectionVersion) {connectionVersion=channel.ConnectionVersion;lock(rosterGate) {publishedAnchorStates.Clear();publishedObserverIndex.Clear();sampledSituations.Clear();}nextRefresh=0;}
                if(now>=nextDiscovery) {
                    nextDiscovery=now+200;
                    var player=Game.LocalPlayer.Character;
                    foreach(var oldPlayer in anchors.Current.Where(a=>a.Kind=="player" && !ReferenceEquals(a.Entity,player))) anchors.Retire(oldPlayer.CaptureRef);
                    Retain(player,"player");
                    var owned=roster()??new OwnedParticipant[0];var selected=NpcTargeting.GetPlayerConversationPed()??NpcTargeting.GetCurrentSpeakerPed();
                    if(selected==player) selected=null;
                    var selectedOwner=owned.FirstOrDefault(p=>p?.Ped!=null && ReferenceEquals(p.Ped,selected));
                    var orderedOwned=owned.Where(p=>p?.Ped!=null).OrderBy(p=>p.Lifetime,StringComparer.Ordinal).ToArray();
                    var ownedPriority=orderedOwned.Where(p=>selectedOwner==null || p.Lifetime!=selectedOwner.Lifetime).Take(selected==null?16:15).ToList();
                    if(selectedOwner!=null) ownedPriority.Insert(0,selectedOwner);
                    var ownedRetained=orderedOwned.Take(16).ToList();
                    if(selectedOwner!=null && !ownedRetained.Any(p=>p.Lifetime==selectedOwner.Lifetime)) ownedRetained.Add(selectedOwner);
                    // Retain before applying the priority list, without claiming slots
                    // incrementally. This lets the current conversation displace a
                    // stale/lower priority observer in the same bounded discovery tick.
                    var selectedAnchor=selected==null?null:Retain(selectedOwner?.Ped??selected,"ped",selectedOwner?.Lifetime,false,selectedOwner?.Current);
                    foreach(var p in ownedRetained) Retain(p.Ped,"ped",p.Lifetime,false,p.Current);
                    var priorityRefs=new List<string>();
                    if(selectedAnchor!=null) priorityRefs.Add(selectedAnchor.CaptureRef);
                    foreach(var p in ownedPriority) {
                        var a=anchors.Current.FirstOrDefault(x=>x.Kind=="ped" && ReferenceEquals(x.Entity,p.Ped) && x.OwnerLifetime==p.Lifetime);
                        if(a!=null && !priorityRefs.Contains(a.CaptureRef)) priorityRefs.Add(a.CaptureRef);
                    }
                    // PS2 also admits ordinary peds found in this already-captured
                    // snapshot. They receive transient perception only; no promotion,
                    // owner registration, identity, session or action authority.
                    foreach(var a in anchors.Current.Where(x=>x.Kind=="ped"&&x.OwnerLifetime==null&&x.CaptureRef!=selectedAnchor?.CaptureRef&&now-x.LastSeen<=1000).OrderBy(x=>x.CaptureRef,StringComparer.Ordinal)) {
                        if(a.Entity is Ped ordinary && ordinary.Exists() && ordinary.Position.DistanceTo(player.Position)<=60 && !priorityRefs.Contains(a.CaptureRef)) priorityRefs.Add(a.CaptureRef);
                    }
                    anchors.SetObserverPriority(priorityRefs);
                    conversationRef=selectedAnchor?.CaptureRef;
                    UpdateIndexes();
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
                DrainDirectorPreview();
                if(ownsHost) host.Cleanup(16,()=>budget.Elapsed.TotalMilliseconds<1);UpdateIndexes();
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
                bool refreshRoster=now>=nextRefresh;if(refreshRoster) nextRefresh=now+1000;
                FlushControls(refreshRoster);
                for(int n=0;n<32;n++) {var signal=sensors.Take();if(signal==null) break;Publish(signal,now);}
                if(now>=nextDiagnostics) {
                    nextDiagnostics=now+1000;int age=capabilities["snapshot"]?(int)Math.Min(int.MaxValue,(long)unchecked(tick-snapshotTick)):int.MaxValue;
                    var signals=sensors.Counters;
                    var damageCallbacks=sensors.DamageCallbacks;
                    channel.Send("diagnostics",new {anchors=anchors.Count,observers=anchors.ObserverCount,snapshotAgeMs=age,snapshotCadenceMs=Clamp(snapshotCadence),dropped=Clamp(sensors.Dropped+channel.Dropped),staleRejected=Clamp(staleRejected),retiredAnchors=Clamp(retiredAnchors),deferredDiscovery=Clamp(deferredDiscovery),updateMicros=Clamp((long)(budget.Elapsed.TotalMilliseconds*1000)),capabilities,signals,damageCallbacks,witnessDeferred=Clamp(witnessDeferred),witnessUnknown=Clamp(witnessUnknown),witnessRejected=Clamp(witnessRejected),playerSpeechGate="unsupported_capture_receipt"});
                    if(now>=nextLog) {nextLog=now+10000;Game.LogTrivial("[PS] shadow anchors="+anchors.Count+" observers="+anchors.ObserverCount+" snapshot_age_ms="+age+" snapshot_cadence_ms="+Clamp(snapshotCadence)+" dropped="+Clamp(sensors.Dropped+channel.Dropped)+" stale="+Clamp(staleRejected)+" retired="+Clamp(retiredAnchors)+" deferred="+Clamp(deferredDiscovery)+" update_us="+Clamp((long)(budget.Elapsed.TotalMilliseconds*1000))+" capabilities="+string.Join(",",capabilities.Where(c=>c.Value).Select(c=>c.Key))+" damage_callbacks=ped:"+damageCallbacks["ped_damage"]+",player:"+damageCallbacks["player_damage"]+",vehicle:"+damageCallbacks["vehicle_damage"]+" signals="+string.Join(",",signals.Select(c=>c.Key+":"+c.Value)));}
                }
                Count(ref completedUpdates);Interlocked.Exchange(ref lastCompletedMs,host.MonotonicMs);
            } catch {LogStatus("[PS] optional_update_failed");Shutdown("update_failed");}
        }
        // Read only what the current Core/P2/PS host can independently prove.
        // The current native build has no source-pinned player-turn counter,
        // authoritative mic+Essential busy receipt, or native PS3 entitlement
        // echo. Those fields intentionally stay false/-1. Merely matching a
        // Ped pointer or companion-provided integer never grants C-06 authority.
        DirectorC06Policy.Snapshot ReadDirectorC06(DirectorAdmission.Request r)
        {
            var proof=new DirectorC06Policy.Snapshot {
                HostRunId=host.HostRunId,WorldEpoch=host.WorldEpoch,
                OwnerProofRevision=-1,PlayerTurnVersion=-1,PolicyVersion=1
            };
            if(r==null)return proof;
            try {
                var speaker=anchors.Resolve(r.SpeakerCaptureRef);
                var player=anchors.Resolve(r.PlayerCaptureRef);
                var local=Game.LocalPlayer.Character;
                proof.SpeakerCaptureRef=speaker?.CaptureRef;
                proof.PlayerCaptureRef=player?.CaptureRef;
                proof.SpeakerAnchorCurrent=speaker?.Kind=="ped" && speaker.Entity is Ped;
                proof.SpeakerObserver=speaker?.Observer==true;
                proof.SpeakerOwned=speaker?.OwnerLifetime!=null;
                proof.SpeakerAlive=speaker?.Entity is Ped p && p.Exists() && !p.IsDead;
                proof.PlayerAnchorCurrent=player?.Kind=="player" && player.Entity is Ped;
                proof.PlayerIsLocal=player!=null && ReferenceEquals(player.Entity,local);
                proof.PlayerAlive=local!=null && local.Exists() && !local.IsDead;
                var current=(roster()??new OwnedParticipant[0]).FirstOrDefault(item=>
                    item!=null && item.Ped!=null && speaker!=null &&
                    ReferenceEquals(item.Ped,speaker.Entity) &&
                    item.Lifetime==speaker.OwnerLifetime && item.Current?.Invoke()==true);
                proof.OwnerIncarnationId=current?.Lifetime;
                // ReadOnly P2 owner equivalence is not an owner proof *revision*,
                // nor does it certify idle Essential/ACT/C-06 control.
                proof.OwnerProofCurrent=current!=null;
            } catch { return new DirectorC06Policy.Snapshot(); }
            return proof;
        }
        // Owner-fiber only. A separately versioned Director request can be
        // decoded and explicitly rejected in shadow, but never tasks an actor,
        // invokes kb/Essential, or consumes any PS3 response entitlement.
        void DrainDirectorPreview()
        {
            if(!directorShadow || channel==null)return;
            for(int n=0;n<4 && channel.TryTakeDirectorFrame(out var frame);n++) {
                if(!DirectorFrameCodec.TryDecode(frame,out var request))continue;
                var receipt=director.Handle(request);
                channel.Send("director_response",new {
                    directorRequestVersion=1,ticketId=receipt.TicketId,status=receipt.Status
                });
            }
        }
        static int Clamp(long n)=>(int)Math.Min(int.MaxValue,Math.Max(0,n));
        List<WitnessReceipt> CaptureWitnesses(RawSignal signal)
        {
            var result=new List<WitnessReceipt>();
            if(signal==null) return result;
            var kind=signal.kind;
            if(WitnessPolicy.VisualRange(kind)<=0) {witnessUnknown=Math.Min(int.MaxValue,witnessUnknown+1);return result;}
            string participantRef=kind=="firing"?signal.source:signal.target;
            var participant=anchors.Resolve(participantRef);
            if(participant==null||!(participant.Entity is Ped subject)) return result;
            foreach(var observer in anchors.Current.Where(a=>a.Observer&&a.Kind=="ped"&&a.CaptureRef!=participantRef)) {
                if(!(observer.Entity is Ped witness) || witness.Position.DistanceTo(subject.Position)>WitnessPolicy.VisualRange(kind)) continue;
                if(lineOfSightBudget<=0) {witnessDeferred=Math.Min(int.MaxValue,witnessDeferred+1);continue;}
                var live=anchors.Resolve(observer.CaptureRef);
                if(live==null||!ReferenceEquals(live.Entity,witness)) continue;
                lineOfSightBudget--;
                try {
                    var distance=witness.Position.DistanceTo(subject.Position);
                    var witnessInterior=NativeFunction.CallByName<int>("GET_INTERIOR_FROM_ENTITY",witness);
                    var subjectInterior=NativeFunction.CallByName<int>("GET_INTERIOR_FROM_ENTITY",subject);
                    bool sameInterior=witnessInterior==subjectInterior;
                    bool clear=sameInterior&&NativeFunction.CallByName<bool>("HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT",witness,subject);
                    var receipt=WitnessPolicy.Evaluate(new WitnessGeometry {EventKind=kind,Observer=observer.CaptureRef,Source=signal.source,Target=signal.target,SampledGameTick=signal.gameTick,DistanceMeters=distance,SameInterior=sameInterior,ClearLosInFront=clear});
                    if(receipt.Status=="witnessed") result.Add(receipt);else if(receipt.Status=="unknown") witnessUnknown=Math.Min(int.MaxValue,witnessUnknown+1);else witnessRejected=Math.Min(int.MaxValue,witnessRejected+1);
                } catch { witnessUnknown=Math.Min(int.MaxValue,witnessUnknown+1); }
            }
            return result;
        }
        object SamplePrimaryOwner(EntityAnchor anchor) {try{return Association(anchor)?.PrimaryOwner?.Invoke();}catch{return null;}}
        string ObserverActivity(EntityAnchor anchor,Ped ped)
        {
            try {
                if(anchors.Resolve(anchor.CaptureRef)==null || ped.IsDead) return "unknown";
                if(NativeFunction.CallByName<bool>("IS_PED_IN_ANY_VEHICLE",ped,false)) {
                    var vehicle=ped.CurrentVehicle;if(vehicle==null || !vehicle.Exists()) return "in_vehicle";
                    var driver=vehicle.Driver;if(driver==null || !driver.Exists()) return "in_vehicle";
                    if(ReferenceEquals(driver,ped)) return "driving";
                    if(driver.Handle==ped.Handle || driver.MemoryAddress==ped.MemoryAddress) return "in_vehicle";
                    return "passenger";
                }
                var state=NpcStateStore.TryGetState(ped);
                if(state?.FollowPaused==true) return "unknown";
                if(state?.FollowPlayerOnFoot==true && !state.FollowPaused) return "following";
                if(ReferenceEquals(NpcTargeting.GetPlayerConversationPed(),ped)) return "conversation";
                // No supported complete hold/ambient-ownership sample yet.
                return "unknown";
            } catch {return "unknown";}
        }
        void Sample(EntityAnchor a,uint tick,long now)
        {
            if(anchors.Resolve(a.CaptureRef)==null) return;var p=(Ped)a.Entity;
            if(a.Observer) sampledSituations[a.CaptureRef]=new {captureRef=a.CaptureRef,sampledGameTick=tick,activity=ObserverActivity(a,p),situationRevision=++situationRevision,primaryOwner=SamplePrimaryOwner(a)};
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
            var witnessReceipts=(signal.witnessReceipts??new List<WitnessReceipt>()).Where(w=>w!=null&&w.Status=="witnessed"&&w.Channel!=null&&w.Basis!=null).Select(w=>new {observer=new {captureRef=w.Observer,kind="ped"},sampledGameTick=w.SampledGameTick,status=w.Status,reason=w.Reason,knowsSource=w.KnowsSource,knowsTarget=w.KnowsTarget,evidence=new {channel=w.Channel,basis=w.Basis,sampledGameTick=w.SampledGameTick}}).ToArray();
            channel.Send("signal",new {signal.signalId,signal.producer,signal.producerSequence,signal.kind,signal.target,signal.source,signal.gameTick,ageMs=Clamp(now-signal.receivedMs),signal.facts,witnessReceipts});
        }
        void Lifecycle(string kind,string pedId,object entity,bool interrupted,bool hadAudio)
        {
            if(!uint.TryParse(pedId,out var handle)) return;var target=CallbackAnchor(handle,entity,false);
            sensors.Enqueue(new RawSignal {producer="playback",kind=kind,target=target,gameTick=callbackTick,receivedMs=host.MonotonicMs,facts=new Dictionary<string,object>{{"interrupted",interrupted},{"hadAudio",hadAudio}}});
        }
        void PlaybackStarted(NpcPlaybackStartedEvent e) {try{Lifecycle("playback_started",e.PedId,e.SpeakerPed,false,false);}catch{}}
        void PlaybackEnded(NpcPlaybackEndedEvent e) {try{Lifecycle("playback_ended",e.PedId,e.SpeakerPed,e.WasInterrupted,e.HadAudio);}catch{}}
        public void OnNpcActionExecuted(Ped ped,string actionName,bool succeeded)
        {
            if(!IsAvailable || ReferenceEquals(ped,null) || !actionIndex.TryGetValue(ped,out var target)) return;
            string action=actionName=="followtarget"?"followtarget":actionName=="waithere"?"waithere":"other";
            sensors.Enqueue(new RawSignal {producer="action",kind="action_callback",target=target,gameTick=callbackTick,receivedMs=host.MonotonicMs,facts=new Dictionary<string,object>{{"action",action},{"succeeded",succeeded}}});
        }
        public void EnrichActor(Ped ped,ActorContext context)
        {
            if(!IsAvailable || context?.IntegrationBlocks==null || ped==null || context.PedId!=ped.Handle.ToString()) return;
            try {
                var existing=anchors.Current.FirstOrDefault(a=>a.Kind=="ped" && ReferenceEquals(a.Entity,ped));
                var owner=(roster()??new OwnedParticipant[0]).FirstOrDefault(p=>p!=null && ReferenceEquals(p.Ped,ped) && p.Current?.Invoke()==true);
                if(existing?.OwnerLifetime!=null && owner?.Lifetime!=existing.OwnerLifetime) return;
                ulong handle=Convert.ToUInt64(ped.Handle);var address=ped.MemoryAddress;
                var anchor=anchors.Retain(ped,handle,address,"ped",owner?.Lifetime,()=>Live(ped,handle,address) && (owner==null || owner.Current?.Invoke()==true),host.MonotonicMs,false,AnchorConsumer.TurnActor);
                if(anchor==null || anchors.Resolve(anchor.CaptureRef)==null) return;
                var block=new Dictionary<string,object>{{"version",1},{"hostRunId",host.HostRunId},{"worldEpoch",host.WorldEpoch},{"captureRef",anchor.CaptureRef},{"sampledGameTick",unchecked((uint)Game.GameTime)}};
                var association=Association(anchor);if(association!=null) {block["encounterId"]=association.EncounterId;block["incarnationId"]=association.Lifetime;}
                context.IntegrationBlocks.Add(new IntegrationJsonBlock("turnKnowledge",captureJson.Serialize(block)));
                UpdateIndexes();FlushControls();
            } catch { /* Optional capture omission cannot affect Essential dialogue. */ }
        }
        public void OnPedControlChanged(Ped ped,bool controlledByLsa) {}
        public void Shutdown()
        {Shutdown("integration_shutdown");}
        internal void Shutdown(string reason)
        {
            if(stopped) return;shutdownReason=reason;stopped=true;sensors.Enabled=false;
            LogStatus("[PS] shutdown "+RuntimeStatus());
            AppDomain.CurrentDomain.AssemblyLoad-=AssemblyLoaded;
            try{damage?.Dispose();}catch{}damage=null;
            if(playback) {try{NpcPlaybackCoordinator.PlaybackStarted-=PlaybackStarted;NpcPlaybackCoordinator.PlaybackEnded-=PlaybackEnded;}catch{}playback=false;}
            director.Disable();channel?.Dispose();anchors.Retired-=OnRetired;host.WorldChanged-=WorldChanged;
            if(ownsHost) host.Shutdown();sensors.Reset();UpdateIndexes();
        }
    }
}
