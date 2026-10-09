using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace Rage {
    public class Entity {public uint Handle;public IntPtr MemoryAddress;public Vector3 Position;public bool Existing=true;public float Heading;public bool Exists()=>Existing;}
    public class Ped:Entity {public bool IsDead,Shooting;public int Health=100,Armor;public Vehicle CurrentVehicle;}
    public class Vehicle:Entity {public Ped Driver;}
    public struct Vector3 {public float X,Y,Z;public float DistanceTo(Vector3 p)=>(float)Math.Sqrt((X-p.X)*(X-p.X)+(Y-p.Y)*(Y-p.Y)+(Z-p.Z)*(Z-p.Z));}
    public class Player {public Ped Character;}
    public static class Game {public static int GameTime;public static bool ThrowLogs;public static Player LocalPlayer=new Player();public static List<string> Logs=new List<string>();public static void LogTrivial(string text) {if(ThrowLogs)throw new Exception("test sink failure");Logs.Add(text);}}
}
namespace Rage.Native {
    public static class NativeFunction {
        public static int Reads,Effects;
        public static bool Scripted,ThrowSafetyRead;
        static IntPtr zone=Marshal.StringToHGlobalAnsi("ZONE1");
        public static T CallByName<T>(string name,params object[] args) where T:struct {
            Reads++;object result;
            switch(name) {
                case "IS_PED_SHOOTING":result=((Rage.Ped)args[0]).Shooting;break;
                case "IS_PED_IN_ANY_VEHICLE":result=((Rage.Ped)args[0]).CurrentVehicle!=null;break;
                case "IS_PED_INJURED":result=((Rage.Ped)args[0]).Health<100;break;
                case "IS_PED_RUNNING":case "IS_PED_WALKING":case "GET_IS_VEHICLE_ENGINE_RUNNING":result=false;break;
                case "IS_CUTSCENE_ACTIVE":case "IS_CUTSCENE_PLAYING":
                case "IS_PLAYER_SWITCH_IN_PROGRESS":case "GET_MISSION_FLAG":
                case "NETWORK_IS_SESSION_ACTIVE":
                    if(ThrowSafetyRead)throw new Exception("GTA scripted-state read failure");
                    result=Scripted;break;
                case "GET_NAME_OF_ZONE":result=zone;break;
                case "GET_INTERIOR_FROM_ENTITY":result=0;break;
                case "HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT":result=true;break;
                case "GET_VEHICLE_ENGINE_HEALTH":result=1000f;break;
                case "GET_ENTITY_SPEED":result=0f;break;
                default:Effects++;throw new Exception("Unexpected native operation: "+name);
            }
            return (T)result;
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
    public static class NpcTargeting {public static Rage.Ped Conversation;public static Rage.Ped GetPlayerConversationPed()=>Conversation;public static Rage.Ped GetCurrentSpeakerPed()=>null;}
}
namespace LosSantosAlive.NPC.Perception {
    public class PerceptionSnapshot {public Rage.Ped Player;public Rage.Ped[] AllPeds;public Rage.Vehicle[] AllVehicles;public int GameTime;public bool IsValid=true;}
    public static class PerceptionSystem {public static PerceptionSnapshot Snapshot;public static int Reads,Scans;public static bool TryGetSnapshot(out PerceptionSnapshot s) {Reads++;s=Snapshot;return s!=null;}public static void Update(){Scans++;throw new Exception("No second scanner");}}
}
namespace LosSantosAlive.Audio {
    public class NpcPlaybackStartedEvent {public Rage.Ped SpeakerPed;public string PedId;}
    public class NpcPlaybackEndedEvent {public Rage.Ped SpeakerPed;public string PedId;public bool WasInterrupted,HadAudio;}
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
