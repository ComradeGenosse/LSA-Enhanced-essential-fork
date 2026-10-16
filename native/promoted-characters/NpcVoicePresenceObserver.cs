using System;
using System.Collections.Generic;
using LosSantosAlive.Audio;
using Rage;
namespace LSA.PromotedCharacters {
    // Essential owns playout. This is a passive subscriber, NOT another player.
    internal sealed class NpcVoicePresenceObserver : IDisposable {
        const int QueueLimit=32;
        readonly object gate=new object();
        readonly Queue<Fact> queue=new Queue<Fact>();
        readonly VoicePresenceTurnTracker state=new VoicePresenceTurnTracker();
        readonly NpcVoiceMouthOverlay mouth;
        bool attached,disposed,overflow;
        Ped ped; IntPtr address; int handle,epoch;
        readonly string mode;
        internal bool HasActiveTurn=>state.Active;
        internal long ActiveGeneration=>state.ActiveKey.Generation;
        internal int ActiveHandle=>handle;
        sealed class Fact {internal bool Starting; internal Ped Speaker;internal VoicePresenceTurnTracker.Key Key;}
        internal NpcVoicePresenceObserver(string mode,bool mouthEnabled=false) {
            this.mode=mode;
            if(mode=="on" && mouthEnabled) mouth=new NpcVoiceMouthOverlay();
        }
        internal void Attach() {
            if(attached||disposed||mode=="off")return;
            NpcPlaybackCoordinator.PlaybackStarted+=Started;
            try {NpcPlaybackCoordinator.PlaybackEnded+=Ended;}
            catch {NpcPlaybackCoordinator.PlaybackStarted-=Started;throw;}
            attached=true;
            Game.LogTrivial("[VP] mode="+mode+" playback_events=ready pcm_tap=missing mouth="+
                (mouth==null?"off":"experimental_native_speaking")+" spatial=blocked");
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
        static bool Live(Ped value) {
            try{return value!=null&&value.Exists()&&!value.IsDead;}catch{return false;}
        }
        void Clear(bool worldSafe=true) {
            if(worldSafe) mouth?.Close(ped);
            else mouth?.Forget();
            state.Clear();ped=null;address=IntPtr.Zero;handle=0;
        }
        // Runs only on the Essential Core IIntegration.Update fiber. Callback
        // threads never read/write Rage.Ped state or issue native calls.
        internal void Update(int currentEpoch,long nowMs) {
            if(!attached||disposed)return;
            Fact[] batch;bool lost;
            lock(gate) {batch=queue.ToArray();queue.Clear();lost=overflow;overflow=false;}
            if(currentEpoch!=epoch||lost) {Clear(currentEpoch==epoch);epoch=currentEpoch;}
            foreach(var f in batch) {
                if(f.Starting) {
                    if(!Live(f.Speaker)||!f.Key.Valid)continue;
                    // Duplicate starts are idempotent and MUST NOT rebind the
                    // original actor to a new wrapper/handle/incarnation.
                    if(state.Active&&state.Epoch==epoch&&state.ActiveKey.Equals(f.Key))continue;
                    // Never roll the same ped's generation backwards.
                    if(state.Active&&state.Epoch==epoch&&state.ActiveKey.PedId==f.Key.PedId&&
                       f.Key.Generation<=state.ActiveKey.Generation)continue;
                    if(state.Active) mouth?.Close(ped); // close prior owner's overlay before replacing turn
                    if(state.Begin(f.Key,epoch,nowMs)) {
                        ped=f.Speaker;address=ped.MemoryAddress;handle=ped.Handle;
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
            else if(mouth!=null) {
                // Actual Essential native speaking flag, distinct from pending
                // audio and Node chunk delivery. This is approximate facial
                // motion only, NOT a playout PCM envelope or lip synchronization.
                bool speaking=false;
                try {speaking=NpcPlaybackCoordinator.IsPedCurrentlySpeaking(ped);} catch { }
                mouth.Update(ped,nowMs,speaking);
            }
            // Do not pan/attenuate: Essential exposes no safe output-mixer hook.
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
        }
    }
}
