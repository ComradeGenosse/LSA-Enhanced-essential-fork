using System;
namespace Rage {
    public struct Vector3 {public float X,Y,Z;public Vector3(float x,float y,float z){X=x;Y=y;Z=z;}}
    public sealed class Ped {
        public static int Reads;
        public bool Existing=true,IsDead;
        public int Handle;
        public IntPtr MemoryAddress;
        public Vector3 Position;
        public bool Exists() {Reads++;return Existing;}
    }
    public sealed class Player {public Ped Character;}
    public static class Game {
        public static readonly Player LocalPlayer=new Player();
        public static readonly System.Collections.Generic.List<string> Log=new System.Collections.Generic.List<string>();
        public static void LogTrivial(string s) {Log.Add(s);}
    }
}
namespace Rage.Native {
    public static class NativeFunction {
        public static bool Cutscene;
        public static readonly System.Collections.Generic.List<string> Commands=new System.Collections.Generic.List<string>();
        public static void CallByName(string name,params object[] args) {Commands.Add(name+":"+(args.Length>1?args[1]?.ToString():""));}
        public static T CallByName<T>(string name,params object[] args) {
            if(name=="HAS_ANIM_DICT_LOADED"||name=="IS_PED_MALE")return (T)(object)true;
            if(name=="IS_CUTSCENE_ACTIVE"&&Cutscene)return (T)(object)true;
            return default(T);
        }
    }
}
namespace LosSantosAlive.Audio {
    public sealed class NpcPlaybackStartedEvent {
        public Rage.Ped SpeakerPed;public string PedId,TurnId;public long GenerationId;
    }
    public sealed class NpcPlaybackEndedEvent {
        public Rage.Ped SpeakerPed;public string PedId,TurnId;public long GenerationId;
    }
    // Stand-in for Essential's public NpcSpatialAudio getters (side-effect free).
    // Throw simulates a different Essential build where the member is missing.
    public static class NpcSpatialAudio {
        public static bool Audible,Buffered,Throw;
        public static float Rms;
        public static int Reads;
        public static bool IsAudibleAudioPlaying(Rage.Ped ped){Reads++;if(Throw)throw new MissingMethodException("IsAudibleAudioPlaying");return Audible;}
        public static float GetLastChunkRms(Rage.Ped ped){if(Throw)throw new MissingMethodException("GetLastChunkRms");return Rms;}
        public static bool HasBufferedAudioForTurn(string pedId,string turnId,long generationId)=>Buffered;
    }
    public static class NpcPlaybackCoordinator {
        public static event Action<NpcPlaybackStartedEvent> PlaybackStarted;
        public static event Action<NpcPlaybackEndedEvent> PlaybackEnded;
        public static bool Talking;
        public static bool IsPedCurrentlySpeaking(Rage.Ped ped) => Talking;
        public static void RaiseStarted(Rage.Ped ped,string pedId,string turn,long generation) =>
            PlaybackStarted?.Invoke(new NpcPlaybackStartedEvent {SpeakerPed=ped,PedId=pedId,TurnId=turn,GenerationId=generation});
        public static void RaiseEnded(Rage.Ped ped,string pedId,string turn,long generation) =>
            PlaybackEnded?.Invoke(new NpcPlaybackEndedEvent {SpeakerPed=ped,PedId=pedId,TurnId=turn,GenerationId=generation});
    }
}
