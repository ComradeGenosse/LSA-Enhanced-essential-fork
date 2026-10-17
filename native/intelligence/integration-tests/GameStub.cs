using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace Rage {
    public class Entity {public uint Handle;public IntPtr MemoryAddress;public Vector3 Position;public bool Existing=true;public float Heading;public bool Exists()=>Existing;public bool Equals(Entity other)=>!ReferenceEquals(other,null)&&Handle==other.Handle;}
    public class Ped:Entity {public bool IsDead,Shooting;public int Health=100,Armor;public Vehicle CurrentVehicle;public uint NativeModel;}
    public class Vehicle:Entity {public Ped Driver;}
    public struct Vector3 {public float X,Y,Z;public float DistanceTo(Vector3 p)=>(float)Math.Sqrt((X-p.X)*(X-p.X)+(Y-p.Y)*(Y-p.Y)+(Z-p.Z)*(Z-p.Z));}
    public class Player {public Ped Character;}
    public static class Game {public static int GameTime;public static bool ThrowLogs;public static Player LocalPlayer=new Player();public static List<string> Logs=new List<string>();public static void LogTrivial(string text) {if(ThrowLogs)throw new Exception("test sink failure");Logs.Add(text);}}
}
namespace Rage.Native {
    // Mirrors the pinned RagePluginHook 1.124.0 SDK surface exactly where the
    // production adapter uses it: generic CallByName/CallByHash constrain the
    // return type to a value type, reference returns go through the
    // non-generic Type overloads, and arguments are NativeArgument values.
    // CallByName<string>(...) compiled against the old object[] stub but not
    // against the real SDK (CS0453), which broke the PR #41 production build.
    public sealed class NativeArgument {
        internal readonly object Value;
        NativeArgument(object value){Value=value;}
        public static implicit operator NativeArgument(string value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(int value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(uint value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(long value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(ulong value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(float value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(bool value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(byte value)=>new NativeArgument(value);
        public static implicit operator NativeArgument(IntPtr value)=>new NativeArgument(value);
        // The SDK converts any IHandleable; Entity is the stub's handleable root.
        public static implicit operator NativeArgument(Rage.Entity value)=>new NativeArgument(value);
    }
    public static class NativeFunction {
        public static int Reads,Effects,RadioStationReads,RadioTrackReads,RadioTextIdReads,RadioPlayReads,HashCalls,NameCalls;
        public static string RadioStation="";
        public static int RadioTrack,RadioTextId,RadioPlayTime;
        public static bool RadioThrow,RadioSoundThrow,RadioTextIdThrow,RadioPlayThrow;
        // Route-specific failure injection (e.g. a native absent from the RPH
        // name table throws ArgumentException only when called by name).
        public static readonly HashSet<string> NameRouteFails=new HashSet<string>(),HashRouteFails=new HashSet<string>();
        public static bool Scripted,ThrowSafetyRead;
        public static bool Playing=true,NetworkActive;
        public static int PlayerIndex=0;
        public static int? OverridePlayerPed,OverrideIndexedPed;
        public static bool FrontLos=true,AcousticLos=true;
        static IntPtr zone=Marshal.StringToHGlobalAnsi("ZONE1");
        static readonly Dictionary<ulong,string> universal=new Dictionary<ulong,string>{
            {0xF6D733C32076AD03UL,"GET_PLAYER_RADIO_STATION_NAME"},{0x34D66BC058019CE0UL,"GET_CURRENT_TRACK_SOUND_NAME"},
            {0x50B196FC9ED6545BUL,"GET_AUDIBLE_MUSIC_TRACK_TEXT_ID"},{0x3E65CDE5215832C1UL,"GET_CURRENT_TRACK_PLAY_TIME"}};
        public static T CallByName<T>(string name,params NativeArgument[] args) where T:struct {NameCalls++;return (T)Invoke(name,args,NameRouteFails);}
        public static object CallByName(string name,Type returnType,params NativeArgument[] args) {NameCalls++;return Typed(Invoke(name,args,NameRouteFails),returnType);}
        public static T CallByHash<T>(ulong hash,params NativeArgument[] args) where T:struct {HashCalls++;return (T)Invoke(Name(hash),args,HashRouteFails);}
        public static object CallByHash(ulong hash,Type returnType,params NativeArgument[] args) {HashCalls++;return Typed(Invoke(Name(hash),args,HashRouteFails),returnType);}
        static string Name(ulong hash) {if(!universal.TryGetValue(hash,out var name)){Effects++;throw new Exception("Unexpected native hash: 0x"+hash.ToString("X16"));}return name;}
        static object Typed(object value,Type returnType) {
            if(value!=null && !returnType.IsInstanceOfType(value))throw new InvalidOperationException("Unexpected native return type");
            return value;
        }
        static object Invoke(string name,NativeArgument[] arguments,HashSet<string> routeFails) {
            Reads++;object result;var args=Array.ConvertAll(arguments??new NativeArgument[0],a=>a?.Value);
            if(routeFails.Contains(name))throw new ArgumentException("native route unavailable: "+name);
            switch(name) {
                case "IS_PED_SHOOTING":result=((Rage.Ped)args[0]).Shooting;break;
                case "IS_PED_IN_ANY_VEHICLE":result=((Rage.Ped)args[0]).CurrentVehicle!=null;break;
                case "IS_PED_INJURED":result=((Rage.Ped)args[0]).Health<100;break;
                case "IS_PED_RUNNING":case "IS_PED_WALKING":case "GET_IS_VEHICLE_ENGINE_RUNNING":result=false;break;
                case "PLAYER_ID":result=PlayerIndex;break;
                case "IS_PLAYER_PLAYING":result=Playing;break;
                case "PLAYER_PED_ID":result=OverridePlayerPed??unchecked((int)(Rage.Game.LocalPlayer.Character?.Handle??0));break;
                case "GET_PLAYER_PED":result=OverrideIndexedPed??unchecked((int)(Rage.Game.LocalPlayer.Character?.Handle??0));break;
                case "GET_ENTITY_MODEL":result=((Rage.Ped)args[0]).NativeModel;break;
                case "IS_CUTSCENE_ACTIVE":case "IS_CUTSCENE_PLAYING":
                case "IS_PLAYER_SWITCH_IN_PROGRESS":case "GET_MISSION_FLAG":
                case "NETWORK_IS_SESSION_ACTIVE":
                    if(ThrowSafetyRead)throw new Exception("GTA scripted-state read failure");
                    result=Scripted || name=="NETWORK_IS_SESSION_ACTIVE" && NetworkActive;break;
                case "GET_PLAYER_RADIO_STATION_NAME":
                    RadioStationReads++;if(RadioThrow)throw new InvalidOperationException("radio unavailable");result=RadioStation;break;
                case "GET_CURRENT_TRACK_SOUND_NAME":
                    RadioTrackReads++;if(RadioThrow || RadioSoundThrow)throw new InvalidOperationException("radio sound unavailable");result=RadioTrack;break;
                case "GET_AUDIBLE_MUSIC_TRACK_TEXT_ID":
                    RadioTextIdReads++;if(RadioTextIdThrow)throw new InvalidOperationException("radio text ID unavailable");result=RadioTextId;break;
                case "GET_CURRENT_TRACK_PLAY_TIME":
                    RadioPlayReads++;if(RadioPlayThrow)throw new InvalidOperationException("radio playtime unavailable");result=RadioPlayTime;break;
                case "GET_NAME_OF_ZONE":result=zone;break;
                case "GET_INTERIOR_FROM_ENTITY":result=0;break;
                case "HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT":result=FrontLos;break;
                case "HAS_ENTITY_CLEAR_LOS_TO_ENTITY":result=AcousticLos;break;
                case "GET_VEHICLE_ENGINE_HEALTH":result=1000f;break;
                case "GET_ENTITY_SPEED":result=0f;break;
                default:Effects++;throw new Exception("Unexpected native operation: "+name);
            }
            return result;
        }
    }
}
namespace LosSantosAlive.Context {public class ActorContext {public string PedId;public List<IntegrationJsonBlock> IntegrationBlocks=new List<IntegrationJsonBlock>();} public class IntegrationJsonBlock {public string Id,Text;public IntegrationJsonBlock(string id,string text) {Id=id;Text=text;}}}
namespace LosSantosAlive.Integrations {
    public interface IIntegration {string Id{get;}bool IsAvailable{get;}void Initialize();void Update();void Shutdown();void EnrichActor(Rage.Ped p,LosSantosAlive.Context.ActorContext c);void OnPedControlChanged(Rage.Ped p,bool controlled);void OnNpcActionExecuted(Rage.Ped p,string action,bool succeeded);}
}
namespace LosSantosAlive.NPC {
    public class NpcState {public bool InDirectedInteraction,HasActiveReflex,FollowPlayerOnFoot,FollowPaused;}
    public static class NpcStateStore {public static int Creates;public static NpcState Sampled;public static NpcState TryGetState(Rage.Ped p)=>Sampled;}
    public static class NpcTargeting {public static Rage.Ped Conversation,CurrentSpeaker;public static bool ThrowConversation,ThrowSpeaker;public static Rage.Ped GetPlayerConversationPed(){if(ThrowConversation)throw new Exception("Core conversation unavailable");return Conversation;}public static Rage.Ped GetCurrentSpeakerPed(){if(ThrowSpeaker)throw new Exception("Core speaker unavailable");return CurrentSpeaker;}}
}
namespace LosSantosAlive.NPC.Perception {
    public class PerceptionSnapshot {public Rage.Ped Player;public Rage.Ped[] AllPeds;public Rage.Vehicle[] AllVehicles;public int GameTime;public bool IsValid=true;}
    public static class PerceptionSystem {public static PerceptionSnapshot Snapshot;public static int Reads,Scans;public static bool TryGetSnapshot(out PerceptionSnapshot s) {Reads++;s=Snapshot;return s!=null;}public static void Update(){Scans++;throw new Exception("No second scanner");}}
}
namespace LosSantosAlive.Audio {
    public class NpcPlaybackStartedEvent {public Rage.Ped SpeakerPed;public string PedId,TurnId;public long GenerationId;}
    public class NpcPlaybackEndedEvent {public Rage.Ped SpeakerPed;public string PedId,TurnId,Reason;public long GenerationId;public bool WasInterrupted,HadAudio,PlaybackStarted;}
    public static class NpcPlaybackCoordinator {public static bool AnyAudio,ThrowRead;public static int BusyReads;public static event Action<NpcPlaybackStartedEvent> PlaybackStarted;public static event Action<NpcPlaybackEndedEvent> PlaybackEnded;public static bool IsAnyAudioPlayingOrPending() {BusyReads++;if(ThrowRead)throw new Exception("Core playback read failed");return AnyAudio;}public static void Start(NpcPlaybackStartedEvent e)=>PlaybackStarted?.Invoke(e);public static void End(NpcPlaybackEndedEvent e)=>PlaybackEnded?.Invoke(e);}
}
namespace DamageTrackerLib.DamageInfo {
    public enum DamageType {Unknown,Pistol,MeleeBlunt,Explosive,Fire,Vehicle}
    public struct WeaponDamageInfo {public DamageType Type;}
    public struct PedDamageInfo {public uint PedHandle,AttackerPedHandle;public int Damage,ArmourDamage;public WeaponDamageInfo WeaponInfo;}
    public struct VehDamageInfo {public uint VehHandle,AttackerPedHandle;public int Damage;public WeaponDamageInfo WeaponInfo;public Rage.Vector3 LastCollisionPosition;}
}
namespace DamageTrackerLib {
    public static class DamageTrackerService {
        public delegate void PedTookDamageDelegate(Rage.Ped victim,Rage.Ped attacker,DamageInfo.PedDamageInfo info);
        public delegate void VehTookDamageDelegate(Rage.Vehicle victim,Rage.Ped attacker,DamageInfo.VehDamageInfo info);
        public static event PedTookDamageDelegate OnPedTookDamage,OnPlayerTookDamage;
        public static event VehTookDamageDelegate OnVehicleTookDamage;
        public static bool IsRunning=>false;
        public static void Ped(Rage.Ped p,DamageInfo.PedDamageInfo info)=>OnPedTookDamage?.Invoke(p,null,info);
        public static void Player(Rage.Ped p,DamageInfo.PedDamageInfo info)=>OnPlayerTookDamage?.Invoke(p,null,info);
        public static void Vehicle(Rage.Vehicle p,DamageInfo.VehDamageInfo info)=>OnVehicleTookDamage?.Invoke(p,null,info);
    }
}

namespace LSA.PromotedCharacters {
    // Read-only simulation of the pinned EssentialMicState owner-fiber query.
    // Unknown always remains a separate outcome from idle.
    internal sealed class EssentialMicState {
        internal static bool Supported=true,Idle=true;
        public bool Available=>Supported;
        public string CanStart()=>!Supported?"mic_state_unavailable":Idle?null:"mic_busy";
    }
}

namespace LosSantosAlive.Bridge.SpecialTurns {
    public static class SpecialGeminiTurnService {
        public static long Version;public static bool ThrowRead;
        public static long ReadPlayerTurnVersion() {if(ThrowRead)throw new Exception("Core special-turn version unreadable");return Version;}
    }
}

namespace LosSantosAlive.Bridge.SpecialTurns {
    public static class SpecialGeminiTurnScheduler {
        public static int Calls;
        public static bool Result=true,ThrowSubmit;
        public static bool Submit(SpecialGeminiTurnRequest request) {
            Calls++;
            if(ThrowSubmit)throw new Exception("stock scheduler fault");
            return Result;
        }
    }
}
namespace LosSantosAlive.Bridge.SpecialTurns {
    public sealed class SpecialGeminiTurnRequest {
        public Rage.Ped SpeakerPed,ListenerPed,SpeechTargetPed;
        public string Content,Reason,DedupeKey;
        public bool FaceListener,InterruptExisting,CancelIfPlayerStartsTurn,RequireCurrentPlayerConversation,SkipIfSpeakerBusy;
        public int DelayMilliseconds;
    }
}

namespace LosSantosAlive.Input {
    public static class InputController { }
    public static class TextInputService {
        public static bool Open,ThrowRead;
        public static bool IsOpen { get { if(ThrowRead)throw new Exception("Core text state unavailable");return Open; } }
    }
}
namespace LosSantosAlive.Core {
    public static class LsaControlsMenu {
        public static bool Block,ThrowRead;
        public static bool BlocksLsaInput { get { if(ThrowRead)throw new Exception("Core controls state unavailable");return Block; } }
    }
}


namespace LSA.PromotedCharacters {
    internal static class InputHookFiles {
        internal static string HarmonyPath(string path)=>System.IO.Path.Combine(path,"0Harmony.dll");
    }
}
