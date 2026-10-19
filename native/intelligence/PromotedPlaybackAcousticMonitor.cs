using System;
using System.Collections.Generic;
using System.Linq;
using Rage;
using Rage.Native;

namespace LSA.Intelligence {
    // Diagnostic-only source-time bridge from Essential's REAL NPC playout
    // START/END to the same acoustic grade used by player-mic C01. Never edits
    // PCM, authorizes dialogue/memory, redirects targeting, or invokes TTS/STT.
    // No ambient pedestrian enters the speaker/listener set.
    internal sealed class PromotedPlaybackAcousticMonitor {
        internal sealed class PlaybackFact {
            internal bool Starting,Interrupted,HadAudio,PlaybackStarted;
            internal Ped Speaker;
            internal string PedId,TurnId;
            internal long Generation;
        }
        sealed class Turn {
            internal string Key,Id,SourceRef;
            internal Ped Ped;internal ulong Handle;internal IntPtr Address;
            internal long Since,LastSample=-1;
            internal int Epoch,Cursor,Transitions;
            internal readonly Dictionary<string,string> LastGrades=
                new Dictionary<string,string>(StringComparer.Ordinal);
        }
        readonly object gate=new object();
        readonly Queue<PlaybackFact> queue=new Queue<PlaybackFact>();
        readonly Dictionary<string,Turn> active=new Dictionary<string,Turn>(StringComparer.Ordinal);
        bool overflow;
        int activeCursor;
        internal int ActiveCount=>active.Count;
        internal int DroppedEvents {get;private set;}
        internal void Enqueue(PlaybackFact fact) {
            if(fact==null)return;
            lock(gate) {
                if(overflow)return;
                if(queue.Count>=32) {queue.Clear();overflow=true;DroppedEvents++;return;}
                queue.Enqueue(fact);
            }
        }
        internal void Clear() {
            lock(gate){queue.Clear();overflow=false;}
            active.Clear();activeCursor=0;
        }
        static string Key(PlaybackFact f)=>f.PedId+":"+f.TurnId+":"+f.Generation;
        static void SafeLog(Action<string> log,string message){try{log?.Invoke(message);}catch{}}
        static string Hash(string input)=>IntelligenceIntegration.TraceCode(input);
        internal void Update(EntityAnchors anchors,Func<EntityAnchor,bool> currentOwner,
            Ped player,int epoch,long now,ref int losBudget,Action<string> log) {
            PlaybackFact[] batch;bool invalid;
            lock(gate) {
                invalid=overflow;overflow=false;
                batch=queue.ToArray();queue.Clear();
            }
            if(invalid) {
                active.Clear();SafeLog(log,"[PR37_PLAYBACK] queue_overflow=1 active_retired=1");
                return;
            }
            foreach(var fact in batch) {
                if(string.IsNullOrEmpty(fact.PedId)||string.IsNullOrEmpty(fact.TurnId)||
                   fact.Generation<0)continue;
                string key=Key(fact);
                if(!fact.Starting) {
                    if(active.TryGetValue(key,out var old)) {
                        SafeLog(log,"[PR37_PLAYBACK] event=end speaker="+Hash(old.SourceRef)+
                            " turn="+Hash(old.Id)+" interrupted="+(fact.Interrupted?1:0)+
                            " had_audio="+(fact.HadAudio?1:0)+
                            " started="+(fact.PlaybackStarted?1:0)+
                            " sampled_transitions="+old.Transitions+" knowledge_grants=0");
                        active.Remove(key);
                    }
                    continue;
                }
                if(active.ContainsKey(key)||active.Count>=4||fact.Speaker==null)continue;
                ulong handle;IntPtr address;
                try {
                    if(!fact.Speaker.Exists()||fact.Speaker.IsDead||
                        !string.Equals(fact.PedId,fact.Speaker.Handle.ToString(),
                            StringComparison.Ordinal))continue;
                    handle=Convert.ToUInt64(fact.Speaker.Handle);
                    address=fact.Speaker.MemoryAddress;
                }catch{continue;}
                if(address==IntPtr.Zero)continue;
                var owner=anchors.Current.FirstOrDefault(a=>
                    IntelligenceIntegration.PromotedSpeechObserver(a) &&
                    a.Handle==handle && a.Address==address && a.Entity is Ped &&
                    anchors.Resolve(a.CaptureRef)!=null && currentOwner(a));
                if(owner==null)continue;
                active[key]=new Turn {Key=key,Id=fact.TurnId,
                    Ped=(Ped)owner.Entity,Handle=handle,Address=address,
                    SourceRef=owner.CaptureRef,Since=now,Epoch=epoch};
                SafeLog(log,"[PR37_PLAYBACK] event=start speaker="+Hash(owner.CaptureRef)+
                    " turn="+Hash(fact.TurnId)+" epoch="+epoch+
                    " native_event=started pcm_render_clock=unavailable dsp=unsupported");
            }
            int pairs=0,losProbes=0;
            var turns=active.Values.OrderBy(t=>t.Key,StringComparer.Ordinal).ToArray();
            for(int t=0;t<turns.Length;t++) {
                var turn=turns[(activeCursor+t)%turns.Length];
                if(turn.LastSample>=0 && now-turn.LastSample<100)continue;
                turn.LastSample=now;
                var source=anchors.Resolve(turn.SourceRef);
                bool valid=turn.Epoch==epoch && now>=turn.Since &&
                    now-turn.Since<=120000 &&
                    IntelligenceIntegration.PromotedSpeechObserver(source) &&
                    ReferenceEquals(source.Entity,turn.Ped) &&
                    source.Address==turn.Address && source.Handle==turn.Handle &&
                    currentOwner(source);
                try {valid=valid && turn.Ped.Exists() && !turn.Ped.IsDead &&
                    turn.Ped.MemoryAddress==turn.Address &&
                    Convert.ToUInt64(turn.Ped.Handle)==turn.Handle;}catch{valid=false;}
                if(!valid) {
                    active.Remove(turn.Key);
                    SafeLog(log,"[PR37_PLAYBACK] event=retired turn="+Hash(turn.Id)+
                        " reason=owner_epoch_or_timeout no_knowledge=1");
                    continue;
                }
                var others=anchors.Current.Where(a=>
                    a.CaptureRef!=turn.SourceRef &&
                    IntelligenceIntegration.PromotedSpeechObserver(a) &&
                    a.Entity is Ped && anchors.Resolve(a.CaptureRef)!=null &&
                    currentOwner(a)).OrderBy(a=>a.CaptureRef,StringComparer.Ordinal)
                    .Take(15).ToArray();
                int count=others.Length+1;
                for(int i=0;i<count && pairs<4;i++) {
                    int index=(turn.Cursor+i)%count;
                    bool isPlayer=index==0;
                    string listenerRef=isPlayer?"player":others[index-1].CaptureRef;
                    var listener=isPlayer?player:(Ped)others[index-1].Entity;
                    if(listener==null)continue;
                    try {if(!listener.Exists()||listener.IsDead)continue;}catch{continue;}
                    pairs++;
                    double distance=double.NaN;
                    string grade="unknown",reason="unavailable",sv="unknown",lv="unknown",
                        interior="unknown",car="unknown";
                    try {
                        distance=turn.Ped.Position.DistanceTo(listener.Position);
                        sv=VehicleMode(turn.Ped);lv=VehicleMode(listener);
                        int first=NativeFunction.CallByName<int>("GET_INTERIOR_FROM_ENTITY",turn.Ped);
                        int second=NativeFunction.CallByName<int>("GET_INTERIOR_FROM_ENTITY",listener);
                        interior=first==second?"same":"different";
                        bool sameCar=false;
                        if(sv=="enclosed"&&lv=="enclosed") {
                            var a=turn.Ped.CurrentVehicle;var b=listener.CurrentVehicle;
                            sameCar=a!=null&&b!=null&&a.Exists()&&b.Exists()&&
                                a.MemoryAddress!=IntPtr.Zero&&a.MemoryAddress==b.MemoryAddress;
                        }
                        car=sameCar?"same":"different_or_none";
                        bool barrier=interior!="same" || sv=="unknown" || lv=="unknown" ||
                            (sv=="enclosed"||lv=="enclosed")&&!sameCar;
                        bool needsLos=!barrier&&distance<=12;
                        bool checkedLos=false,clearLos=false;
                        if(needsLos && losBudget>0 && losProbes<2) {
                            checkedLos=true;losBudget--;losProbes++;
                            clearLos=NativeFunction.CallByName<bool>(
                                "HAS_ENTITY_CLEAR_LOS_TO_ENTITY",listener,turn.Ped,17);
                        }
                        grade=IntelligenceIntegration.SpeechAcousticGrade(distance,
                            interior=="same",sv,lv,sameCar,clearLos);
                        if(needsLos&&!checkedLos){grade="unknown";reason="los_budget";}
                        else reason=barrier?"barrier":!clearLos&&needsLos?"los_blocked":"sampled";
                    }catch{grade="unknown";reason="native_unavailable";}
                    if(turn.LastGrades.TryGetValue(listenerRef,out var prior) && prior==grade)
                        continue;
                    turn.LastGrades[listenerRef]=grade;
                    if(turn.Transitions++>=64)continue;
                    SafeLog(log,"[PR37_ACOUSTIC] source="+Hash(turn.SourceRef)+
                        " listener="+(isPlayer?"player":Hash(listenerRef))+
                        " turn="+Hash(turn.Id)+" epoch="+turn.Epoch+
                        " host_ms="+now+" tick="+Game.GameTime+
                        " offset_ms="+(now-turn.Since)+
                        " distance_m="+Math.Round(distance,1)+
                        " source_vehicle="+sv+" listener_vehicle="+lv+
                        " same_car="+car+" interior="+interior+
                        " window=unknown grade="+grade+" reason="+reason+
                        " applied_gain=none applied_filter=none knowledge_grants=0");
                }
                turn.Cursor=(turn.Cursor+Math.Min(4,count))%count;
            }
            if(turns.Length>0)activeCursor=(activeCursor+1)%turns.Length;
        }
        static string VehicleMode(Ped p) {
            try {return NativeFunction.CallByName<bool>("IS_PED_IN_ANY_VEHICLE",p,false)?
                "enclosed":"on_foot";}catch{return "unknown";}
        }
    }
}
