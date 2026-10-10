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
    // Native P2's existing current encounter is the authority for these
    // read-only fields. Unknown/foreign/residual ownership never means idle.
    public sealed class DirectorOwnerSample
    {
        public string Owner,Mode;
        public bool Suspended;
        public int Revision;
    }
    public sealed class OwnedParticipant
    {
        public Ped Ped;
        public string Lifetime, EncounterId;
        public Func<bool> Current;
        public Func<object> PrimaryOwner;
        public Func<DirectorOwnerSample> DirectorOwner;
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
        readonly bool directorExperimental;
        readonly DirectorAdmission director;
        readonly DirectorSchedulerIntake stockScheduler;
        readonly DirectorPs3Receipts ps3Receipts;
        readonly DirectorOriginalTurnReceipts originalTurns;
        // Core callback thread is not established as the host owner fiber.
        // Only Update consumes this bounded read-only callback queue.
        readonly object directorPlaybackGate=new object();
        readonly Queue<DirectorPlaybackEvent> directorPlaybackEvents=new Queue<DirectorPlaybackEvent>();
        bool directorPlaybackOverflow;
        sealed class DirectorPlaybackEvent
        {
            public Ped Speaker;
            public string PedId,TurnId,Reason;
            public long GenerationId;
            public bool Started,Interrupted,HadAudio,PlaybackStarted;
        }
        EssentialMicState directorMic;
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
        // Exact native P0/P2 lifetime, never a PedId or character-name fallback.
        // Keep the last qualified promoted turn actor eligible when Essential
        // releases or changes the current conversation target.
        string promotedTurnObserverRef;
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
        // Fixed diagnostic codes only. Never log any GTA entity or ticket ID.
        void LogDirectorVeto(string stage,string reason)
        {
            if(directorShadow)LogStatus("[PS] director_admission_veto stage="+stage+" reason="+reason);
        }
        // Fixed literals only. No ticket, Ped, context, character or freeform
        // exception text can reach the GTA diagnostic log.
        void LogDirectorHandoff(string stage,string status,string reason)
        {
            if(directorShadow)LogStatus("[PS] director_handoff stage="+stage+
                " status="+status+" reason="+reason);
        }
        static readonly string[] capabilityNames={"snapshot","pedDamage","playerDamage","vehicleDamage","shooting","state","action","playback","witness","awareness","playerSpeech"};
        public IntelligenceIntegration(Func<OwnedParticipant[]> roster,string pipeName="LSA.Intelligence.v1",HostContext host=null,bool directorShadow=false,bool directorExperimental=false) {
            if(pipeName==null||!System.Text.RegularExpressions.Regex.IsMatch(pipeName,"^[A-Za-z0-9_.-]{1,80}$")) throw new ArgumentException();
            this.roster=roster;this.pipeName=pipeName;ownsHost=host==null;this.host=host??new HostContext();anchors=this.host.Anchors;
            this.directorShadow=directorShadow || directorExperimental;
            this.directorExperimental=directorExperimental;
            ps3Receipts=new DirectorPs3Receipts(()=>this.host.MonotonicMs,()=>this.host.HostRunId,()=>this.host.WorldEpoch);
            originalTurns=new DirectorOriginalTurnReceipts(()=>this.host.MonotonicMs,
                ()=>this.host.HostRunId,()=>this.host.WorldEpoch,
                ()=>LSA.PromotedCharacters.EssentialPlayerPriorityMonitor.Read());
            // This preview endpoint never acquires C-11 speech authority.
            // Verified native C-06 + Essential intake are deliberately absent.
            director=new DirectorAdmission(()=>this.host.MonotonicMs,(r,stage)=>{
                var snapshot=ReadDirectorC06(r);
                bool occupied=stage=="bind" || stage=="playback_started" || stage=="complete";
                bool safe=occupied ? DirectorC06Policy.CurrentOccupiedPlayback(r,snapshot) :
                    DirectorC06Policy.Safe(r,snapshot);
                if(!safe)LogDirectorVeto(stage,DirectorC06Policy.FirstVeto(r,snapshot,stage));
                return safe;
            },()=>this.host.HostRunId,()=>this.host.WorldEpoch,directorExperimental,
                ()=>LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.ReadPlayerTurnVersion(),
                ()=>this.directorShadow ? LSA.PromotedCharacters.EssentialPlayerPriorityMonitor.Read() : -1,
                (stage,reason)=>LogDirectorVeto(stage,reason));
            // #3A compiles and binds the real pinned Essential Submit method.
            // This adapter is intentionally, unconditionally DEFAULT-OFF:
            // #3B must bind native callback tuple before activation.
            stockScheduler=DirectorSchedulerIntake.Production(director,directorExperimental,
                (status,reason)=>LogDirectorHandoff("scheduler",status,reason));
            this.host.WorldChanged+=WorldChanged;capabilities=capabilityNames.ToDictionary(k=>k,k=>false);
        }
        void WorldChanged(int epoch,string reason) {
            if(!IsAvailable) return;
            director.Reset();ps3Receipts.Reset();originalTurns.Reset();lock(directorPlaybackGate) {directorPlaybackEvents.Clear();directorPlaybackOverflow=false;}sensors.Reset();lock(rosterGate) {publishedAnchorStates.Clear();publishedObserverIndex.Clear();sampledSituations.Clear();}pendingRetirements.Clear();
            conversationRef=null;promotedTurnObserverRef=null;discoverySnapshot=null;discoveryOwned=new OwnedParticipant[0];UpdateIndexes();
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
                // Resolve only after Core DLL pin. Missing/unreadable private mic
                // field remains an UNKNOWN veto, never inferred idle.
                directorMic=new EssentialMicState();
                 // Read-only source-pinned original Core entry observer, only
                 // in an explicitly requested Director shadow runtime. This
                 // is a takeover revision fence, NOT permission to declare
                 // complete player/Essential ownership idle.
                 if(directorShadow)LSA.PromotedCharacters.EssentialPlayerPriorityMonitor.Attach();
                sensors.Enabled=true;sensors.WitnessEvaluator=CaptureWitnesses;anchors.Retired+=OnRetired;anchors.Retirement+=OnRetirement;
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
        void OnRetirement(EntityAnchor a,AnchorRetirement reason)
        {
            if(a?.Consumers?.Contains(AnchorConsumer.TurnActor)==true)
                LogStatus("[PS] turn_actor_retired reason="+reason.ToString().ToLowerInvariant());
        }
        void OnRetired(EntityAnchor a) {if(a.CaptureRef==promotedTurnObserverRef) promotedTurnObserverRef=null;ps3Receipts.Retire(a.OwnerLifetime);retiredAnchors=Math.Min(int.MaxValue,retiredAnchors+1);sensors.Retire(a.CaptureRef);lock(rosterGate) {publishedAnchorStates.Remove(a.CaptureRef);publishedObserverIndex.Remove(a.CaptureRef);sampledSituations.Remove(a.CaptureRef);}if(pendingRetirements.Count<256) pendingRetirements.Add(a.CaptureRef);else channel?.Dispose();}
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
                ps3Receipts.Retire(lifetime);
                if(director.RevokeOwner(lifetime))lock(directorPlaybackGate) {
                    directorPlaybackEvents.Clear();directorPlaybackOverflow=false;
                }
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
                if(channel.ConnectionVersion!=connectionVersion) {ps3Receipts.Reset();director.Reset();connectionVersion=channel.ConnectionVersion;lock(rosterGate) {publishedAnchorStates.Clear();publishedObserverIndex.Clear();sampledSituations.Clear();}nextRefresh=0;}
                if(now>=nextDiscovery) {
                    nextDiscovery=now+200;
                    var player=Game.LocalPlayer.Character;
                    foreach(var oldPlayer in anchors.Current.Where(a=>a.Kind=="player" && !ReferenceEquals(a.Entity,player))) anchors.Retire(oldPlayer.CaptureRef);
                    Retain(player,"player");
                    var owned=roster()??new OwnedParticipant[0];var selected=NpcTargeting.GetPlayerConversationPed()??NpcTargeting.GetCurrentSpeakerPed();
                    if(selected==player) selected=null;
                    var selectedOwner=owned.FirstOrDefault(p=>p?.Ped!=null && ReferenceEquals(p.Ped,selected));
                    var orderedOwned=owned.Where(p=>p?.Ped!=null).OrderBy(p=>p.Lifetime,StringComparer.Ordinal).ToArray();
                    // Discovery used to overwrite the observer promotion from
                    // EnrichActor on the next 200 ms tick. In a full roster a
                    // different current target could evict the same live P2
                    // actor before its next voice/typed P0 capture.
                    var recentTurn=promotedTurnObserverRef==null?null:anchors.Current.FirstOrDefault(a=>
                        a.CaptureRef==promotedTurnObserverRef && a.Kind=="ped" && a.OwnerLifetime!=null);
                    var recentTurnOwner=recentTurn==null?null:orderedOwned.FirstOrDefault(p=>
                        p.Lifetime==recentTurn.OwnerLifetime && ReferenceEquals(p.Ped,recentTurn.Entity));
                    if(recentTurnOwner!=null) {
                        // Revalidate the original native wrapper, handle,
                        // address, owner incarnation and current P2 claim.
                        // Never transfer priority to a replacement lifetime.
                        var retained=Retain(recentTurnOwner.Ped,"ped",recentTurnOwner.Lifetime,false,recentTurnOwner.Current);
                        if(retained?.CaptureRef!=promotedTurnObserverRef ||
                           anchors.Resolve(promotedTurnObserverRef)==null) recentTurnOwner=null;
                    }
                    if(recentTurnOwner==null) promotedTurnObserverRef=null;
                    var ownedPriority=new List<OwnedParticipant>();
                    if(selectedOwner!=null) ownedPriority.Add(selectedOwner);
                    if(recentTurnOwner!=null && !ownedPriority.Any(p=>p.Lifetime==recentTurnOwner.Lifetime))
                        ownedPriority.Add(recentTurnOwner);
                    foreach(var p in orderedOwned) {
                        if(ownedPriority.Count>= (selected==null?16:15)) break;
                        if(!ownedPriority.Any(candidate=>candidate.Lifetime==p.Lifetime)) ownedPriority.Add(p);
                    }
                    var ownedRetained=orderedOwned.Take(16).ToList();
                    if(selectedOwner!=null && !ownedRetained.Any(p=>p.Lifetime==selectedOwner.Lifetime)) ownedRetained.Add(selectedOwner);
                    if(recentTurnOwner!=null && !ownedRetained.Any(p=>p.Lifetime==recentTurnOwner.Lifetime)) ownedRetained.Add(recentTurnOwner);
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
                DrainDirectorCorePlayback();
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
                    nextDiagnostics=now+1000;
                    // Native-sourced player-turn version, never inferred from
                    // a sampled mic snapshot or a JS observation. The Core
                    // version is independently rechecked at every admission.
                    if(directorShadow) {
                        long nativeVersion=-1;
                        try {nativeVersion=LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.ReadPlayerTurnVersion();}catch {}
                        if(nativeVersion>=0 && nativeVersion<=int.MaxValue)
                            channel.Send("director_priority",new {playerTurnVersion=(int)nativeVersion,experimentalEnabled=directorExperimental});
                    }
                    int age=capabilities["snapshot"]?(int)Math.Min(int.MaxValue,(long)unchecked(tick-snapshotTick)):int.MaxValue;
                    var signals=sensors.Counters;
                    var damageCallbacks=sensors.DamageCallbacks;
                    channel.Send("diagnostics",new {anchors=anchors.Count,observers=anchors.ObserverCount,snapshotAgeMs=age,snapshotCadenceMs=Clamp(snapshotCadence),dropped=Clamp(sensors.Dropped+channel.Dropped),staleRejected=Clamp(staleRejected),retiredAnchors=Clamp(retiredAnchors),deferredDiscovery=Clamp(deferredDiscovery),updateMicros=Clamp((long)(budget.Elapsed.TotalMilliseconds*1000)),capabilities,signals,damageCallbacks,witnessDeferred=Clamp(witnessDeferred),witnessUnknown=Clamp(witnessUnknown),witnessRejected=Clamp(witnessRejected),playerSpeechGate="unsupported_capture_receipt"});
                    if(now>=nextLog) {nextLog=now+10000;Game.LogTrivial("[PS] shadow anchors="+anchors.Count+" observers="+anchors.ObserverCount+" snapshot_age_ms="+age+" snapshot_cadence_ms="+Clamp(snapshotCadence)+" dropped="+Clamp(sensors.Dropped+channel.Dropped)+" stale="+Clamp(staleRejected)+" retired="+Clamp(retiredAnchors)+" deferred="+Clamp(deferredDiscovery)+" update_us="+Clamp((long)(budget.Elapsed.TotalMilliseconds*1000))+" capabilities="+string.Join(",",capabilities.Where(c=>c.Value).Select(c=>c.Key))+" damage_callbacks=ped:"+damageCallbacks["ped_damage"]+",player:"+damageCallbacks["player_damage"]+",vehicle:"+damageCallbacks["vehicle_damage"]+" signals="+string.Join(",",signals.Select(c=>c.Key+":"+c.Value)));}
                }
                Count(ref completedUpdates);Interlocked.Exchange(ref lastCompletedMs,host.MonotonicMs);
            } catch {LogStatus("[PS] optional_update_failed");Shutdown("update_failed");}
        }
        // Read only what the current Core/P2/PS host can independently prove.
        // Pinned Core exposes a special-turn counter and global queued/playback
        // check, but no complete player-turn arbiter, Essential active-turn
        // authority or native PS3 entitlement echo. Those critical gates stay
        // false/-1. Merely matching a
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
                // On this pinned Core GetCurrentSpeakerPed delegates to
                // GetPlayerConversationPed. Sampling both is a consistency
                // re-read of the SAME target, not two independent authorities.
                // A null target does not prove a queued/active Essential turn
                // is idle; a failed read still rejects.
                var conversation=NpcTargeting.GetPlayerConversationPed();
                var currentSpeaker=NpcTargeting.GetCurrentSpeakerPed();
                proof.ConversationStateKnown=true;
                proof.ConversationIdle=conversation==null && currentSpeaker==null;
                // These flags observe the *actual* Core input UI; they do
                // not attest to queued or already-submitted text inference.
                proof.TextInputIdle=!LosSantosAlive.Input.TextInputService.IsOpen;
                proof.TextInputKnown=true;
                proof.ControlsInputIdle=!LosSantosAlive.Core.LsaControlsMenu.BlocksLsaInput;
                proof.ControlsInputKnown=true;
                // Pinned Essential public APIs: the special-turn revision is
                // only a partial player-priority signal, never a global idle
                // authorization. An unreadable Core sample fails closed.
                long specialTurnVersion=LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.ReadPlayerTurnVersion();
                if(specialTurnVersion>=0) {
                    proof.SpecialTurnVersion=specialTurnVersion;
                    proof.SpecialTurnVersionKnown=true;
                }
                // Includes both current NPC playback and queued audio. Merely
                // checking IsPedCurrentlySpeaking would miss pending playback.
                proof.PlaybackIdle=!NpcPlaybackCoordinator.IsAnyAudioPlayingOrPending();
                proof.PlaybackKnown=true;
                var mic=directorMic;
                if(mic?.Available==true) {
                    string status=mic.CanStart();
                    proof.MicStateKnown=status==null || status=="mic_busy";
                    proof.MicIdle=status==null;
                }
                var current=(roster()??new OwnedParticipant[0]).FirstOrDefault(item=>
                    item!=null && item.Ped!=null && speaker!=null &&
                    ReferenceEquals(item.Ped,speaker.Entity) &&
                    item.Lifetime==speaker.OwnerLifetime && item.Current?.Invoke()==true);
                proof.OwnerIncarnationId=current?.Lifetime;
                proof.OwnerProofCurrent=current!=null;
                if(current!=null) {
                    // Only the exact current P2 registration supplies a mode.
                    // Essential-residual "unknown", active P2/ACT tasks and a
                    // suspended encounter cannot be presented as idle.
                    var mode=current.DirectorOwner?.Invoke();
                    // P2's own Encounter setter increments this exact original
                    // registered incarnation on every owner/suspension change.
                    // It is NOT a stand-in for a PS3 response grant.
                    if(mode!=null && mode.Revision>0)
                        proof.OwnerProofRevision=mode.Revision;
                    proof.OwnerPrimaryModeKnown=mode!=null &&
                        (mode.Owner=="none" || mode.Owner=="p2" ||
                         mode.Owner=="act" || mode.Owner=="essential_residual") &&
                        (mode.Mode=="idle" || mode.Mode=="unknown" ||
                         mode.Mode=="follow" || mode.Mode=="wait" ||
                         mode.Mode=="sit" || mode.Mode=="activity");
                    // A P2 follow order owns locomotion, not the voice turn.
                    // Permit the same live, unsuspended follower to speak
                    // spontaneously; C-06 independently rejects mic, text,
                    // conversation, pending audio, reflex and script conflicts.
                    // ACT tasks, residual/unknown modes and suspension stay busy.
                    proof.OwnerIdle=proof.OwnerPrimaryModeKnown && !mode.Suspended &&
                        (mode.Owner=="none" && mode.Mode=="idle" ||
                         mode.Owner=="p2" && mode.Mode=="follow");
                    // Following controls movement, not dialogue. Source
                    // proof is from this exact native P2 owner incarnation.
                    // An unknown, ACT, or suspended owner never qualifies.
                    proof.CompatibleLocomotion=proof.OwnerPrimaryModeKnown &&
                        !mode.Suspended && mode.Owner=="p2" && mode.Mode=="follow"
                        ? "p2_follow" : null;
                    // Source-pinned Core NpcStateStore is used by existing ACT
                    // preflight; no state is UNKNOWN, not absence of a reflex.
                    var state=NpcStateStore.TryGetState((Ped)speaker.Entity);
                    if(state!=null) {
                        proof.ActorReflexKnown=true;
                        proof.ActorReflexIdle=!state.HasActiveReflex && !state.InDirectedInteraction;
                    }
                }
                // P2 already uses these exact GTA scripted-state natives.
                // Every read must succeed before "safe" can be asserted.
                proof.ScriptSafe=!NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") &&
                    !NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING") &&
                    !NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") &&
                    !NativeFunction.CallByName<bool>("GET_MISSION_FLAG") &&
                    !NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE");
                proof.ScriptStateKnown=true;
                // Original native P2/source-signal evidence and independently
                // received authenticated companion PS3 receipt must match.
                // Only original fields from this sealed receipt populate C06.
                var original=ps3Receipts.OriginalFor(r);
                if(original==null)
                    LogDirectorVeto("ps3_current",ps3Receipts.LastCurrentFailure??"grant_unknown");
                if(original!=null) {
                    proof.ObservationId=original.ObservationId;
                    proof.ObservationRevision=original.ObservationRevision;
                    proof.DecisionKey=original.DecisionKey;
                    proof.ObservationReceiptCurrent=true;
                    proof.ResponseGrantCurrent=true;
                }
                // Source-verified, sealed original backend turn evidence must
                // be delivered on the authenticated PS pipe BEFORE this exact
                // native request. It is independently checked against the
                // original Core input observer revision on the owner fiber and
                // expires quickly. Matching a requested playerTurnVersion
                // alone never authorizes idle or rebinds a changed source.
                var owner=originalTurns.OriginalFor(r);
                if(owner!=null && proof.SpecialTurnVersionKnown &&
                   proof.SpecialTurnVersion<=int.MaxValue &&
                   owner.PlayerTurnVersion==(int)proof.SpecialTurnVersion &&
                   LSA.PromotedCharacters.EssentialPlayerPriorityMonitor.Read()>=0) {
                    proof.PlayerTurnVersion=(int)proof.SpecialTurnVersion;
                    proof.PlayerTurnSourceCurrent=true;
                    proof.PlayerTurnIdle=owner.Quiet;
                    proof.EssentialTurnKnown=true;
                    proof.EssentialTurnIdle=owner.Quiet;
                }
                // This proves an ordered *past* backend sample and a live Core
                // negative fence. A backend transition after the sample must
                // still be checked by the original JS owner before publication.
                // Director stays disabled until that handoff is exercised.
            } catch { return new DirectorC06Policy.Snapshot(); }
            return proof;
        }
        // #3A: a bounded original stock scheduler message, with NO grant
        // fields supplied by its sender. The native owner-fiber reconstructs
        // the exact immutable submitted ticket and original anchors itself.
        bool TryDirectorStockIntake(DirectorStockIntakeCodec.Frame input)
        {
            if(!directorShadow || input==null)return false;
            var original=director.SubmittedForStockIntake(input.TicketId);
            if(original==null || input.DedupeKey!=original.DedupeKey) {
                LogDirectorHandoff("native_intake","rejected","ticket_not_submitted");
                return false;
            }
            if(!ps3Receipts.IsReserved(original)) {
                LogDirectorHandoff("native_intake","rejected","ps3_grant_not_reserved");
                return false;
            }
            if(originalTurns.OriginalFor(original)==null) {
                LogDirectorHandoff("native_intake","rejected","backend_owner_not_current");
                return false;
            }
            var speaker=anchors.Resolve(original.SpeakerCaptureRef)?.Entity as Ped;
            var player=anchors.Resolve(original.PlayerCaptureRef)?.Entity as Ped;
            // Resolve through the *original native reservation*, never
            // a claimed PedId, latest focus or replacement owner.
            if(speaker==null||player==null||
                !ReferenceEquals(player,Game.LocalPlayer.Character)) {
                LogDirectorHandoff("native_intake","rejected","native_anchor_mismatch");
                return false;
            }
            if(!originalTurns.CaptureForBinding(original)) {
                LogDirectorHandoff("native_intake","rejected","binding_source_capture_denied");
                return false;
            }
            bool submitted=stockScheduler.Dispatch(input.TicketId,input.Context,
                ReadDirectorC06(original),speaker,player);
            LogDirectorHandoff("native_intake",submitted?"accepted":"rejected",
                submitted?"scheduler_submission_accepted":"scheduler_submission_denied");
            if(!submitted)originalTurns.Retire(input.TicketId);
            return submitted;
        }
        // 3B exact original generation report from the existing paired pipe.
        // No wire-supplied ticket, source epoch or PedId grants authority.
        // A report can bind once only after a consumed stock Submit and an
        // independently retained native Core/source reservation. If backend
        // ownership has already changed or its lease expired, fail closed.
        bool TryDirectorOriginalTurnBinding(DirectorOriginalTurnBindingCodec.Frame frame)
        {
            if(!directorShadow || frame==null)return false;
            var request=director.ClaimedForOriginalBinding(frame.TicketId);
            if(request==null || frame.HostRunId!=request.HostRunId ||
               frame.WorldEpoch!=request.WorldEpoch ||
               frame.SpeakerCaptureRef!=request.SpeakerCaptureRef) {
                LogDirectorHandoff("native_binding","rejected","ticket_or_epoch_mismatch");
                return false;
            }
            var source=originalTurns.SealedForBinding(request);
            if(source==null || frame.SourceRun!=source.SourceRun ||
               frame.SourceRevision!=source.Revision ||
               !ps3Receipts.IsReserved(request)) {
                LogDirectorHandoff("native_binding","rejected","original_source_or_grant_expired");
                return false;
            }
            var originalSpeaker=anchors.Resolve(request.SpeakerCaptureRef)?.Entity as Ped;
            var originalPlayer=anchors.Resolve(request.PlayerCaptureRef)?.Entity as Ped;
            uint nativePed;
            if(originalSpeaker==null || originalPlayer==null ||
               !originalSpeaker.Exists() || originalSpeaker.IsDead ||
               !originalPlayer.Exists() || originalPlayer.IsDead ||
               !ReferenceEquals(originalPlayer,Game.LocalPlayer.Character) ||
               !uint.TryParse(frame.PedId,out nativePed) ||
               Convert.ToUInt64(originalSpeaker.Handle)!=nativePed) {
                LogDirectorHandoff("native_binding","rejected","actor_or_player_identity_invalid");
                return false;
            }
            bool bound=director.BindActualTuple(frame.TicketId,frame.PedId,
                frame.TurnId,frame.GenerationId,frame.SessionNonce);
            LogDirectorHandoff("native_binding",bound?"accepted":"rejected",
                bound?"original_tuple_bound":"original_tuple_denied");
            // Binding consumes the sealed pre-turn source identity. Subsequent
            // playback checks use the immutable native admission reservation.
            originalTurns.Retire(frame.TicketId);
            return bound;
        }
        // Owner-fiber only. A separately versioned Director request can be
        // decoded and explicitly rejected in shadow, but never tasks an actor,
        // invokes kb/Essential, or consumes any PS3 response entitlement.
        void DrainDirectorPreview()
        {
            if(!directorShadow || channel==null)return;
            for(int n=0;n<4 && channel.TryTakeDirectorFrame(out var frame);n++) {
                DirectorOriginalTurnBindingCodec.Frame originalBinding;
                if(DirectorOriginalTurnBindingCodec.TryDecode(frame,out originalBinding)) {
                    // Core/source/P2/C-06 are authoritative here; the JS
                    // write itself is not acceptance. A bounded one-shot
                    // source waiter must receive this authenticated result
                    // before passing any Director text to the model.
                    bool bound=TryDirectorOriginalTurnBinding(originalBinding);
                    channel.Send("director_response",new {
                        directorRequestVersion=1,ticketId=originalBinding.TicketId,
                        status=bound?"bound":"unsafe"
                    });
                    continue;
                }
                DirectorStockIntakeCodec.Frame stockIntake;
                if(DirectorStockIntakeCodec.TryDecode(frame,out stockIntake)) {
                    // This emits no stock speech while the #3B handoff and
                    // callback binding are unavailable. No native scheduler
                    // result is represented as playback completion.
                    TryDirectorStockIntake(stockIntake);
                    continue;
                }
                DirectorOriginalTurnReceipts.Evidence ownerReceipt;
                if(DirectorOriginalTurnReceiptCodec.TryDecode(frame,out ownerReceipt)) {
                    originalTurns.Accept(ownerReceipt);
                    continue;
                }
                DirectorPs3Receipts.Grant sourceGrant;
                if(DirectorPs3ReceiptCodec.TryDecode(frame,out sourceGrant)) {
                    // Only the actual connected pipe reader delivers this
                    // frame. Issue/challenge and native original source signal
                    // validation are independent of the request vocabulary.
                    if(!ps3Receipts.Accept(sourceGrant))
                        LogDirectorVeto("ps3_accept",ps3Receipts.LastAcceptFailure??"grant_unknown");
                    continue;
                }
                if(!DirectorFrameCodec.TryDecode(frame,out var request))continue;
                var receipt=director.Handle(request);
                // The original source proof can be reserved only with its
                // exact one-use native reservation. The feature gate remains
                // OFF, so the production endpoint never consumes a grant.
                if(receipt.Status=="reserved" && !ps3Receipts.Reserve(request)) {
                    director.Handle(new DirectorAdmission.Request {
                        Version=request.Version,Operation="cancel",TicketId=request.TicketId,
                        DedupeKey=request.DedupeKey,HostRunId=request.HostRunId,
                        WorldEpoch=request.WorldEpoch,SpeakerCaptureRef=request.SpeakerCaptureRef,
                        PlayerCaptureRef=request.PlayerCaptureRef,OwnerIncarnationId=request.OwnerIncarnationId,
                        ProofRevision=request.ProofRevision,PlayerTurnVersion=request.PlayerTurnVersion,
                        PolicyVersion=request.PolicyVersion,ObservationId=request.ObservationId,
                        ObservationRevision=request.ObservationRevision,DecisionKey=request.DecisionKey,
                        AgeMs=request.AgeMs
                    });
                    receipt=new DirectorAdmission.Receipt(request.TicketId,"unsafe");
                }
                if(request.Operation=="cancel") {ps3Receipts.ClearGrant(request.TicketId);originalTurns.Retire(request.TicketId);}
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
            // Give the finite native LOS budget to actual P2-owned companions first.
            // Equal-priority observers are nearest-first with a stable private
            // tie-breaker. This does not broaden witness geometry or invent proof.
            foreach(var observer in anchors.Current.Where(a=>a.Observer&&a.Kind=="ped"&&a.CaptureRef!=participantRef)
                .OrderByDescending(a=>a.OwnerLifetime!=null)
                .ThenBy(a=>a.Entity is Ped p ? p.Position.DistanceTo(subject.Position) : float.MaxValue)
                .ThenBy(a=>a.CaptureRef,StringComparer.Ordinal)) {
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
                    bool openAcoustics=false,clearAcousticPath=false;
                    if(kind=="firing" && signal.producer=="shooting" &&
                       signal.source==participantRef && sameInterior && !clear) {
                        // Hearing from behind requires a SEPARATE actual native
                        // clear-path read, independently of the frontal sight cone.
                        // Both actors must be positively sampled on foot.
                        // Count this second LOS native against the same cap.
                        bool sourceOnFoot=!NativeFunction.CallByName<bool>(
                            "IS_PED_IN_ANY_VEHICLE",subject,false);
                        bool witnessOnFoot=!NativeFunction.CallByName<bool>(
                            "IS_PED_IN_ANY_VEHICLE",witness,false);
                        if(sourceOnFoot && witnessOnFoot && lineOfSightBudget>0) {
                            openAcoustics=true;lineOfSightBudget--;
                            clearAcousticPath=NativeFunction.CallByName<bool>(
                                "HAS_ENTITY_CLEAR_LOS_TO_ENTITY",witness,subject,17);
                        }
                    }
                    var receipt=WitnessPolicy.Evaluate(new WitnessGeometry {EventKind=kind,Observer=observer.CaptureRef,Source=signal.source,Target=signal.target,SampledGameTick=signal.gameTick,DistanceMeters=distance,SameInterior=sameInterior,ClearLosInFront=clear,
                        SoundSourceVerified=kind=="firing" && signal.producer=="shooting",
                        SameAcousticSpace=sameInterior,ClearAcousticPath=clearAcousticPath,
                        SourceVehicle=openAcoustics?"open":"unknown",
                        ObserverVehicle=openAcoustics?"open":"unknown"});
                    if(receipt.Status=="witnessed") result.Add(receipt);else if(receipt.Status=="unknown") witnessUnknown=Math.Min(int.MaxValue,witnessUnknown+1);else witnessRejected=Math.Min(int.MaxValue,witnessRejected+1);
                } catch { witnessUnknown=Math.Min(int.MaxValue,witnessUnknown+1); }
            }
            return result;
        }
        object SamplePrimaryOwner(EntityAnchor anchor) {try{return Association(anchor)?.PrimaryOwner?.Invoke();}catch{return null;}}
        // Exact current P2 roster association publishes this read-only native
        // owner incarnation revision. No clock, model or companion guess.
        int? SampleDirectorOwnerRevision(EntityAnchor anchor)
        {
            try {
                var version=Association(anchor)?.DirectorOwner?.Invoke()?.Revision??0;
                return version>0 ? (int?)version : null;
            } catch {return null;}
        }
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
            if(a.Observer) {
                var primaryOwner=SamplePrimaryOwner(a);
                var revision=++situationRevision;
                var ownerRevision=primaryOwner==null ? (int?)null : SampleDirectorOwnerRevision(a);
                // Native-issued challenge remains bound to this exact P2
                // incumbent and source revision across nearby samples.
                var challenge=directorShadow && a.OwnerLifetime!=null && ownerRevision>0
                    ? ps3Receipts.Issue(a.CaptureRef,a.OwnerLifetime,ownerRevision.Value,(int)revision)
                    : null;
                sampledSituations[a.CaptureRef]=new {
                    captureRef=a.CaptureRef,sampledGameTick=tick,
                    activity=ObserverActivity(a,p),situationRevision=revision,
                    primaryOwner,ownerProofRevision=ownerRevision,
                    ps3Challenge=challenge
                };
            }
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
            if(channel?.Send("signal",new {signal.signalId,signal.producer,signal.producerSequence,signal.kind,signal.target,signal.source,signal.gameTick,ageMs=Clamp(now-signal.receivedMs),signal.facts,witnessReceipts})==true) {
                var nativeWitnesses=witnessReceipts.Select(w=>w.observer.captureRef).ToList();
                foreach(var reference in new[]{signal.source,signal.target}) {
                    var actor=reference==null?null:anchors.Resolve(reference);
                    if(actor?.Observer==true && actor.Kind=="ped")nativeWitnesses.Add(reference);
                }
                ps3Receipts.SentSignal(signal.signalId,nativeWitnesses);
            }
        }
        void Lifecycle(string kind,string pedId,object entity,bool interrupted,bool hadAudio)
        {
            if(!uint.TryParse(pedId,out var handle)) return;var target=CallbackAnchor(handle,entity,false);
            sensors.Enqueue(new RawSignal {producer="playback",kind=kind,target=target,gameTick=callbackTick,receivedMs=host.MonotonicMs,facts=new Dictionary<string,object>{{"interrupted",interrupted},{"hadAudio",hadAudio}}});
        }
        void EnqueueDirectorPlayback(DirectorPlaybackEvent item)
        {
            if(!directorShadow || stopped || item==null)return;
            lock(directorPlaybackGate) {
                if(directorPlaybackEvents.Count>=32) {
                    directorPlaybackOverflow=true;
                    directorPlaybackEvents.Clear();
                } else if(!directorPlaybackOverflow)directorPlaybackEvents.Enqueue(item);
            }
        }
        // Owner fiber ONLY. Callback PedId/turn/generation are native evidence;
        // the callback contains NO session nonce or original PS6 ticket. An
        // earlier native BindActualTuple is mandatory. Wrong/reused ped wrappers
        // or world-retired capture refs cannot inherit an existing ticket.
        void DrainDirectorCorePlayback()
        {
            bool overflow;DirectorPlaybackEvent[] events;
            lock(directorPlaybackGate) {
                overflow=directorPlaybackOverflow;
                directorPlaybackOverflow=false;
                events=directorPlaybackEvents.ToArray();
                directorPlaybackEvents.Clear();
            }
            if(overflow) {director.Reset();return;}
            foreach(var e in events) {
                if(e?.Speaker==null || string.IsNullOrWhiteSpace(e.PedId) ||
                    string.IsNullOrWhiteSpace(e.TurnId) || e.GenerationId<0)continue;
                if(!uint.TryParse(e.PedId,out var pedHandle) ||
                    Convert.ToUInt64(e.Speaker.Handle)!=pedHandle || !e.Speaker.Exists())continue;
                var token=CallbackAnchor(pedHandle,e.Speaker,false);
                var anchor=token==null?null:anchors.Resolve(token);
                if(anchor==null || !ReferenceEquals(anchor.Entity,e.Speaker))continue;
                // The callback is not a ticket. Match the previously bound
                // native original tuple before emitting a status on the same
                // authenticated PS channel. A failed playback never consumes
                // the companion's PS3 grant.
                var ticket=director.OriginalBoundTicket(token,e.PedId,e.TurnId,e.GenerationId);
                if(ticket==null)continue;
                if(e.Started) {
                    if(director.ObserveCorePlaybackStarted(token,e.PedId,e.TurnId,e.GenerationId))
                        channel?.Send("director_response",new {
                            directorRequestVersion=1,ticketId=ticket,status="started"});
                } else {
                    bool delivered=director.ObserveCorePlaybackEnded(token,e.PedId,e.TurnId,e.GenerationId,
                        e.Reason,e.Interrupted,e.HadAudio,e.PlaybackStarted);
                    channel?.Send("director_response",new {
                        directorRequestVersion=1,ticketId=ticket,status=delivered?"completed":"failed"});
                }
            }
        }
        void PlaybackStarted(NpcPlaybackStartedEvent e)
        {
            try {
                Lifecycle("playback_started",e.PedId,e.SpeakerPed,false,false);
                EnqueueDirectorPlayback(new DirectorPlaybackEvent{
                    Started=true,Speaker=e.SpeakerPed,PedId=e.PedId,
                    TurnId=e.TurnId,GenerationId=e.GenerationId});
            } catch {}
        }
        void PlaybackEnded(NpcPlaybackEndedEvent e)
        {
            try {
                Lifecycle("playback_ended",e.PedId,e.SpeakerPed,e.WasInterrupted,e.HadAudio);
                EnqueueDirectorPlayback(new DirectorPlaybackEvent{
                    Speaker=e.SpeakerPed,PedId=e.PedId,TurnId=e.TurnId,
                    GenerationId=e.GenerationId,Reason=e.Reason,
                    Interrupted=e.WasInterrupted,HadAudio=e.HadAudio,
                    PlaybackStarted=e.PlaybackStarted});
            } catch {}
        }
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
                if(existing?.OwnerLifetime!=null && owner?.Lifetime!=existing.OwnerLifetime) {
                    LogStatus("[PS] turn_actor_capture_unavailable reason=owner_changed");return;
                }
                ulong handle=Convert.ToUInt64(ped.Handle);var address=ped.MemoryAddress;
                var anchor=anchors.Retain(ped,handle,address,"ped",owner?.Lifetime,()=>Live(ped,handle,address) && (owner==null || owner.Current?.Invoke()==true),host.MonotonicMs,false,AnchorConsumer.TurnActor);
                if(anchor==null || anchors.Resolve(anchor.CaptureRef)==null) {
                    LogStatus("[PS] turn_actor_capture_unavailable reason=anchor_invalid");return;
                }
                // The exact P0 actor is a verified native Ped, not an inferred
                // 'last speaker'. Keep its current retained identity and admit
                // it as a PS observer before publishing the frozen turn capture.
                // This only affects FUTURE observations; it cannot fabricate
                // a witness receipt for events that already occurred.
                if(!anchor.Observer) {
                    var priorities=new[]{anchor.CaptureRef}.Concat(
                        anchors.Current.Where(a=>a.Observer && a.Kind=="ped" &&
                            a.CaptureRef!=anchor.CaptureRef)
                            .OrderByDescending(a=>a.OwnerLifetime!=null)
                            .ThenBy(a=>a.CaptureRef,StringComparer.Ordinal)
                            .Select(a=>a.CaptureRef));
                    anchors.SetObserverPriority(priorities);
                }
                if(!anchor.Observer) {
                    LogStatus("[PS] turn_actor_capture_unavailable reason=observer_slot_unavailable");return;
                }
                var block=new Dictionary<string,object>{{"version",1},{"hostRunId",host.HostRunId},{"worldEpoch",host.WorldEpoch},{"captureRef",anchor.CaptureRef},{"sampledGameTick",unchecked((uint)Game.GameTime)}};
                var association=Association(anchor);if(association!=null) {
                    // Only an exact current P2 registration can receive
                    // continuing priority. Ordinary P0 witnesses stay bounded
                    // by regular discovery/selection and do not gain ownership.
                    promotedTurnObserverRef=anchor.CaptureRef;
                    block["encounterId"]=association.EncounterId;block["incarnationId"]=association.Lifetime;
                }
                context.IntegrationBlocks.Add(new IntegrationJsonBlock("turnKnowledge",captureJson.Serialize(block)));
                UpdateIndexes();FlushControls();
                LogStatus("[PS] turn_actor_capture_created");
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
            director.Disable();ps3Receipts.Reset();originalTurns.Reset();lock(directorPlaybackGate) {directorPlaybackEvents.Clear();directorPlaybackOverflow=false;}channel?.Dispose();anchors.Retired-=OnRetired;anchors.Retirement-=OnRetirement;host.WorldChanged-=WorldChanged;
            if(ownsHost) host.Shutdown();sensors.Reset();UpdateIndexes();
        }
    }
}
