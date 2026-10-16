using System;
namespace Rage {
    public sealed class Ped {
        public static int Reads;
        public bool Existing=true,IsDead;
        public int Handle;
        public IntPtr MemoryAddress;
        public bool Exists() {Reads++;return Existing;}
    }
    public sealed class Player {public Ped Character;}
    public static class Game {
        public static readonly Player LocalPlayer=new Player();
        public static void LogTrivial(string s) { }
    }
}
namespace LosSantosAlive.Audio {
    public sealed class NpcPlaybackStartedEvent {
        public Rage.Ped SpeakerPed;public string PedId,TurnId;public long GenerationId;
    }
    public sealed class NpcPlaybackEndedEvent {
        public Rage.Ped SpeakerPed;public string PedId,TurnId;public long GenerationId;
    }
    public static class NpcPlaybackCoordinator {
        public static event Action<NpcPlaybackStartedEvent> PlaybackStarted;
        public static event Action<NpcPlaybackEndedEvent> PlaybackEnded;
        public static void RaiseStarted(Rage.Ped ped,string pedId,string turn,long generation) =>
            PlaybackStarted?.Invoke(new NpcPlaybackStartedEvent {SpeakerPed=ped,PedId=pedId,TurnId=turn,GenerationId=generation});
        public static void RaiseEnded(Rage.Ped ped,string pedId,string turn,long generation) =>
            PlaybackEnded?.Invoke(new NpcPlaybackEndedEvent {SpeakerPed=ped,PedId=pedId,TurnId=turn,GenerationId=generation});
    }
}
