using System;
using System.Collections.Generic;
using System.Drawing;

// Link the production P2 integration and pipe without executing any game
// assembly. Native/ped access is counted so a reset cannot hide unsafe cleanup.
// Essential's UX seams (input gates, typed-turn entry) count as native access too.
namespace Rage
{
    public static class Game
    {
        static long gameTime;
        static bool loading;
        public static long GameTime {get { ClockReads++; return gameTime; } set { gameTime = value; }}
        public static bool IsLoading {get { NativeCalls++; return loading; } set { loading = value; }}
        public static readonly Player LocalPlayer = new Player();
        public static readonly List<string> Logs = new List<string>();
        public static Size Resolution = new Size(1920,1080);
        public static event EventHandler<GraphicsEventArgs> FrameRender;
        public static void RaiseFrame() => FrameRender?.Invoke(null,new GraphicsEventArgs());
        public static int NativeCalls,PedReads,ClockReads;
        public static void LogTrivial(string message) { lock (Logs) Logs.Add(message); }
    }
    // Used only by RuntimeEntry in the bridge harness: the lifetime "fiber" is a
    // background thread, while the harness plays Core's Update callback thread.
    public sealed class GameFiber
    {
        public static GameFiber StartNew(Action work,string name) { new System.Threading.Thread(() => work()) {IsBackground = true,Name = name}.Start(); return new GameFiber(); }
        public static void Yield() { }
        public static void Sleep(int milliseconds) => System.Threading.Thread.Sleep(milliseconds);
    }
    public sealed class Player { public Ped Character; }
    public sealed class Ped
    {
        public Ped() { }
        public Ped(Model model,Vector3 position,float heading) { Game.NativeCalls++; }
        public bool Existing = true;
        public bool Exists() { Game.PedReads++; return Existing; }
        public bool IsDead,IsPersistent;
        public Vector3 Position, Bone;
        public float ScreenX, ScreenY;
        public IntPtr MemoryAddress = new IntPtr(123);
        public Vector3 GetBonePosition(PedBoneId bone) => Bone.X == 0f && Bone.Y == 0f && Bone.Z == 0f ? Position : Bone;
        public int Handle = 12;
        public Model Model;
        public float Heading;
        public Vector3 GetOffsetPosition(Vector3 offset) { Game.NativeCalls++; return offset; }
        public void Dismiss() { Game.NativeCalls++; }
        public void Delete() { Game.NativeCalls++; }
    }
    public struct Model
    {
        public Model(uint hash) { Hash = hash; }
        public uint Hash;
        public bool IsValid => true;
        public bool IsPed => true;
    }
    public struct Vector3
    {
        public Vector3(float x,float y,float z) { X=x; Y=y; Z=z; }
        public float X,Y,Z;
    }
    public struct Vector2 { public float X, Y; }
    public enum PedBoneId { Head }
    public sealed class GraphicsEventArgs : EventArgs { public Graphics Graphics {get;} = new Graphics(); }
    public sealed class Graphics
    {
        public void DrawRectangle(RectangleF rect,Color color) { }
        public void DrawText(string text,string font,float scale,PointF position,Color color) { }
    }
    public static class World
    {
        public static Func<Vector3,Vector2> Projector;
        public static float? GetGroundZ(Vector3 position,bool p1,bool p2) { Game.NativeCalls++; return position.Z; }
        public static Vector2 ConvertWorldPositionToScreenPosition(Vector3 position) => Projector != null ? Projector(position) : new Vector2 {X = 960f,Y = 540f};
    }
}
namespace Rage.Native
{
    public static class NativeFunction
    {
        // Null in lifecycle tests, where any native call is a failure.
        public static Func<string,object[],object> Handler;
        public static T CallByName<T>(string name,params object[] args)
        {
            Rage.Game.NativeCalls++;
            if (Handler == null) throw new InvalidOperationException("Native calls are forbidden in the reset test.");
            return (T)Handler(name,args);
        }
    }
}
namespace LosSantosAlive.Context
{
    public sealed class ActorContext
    {
        public string PedId,Gender,AgeRange,Archetype,RoleName;
        public readonly List<IntegrationJsonBlock> IntegrationBlocks = new List<IntegrationJsonBlock>();
    }
    public sealed class IntegrationJsonBlock { public IntegrationJsonBlock(string id,string text) { } }
}
namespace LosSantosAlive.Context.Providers
{
    public static class ActorContextProvider { public static void Populate(LosSantosAlive.Context.ActorContext actor,Rage.Ped ped) { Rage.Game.NativeCalls++; } }
}
public enum ActionStateModifierPhase { BeforeCoreStateRule = 0, AfterCoreStateRule = 1 }
public interface IActionStateModifier
{
    void ApplyActionState(Rage.Ped ped, LosSantosAlive.NPC.NpcState state, string commandName, ActionStateModifierPhase phase);
}
namespace LosSantosAlive.Integrations
{
    public static class IntegrationManager
    {
        public static readonly List<object> Registered = new List<object>();
        public static int RegistrationThread;
        public static void Register(object integration) { lock (Registered) Registered.Add(integration); RegistrationThread = System.Threading.Thread.CurrentThread.ManagedThreadId; }
    }
    public interface IIntegration
    {
        string Id {get;}
        bool IsAvailable {get;}
        void Initialize();
        void Update();
        void Shutdown();
        void EnrichActor(Rage.Ped ped,LosSantosAlive.Context.ActorContext context);
        void OnPedControlChanged(Rage.Ped ped,bool controlledByLsa);
        void OnNpcActionExecuted(Rage.Ped ped,string actionName,bool succeeded);
    }
}
namespace LosSantosAlive.NPC
{
    public static class NpcTargeting
    {
        public static Rage.Ped ConversationPed,SpeakerPed;
        public static Func<Rage.Ped,bool> Human = ped => true;
        public static Rage.Ped GetPlayerConversationPed() { Rage.Game.NativeCalls++; return ConversationPed; }
        public static Rage.Ped GetCurrentSpeakerPed() { Rage.Game.NativeCalls++; return SpeakerPed; }
        public static bool IsValidHumanPed(Rage.Ped ped) { Rage.Game.NativeCalls++; return Human(ped); }
        public static int Sets, Clears;
        public static void SetPlayerConversationPed(Rage.Ped ped) { Rage.Game.NativeCalls++; Sets++; ConversationPed = ped; }
        public static void ClearPlayerConversationPed() { Rage.Game.NativeCalls++; Clears++; ConversationPed = null; }
    }
    public static class NpcFocus { public static void SetFocus(Rage.Ped ped,Rage.Ped player,string reason) { Rage.Game.NativeCalls++; } }
    public sealed class NpcState
    {
        public bool SitOnGroundMode,FollowPlayerOnFoot,FollowPaused,EnterPassengerSeatWhenPlayerEnters,ExitVehicleWhenPlayerExits,StayUnderLsaControl,InDirectedInteraction,AccompliceMode,HasActiveReflex;
        public int LastReflexTime;
        public void DemoteToPassiveRuntime() { Rage.Game.NativeCalls++; }
    }
    public static class NpcStateStore
    {
        public static Func<Rage.Ped,NpcState> State;
        public static NpcState TryGetState(Rage.Ped ped) { Rage.Game.NativeCalls++; return State==null ? new NpcState() : State(ped); }
        public static NpcState GetStateForActiveBehavior(Rage.Ped ped) { Rage.Game.NativeCalls++; return new NpcState(); }
    }
    public static class NpcActions
    {
        public static bool HasExclusiveControl(Rage.Ped ped) { Rage.Game.NativeCalls++; return true; }
        public static void FollowTarget(Rage.Ped ped) { Rage.Game.NativeCalls++; }
        public static void WaitHere(Rage.Ped ped) { Rage.Game.NativeCalls++; }
        public static void ReleaseExclusiveControlForExternalSystem(Rage.Ped ped,string reason,bool keepState) { Rage.Game.NativeCalls++; }
    }
}
namespace LosSantosAlive.Input
{
    public static class InputController
    {
        public static readonly List<KeyValuePair<Rage.Ped,string>> Prompts = new List<KeyValuePair<Rage.Ped,string>>();
        public static Action<Rage.Ped,string> OnPrompt;
        public static void SendTextPrompt(Rage.Ped ped,string text) { Rage.Game.NativeCalls++; OnPrompt?.Invoke(ped,text); Prompts.Add(new KeyValuePair<Rage.Ped,string>(ped,text)); }
        public static int MicStarts, MicStops;
        static Rage.Ped activeMic;
        public static Rage.Ped LastMic => activeMic;
        public static bool ThrowOnMicStop;
        public static void SendMicStart(Rage.Ped ped) { Rage.Game.NativeCalls++; MicStarts++; activeMic = ped; }
        public static void SendMicStop()
        {
            Rage.Game.NativeCalls++;
            var previous = activeMic; // keep a ldsfld/stsfld pair like pinned Essential
            if (ThrowOnMicStop) throw new InvalidOperationException("Injected mic stop failure.");
            MicStops++;
            activeMic = null;
            if (previous == null) { }
        }
        public static void ReplaceMic(Rage.Ped ped) { activeMic = ped; }
    }
    public static class TextInputService
    {
        static bool open;
        public static bool IsOpen {get { Rage.Game.NativeCalls++; return open; } set { open = value; }}
    }
}
namespace LosSantosAlive.NPC.Perception
{
    public sealed class PerceptionSnapshot
    {
        public Rage.Ped[] AllPeds;
        public int GameTime;
        public bool IsValid = true;
    }
    public static class PerceptionSystem
    {
        public static PerceptionSnapshot Snapshot;
        public static bool TryGetSnapshot(out PerceptionSnapshot snapshot)
        {
            Rage.Game.NativeCalls++;
            snapshot = Snapshot;
            return snapshot != null;
        }
    }
}
namespace LosSantosAlive.Core
{
    public static class LsaControlsMenu
    {
        static bool blocks;
        public static bool BlocksLsaInput {get { Rage.Game.NativeCalls++; return blocks; } set { blocks = value; }}
    }
}
namespace LSA.Intelligence
{
    public sealed class OwnedParticipant { public Rage.Ped Ped; public string Lifetime,EncounterId; public Func<bool> Current; public Func<object> PrimaryOwner; }
    // Static logging for P2; the instance surface is what RuntimeEntry hosts.
    public sealed class IntelligenceIntegration
    {
        public IntelligenceIntegration(Func<OwnedParticipant[]> roster,string pipeName,LSA.PromotedCharacters.HostContext host=null) { }
        public void OwnerRetired(string incarnationId) { }
        public void Initialize() { }
        internal void Shutdown(string reason) { }
        internal string RuntimeStatus() => "test";
        internal static void LogStatus(string message)=>Rage.Game.LogTrivial(message);
    }
}
namespace LSA.SessionIdentity
{
    public sealed class RegistrationToken { internal string Epoch,Handle;internal Rage.Ped Ped; public string IncarnationId; }
    public sealed class NativeIdentityClaim { public string incarnationId; }
    public sealed class ExplicitCharacterSource
    {
        readonly string epoch = Guid.NewGuid().ToString("D");
        readonly int ownerThread = System.Threading.Thread.CurrentThread.ManagedThreadId;
        readonly HashSet<RegistrationToken> tokens = new HashSet<RegistrationToken>();
        public bool ThrowOnRetire;
        public int Count => tokens.Count;
        public int LastRetirementThread {get;private set;}
        void AssertOwner() { if (ownerThread != System.Threading.Thread.CurrentThread.ManagedThreadId) throw new InvalidOperationException("Wrong owner thread in lifecycle test."); }
        public RegistrationToken Register(Rage.Ped ped,string sourceKey,string world)
        {
            AssertOwner();
            var token = new RegistrationToken {Epoch = epoch,IncarnationId=Guid.NewGuid().ToString("D"),Ped=ped,Handle=ped.Handle.ToString()}; tokens.Add(token); return token;
        }
        public bool Retire(RegistrationToken token)
        {
            AssertOwner(); LastRetirementThread = System.Threading.Thread.CurrentThread.ManagedThreadId;
            if (ThrowOnRetire) throw new InvalidOperationException("Injected owner retirement failure.");
            return token.Epoch == epoch && tokens.Remove(token);
        }
        public bool TryResolveCurrent(Rage.Ped ped,out NativeIdentityClaim claim) { AssertOwner();claim=null;if(ped==null || !ped.Exists() || ped.IsDead)return false;foreach(var token in tokens)if(ReferenceEquals(token.Ped,ped) && token.Handle==ped.Handle.ToString()){claim=new NativeIdentityClaim{incarnationId=token.IncarnationId};return true;}return false; }
    }
    public sealed class SessionIdentityIntegration
    {
        public static SessionIdentityIntegration Current;
        public bool IsAvailable => Owner != null;
        public void ConfigureHostContext(string run,Func<int> epoch) { }
        public void ResetForHostWorld(int epoch,string reason) { }
        public string DiagnosticsStatus()=>"identity_status=test";
        public int InitializationThread {get;private set;}
        public int InitializationCalls {get;private set;}
        public ExplicitCharacterSource Owner {get;private set;}
        public static SessionIdentityIntegration InstallDeferred(string pipeName)
        {
            if (Current != null) return Current;
            Current = new SessionIdentityIntegration(); LosSantosAlive.Integrations.IntegrationManager.Register(Current); return Current;
        }
        public static SessionIdentityIntegration Install(string pipeName) { var integration = InstallDeferred(pipeName); integration.Initialize(); return integration; }
        public void Initialize()
        {
            if (Owner != null) return;
            InitializationThread = System.Threading.Thread.CurrentThread.ManagedThreadId; InitializationCalls++;
            Owner = new ExplicitCharacterSource();
        }
        public void ResetForTest() => Owner = new ExplicitCharacterSource();
    }
}
