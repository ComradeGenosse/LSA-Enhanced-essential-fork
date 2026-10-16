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
        bool attached,disposed,overflow;
        Ped ped; IntPtr address; int handle,epoch;
        readonly string mode;
        sealed class Fact {internal bool Starting; internal Ped Speaker;internal VoicePresenceTurnTracker.Key Key;}
        internal NpcVoicePresenceObserver(string mode) {this.mode=mode;}
        internal void Attach() {
            if(attached||disposed||mode=="off")return;
            NpcPlaybackCoordinator.PlaybackStarted+=Started;
            try {NpcPlaybackCoordinator.PlaybackEnded+=Ended;}
            catch {NpcPlaybackCoordinator.PlaybackStarted-=Started;throw;}
            attached=true;
            Game.LogTrivial("[VP] mode="+mode+" playback_events=ready playout_tap=missing facial=blocked spatial=deferred");
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
        void Clear() {state.Clear();ped=null;address=IntPtr.Zero;handle=0;}
        // Runs only on the Essential Core IIntegration.Update fiber. Callback
        // threads never read/write Rage.Ped state or issue native calls.
        internal void Update(int currentEpoch,long nowMs) {
            if(!attached||disposed)return;
            Fact[] batch;bool lost;
            lock(gate) {batch=queue.ToArray();queue.Clear();lost=overflow;overflow=false;}
            if(currentEpoch!=epoch||lost) {Clear();epoch=currentEpoch;}
            foreach(var f in batch) {
                if(f.Starting) {
                    if(!Live(f.Speaker)||!f.Key.Valid)continue;
                    // Duplicate starts are idempotent and MUST NOT rebind the
                    // original actor to a new wrapper/handle/incarnation.
                    if(state.Active&&state.Epoch==epoch&&state.ActiveKey.Equals(f.Key))continue;
                    // Never roll the same ped's generation backwards.
                    if(state.Active&&state.Epoch==epoch&&state.ActiveKey.PedId==f.Key.PedId&&
                       f.Key.Generation<=state.ActiveKey.Generation)continue;
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
            // No per-turn rendered PCM level is surfaced by the pinned DLL.
            // Do not animate from queue time or assume the legacy facial native
            // works in Enhanced. No spatial mixer writes / double attenuation.
        }
        public void Dispose() {
            if(disposed)return;disposed=true;
            if(attached) {
                NpcPlaybackCoordinator.PlaybackStarted-=Started;
                NpcPlaybackCoordinator.PlaybackEnded-=Ended;attached=false;
            }
            lock(gate) {queue.Clear();overflow=false;}Clear();
        }
    }
}
