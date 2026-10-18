using System;
using System.Collections.Generic;
using LosSantosAlive.Audio;
using Rage;
namespace LSA.PromotedCharacters {
    // Essential owns playout. This is a passive subscriber, NOT another player.
    internal sealed class NpcVoicePresenceObserver : IDisposable {
        const int QueueLimit=32, GenerationHistoryLimit=256;
        // Exact-turn, read-only stall triage; bounded even for truly long speech.
        internal const long PlaybackAuditAfterMs=8000, PlaybackAuditCadenceMs=5000;
        internal const int PlaybackAuditMaxSamples=12;
        readonly object gate=new object();
        readonly Queue<Fact> queue=new Queue<Fact>();
        // The last generation survives an END or speaker change. Without this,
        // a delayed START can resurrect a finished (or superseded) old turn.
        // These entries are bounded and reset at world-epoch boundaries.
        readonly Dictionary<string,long> lastGeneration=new Dictionary<string,long>();
        readonly Queue<VoicePresenceTurnTracker.Key> generationOrder=new Queue<VoicePresenceTurnTracker.Key>();
        readonly VoicePresenceTurnTracker state;
        readonly NpcVoiceMouthOverlay mouth;
        readonly IPlayoutLevelSource levels;
        readonly bool levelLog;
        long lastLevelLogAt=-1,activeSinceMs=-1,lastPlaybackAuditAt=-1;
        int playbackAuditSamples;
        bool levelUnavailableLogged;
        bool attached,disposed,overflow;
        Ped ped; IntPtr address; uint handle; int epoch;
        readonly string mode;
        internal bool HasActiveTurn=>state.Active;
        internal long ActiveGeneration=>state.ActiveKey.Generation;
        internal uint ActiveHandle=>handle;
        sealed class Fact {internal bool Starting; internal Ped Speaker;internal VoicePresenceTurnTracker.Key Key;}
        // openLevel: Essential-RMS level (0..1) at which the mouth opens.
        // levelLog: opt-in, rate-limited read-only diagnostics for calibration.
        // levels: injectable for tests; production reads Essential's own getters.
        internal NpcVoicePresenceObserver(string mode,bool mouthEnabled=false,float openLevel=DefaultOpenLevel,
            bool levelLog=false,IPlayoutLevelSource levels=null) {
            this.mode=mode;
            state=new VoicePresenceTurnTracker(openLevel);
            this.levels=levels??new EssentialPlayoutLevelSource();
            this.levelLog=levelLog&&mode!="off";
            if(mode=="on" && mouthEnabled) mouth=new NpcVoiceMouthOverlay();
        }
        internal const float DefaultOpenLevel=0.015f;
        internal void Attach() {
            if(attached||disposed||mode=="off")return;
            NpcPlaybackCoordinator.PlaybackStarted+=Started;
            try {NpcPlaybackCoordinator.PlaybackEnded+=Ended;}
            catch {NpcPlaybackCoordinator.PlaybackStarted-=Started;throw;}
            attached=true;
            Game.LogTrivial("[VP] mode="+mode+" playback_events=ready level_source=essential_public_getter mouth="+
                (mouth==null?"off":"experimental_playout_level")+" level_log="+(levelLog?"on":"off")+
                " spatial=owned_by_essential_unverified");
        }
        void Enqueue(Fact fact) {
            lock(gate) {
                if(disposed)return;
                if(queue.Count>=QueueLimit) {queue.Clear();overflow=true;return;}
                queue.Enqueue(fact);
            }
        }
        void Started(NpcPlaybackStartedEvent e) {
            if(e!=null)Enqueue(new Fact {Starting=true,Speaker=e.SpeakerPed,
                Key=new VoicePresenceTurnTracker.Key(e.PedId,e.TurnId,e.GenerationId)});
        }
        void Ended(NpcPlaybackEndedEvent e) {
            if(e!=null)Enqueue(new Fact {Starting=false,Speaker=e.SpeakerPed,
                Key=new VoicePresenceTurnTracker.Key(e.PedId,e.TurnId,e.GenerationId)});
        }
        void Remember(VoicePresenceTurnTracker.Key key) {
            lastGeneration[key.PedId]=key.Generation;
            generationOrder.Enqueue(key);
            while(generationOrder.Count>GenerationHistoryLimit) {
                var old=generationOrder.Dequeue();
                if(lastGeneration.TryGetValue(old.PedId,out var current)&&current==old.Generation)
                    lastGeneration.Remove(old.PedId);
            }
        }
        static bool Live(Ped value) {
            try{return value!=null&&value.Exists()&&!value.IsDead;}catch{return false;}
        }
        void Clear(bool worldSafe=true) {
            if(worldSafe) mouth?.Close(ped);
            else mouth?.Forget();
            state.Clear();ped=null;address=IntPtr.Zero;handle=0;
            activeSinceMs=-1;lastPlaybackAuditAt=-1;playbackAuditSamples=0;
        }
        // Runs only on the Essential Core IIntegration.Update fiber. Callback
        // threads never read/write Rage.Ped state or issue native calls.
        internal void Update(int currentEpoch,long nowMs) {
            if(!attached||disposed)return;
            Fact[] batch;bool lost;
            lock(gate) {batch=queue.ToArray();queue.Clear();lost=overflow;overflow=false;}
            // A batch collected before an epoch transition carries no epoch
            // stamp. Discard it wholesale rather than re-authorize an old-world
            // START in the new world. Initial epoch binding is not a reset.
            bool epochChanged=epoch!=0&&currentEpoch!=epoch;
            if(epochChanged||lost) {
                Clear(!epochChanged);
                if(epochChanged) {lastGeneration.Clear();generationOrder.Clear();}
                epoch=currentEpoch;
                return;
            }
            if(currentEpoch<=0) {Clear(false);return;}
            epoch=currentEpoch;
            foreach(var f in batch) {
                if(f.Starting) {
                    if(!Live(f.Speaker)||!f.Key.Valid)continue;
                    // Duplicate starts are idempotent and MUST NOT rebind the
                    // original actor to a new wrapper/handle/incarnation.
                    if(state.Active&&state.Epoch==epoch&&state.ActiveKey.Equals(f.Key))continue;
                    // Reject old or conflicting equal-generation starts even
                    // after the newer turn ended or a different ped spoke.
                    if(lastGeneration.TryGetValue(f.Key.PedId,out var newest)&&
                       f.Key.Generation<=newest)continue;
                    if(state.Active) mouth?.Close(ped); // close prior owner's overlay before replacing turn
                    if(state.Begin(f.Key,epoch,nowMs)) {
                        Remember(f.Key);
                        ped=f.Speaker;address=ped.MemoryAddress;handle=(uint)ped.Handle;
                        activeSinceMs=nowMs;lastPlaybackAuditAt=-1;playbackAuditSamples=0;
                    }
                } else if(state.End(f.Key,epoch)) Clear();
            }
            bool valid=Live(ped);
            if(valid) {
                try {valid=ped.Handle==handle&&ped.MemoryAddress==address&&
                    ped!=Game.LocalPlayer.Character;}
                catch {valid=false;}
            }
            if(!state.Sweep(epoch,nowMs,valid))Clear();
            else if(mouth!=null||levelLog||ShouldAuditPlayback(nowMs)) DrivePresence(nowMs);
            // Spatialization is Essential's (NpcSpatialAudio). This observer never
            // pans, attenuates or changes volume, so it can never apply it twice.
        }
        bool ShouldAuditPlayback(long nowMs) => state.Active && activeSinceMs>=0 &&
            nowMs>=activeSinceMs && nowMs-activeSinceMs>=PlaybackAuditAfterMs &&
            playbackAuditSamples<PlaybackAuditMaxSamples &&
            (lastPlaybackAuditAt<0 || nowMs-lastPlaybackAuditAt>=PlaybackAuditCadenceMs);
        // Mouth state follows the level Essential reports for the exact active turn's
        // ped. If Essential is not speaking, or the reader is unavailable, the mouth
        // closes: there is deliberately no timing-based fallback.
        void DrivePresence(long nowMs) {
            var key=state.ActiveKey;
            bool speaking=false;
            try {speaking=NpcPlaybackCoordinator.IsPedCurrentlySpeaking(ped);} catch { }
            float level=0f;bool audible=false,buffered=false,have=false;
            bool audit=ShouldAuditPlayback(nowMs);
            if(speaking||audit) have=levels.TryRead(ped,key.PedId,key.TurnId,key.Generation,out level,out audible,out buffered);
            // A missing/untrusted reading or explicitly inaudible playout is
            // evidence to CLOSE NOW. MinOpenMs only applies to valid short
            // quiet samples (natural pauses), never missing playback proof.
            bool validPlayout=speaking&&have&&audible&&state.Sample(key,epoch,nowMs,level);
            if(!validPlayout) state.Silence();
            if(speaking&&!have&&!levels.Available&&!levelUnavailableLogged) {
                levelUnavailableLogged=true;
                Game.LogTrivial("[VP] level_source_unavailable mouth=closed no_estimate");
            }
            if(audit) {
                playbackAuditSamples++;lastPlaybackAuditAt=nowMs;
                var native=NpcPlaybackStateProbe.Read(key.PedId,key.TurnId,key.Generation);
                // This is a *pending turn*, not proof of a stall: a long
                // response can legitimately exceed eight seconds. Correlate
                // with the companion's exact-turn EOS/PCM log before diagnosis.
                Game.LogTrivial("[VP] playback_pending_audit generation="+key.Generation+
                    " age_ms="+(nowMs-activeSinceMs)+" speaking="+(speaking?1:0)+
                    " read="+(have?1:0)+" turn_buffered="+(have?(buffered?1:0):-1)+
                    " audible="+(have?(audible?1:0):-1)+
                    " rms="+(have?level.ToString("0.0000",System.Globalization.CultureInfo.InvariantCulture):"na")+
                    " end_event_observed=0 "+native.LogFields);
            }
            if(levelLog&&(lastLevelLogAt<0||nowMs<lastLevelLogAt||nowMs-lastLevelLogAt>=LevelLogMs)) {
                lastLevelLogAt=nowMs;
                Game.LogTrivial("[VP] level gen="+key.Generation+" speaking="+(speaking?1:0)+" audible="+(audible?1:0)+
                    " rms="+level.ToString("0.0000",System.Globalization.CultureInfo.InvariantCulture)+
                    " turn_buffered="+(buffered?1:0)+" open="+(state.MouthOpen?1:0)+" dist="+DistanceToPlayer());
            }
            if(!validPlayout) mouth?.Close(ped,nowMs);
            else mouth?.Update(ped,nowMs,state.MouthOpen);
        }
        const long LevelLogMs=250;
        string DistanceToPlayer() {
            try {
                var p=Game.LocalPlayer.Character;
                double dx=ped.Position.X-p.Position.X,dy=ped.Position.Y-p.Position.Y,dz=ped.Position.Z-p.Position.Z;
                return Math.Sqrt(dx*dx+dy*dy+dz*dz).ToString("0.0",System.Globalization.CultureInfo.InvariantCulture);
            } catch {return "na";}
        }
        // Called from the host-lifetime fiber, including when Core never
        // registered. Only detaches CLR events; Core retains state ownership.
        internal void Unsubscribe() {
            if(!attached)return;
            NpcPlaybackCoordinator.PlaybackStarted-=Started;
            NpcPlaybackCoordinator.PlaybackEnded-=Ended;
            attached=false;
            lock(gate) {queue.Clear();overflow=false;}
        }
        public void Dispose() {
            if(disposed)return;disposed=true;
            Unsubscribe();
            Clear(); // Only Core Shutdown calls this on a live integration.
            lastGeneration.Clear();generationOrder.Clear();
        }
    }
}
