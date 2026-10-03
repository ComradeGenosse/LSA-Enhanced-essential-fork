using System;
using System.Collections.Generic;

// Link the production P2 integration and pipe without executing any game
// assembly. Native/ped access is counted so a reset cannot hide unsafe cleanup.
namespace Rage
{
    public static class Game
    {
        static long gameTime;
        public static long GameTime {get { ClockReads++; return gameTime; } set { gameTime = value; }}
        public static readonly Player LocalPlayer = new Player();
        public static readonly List<string> Logs = new List<string>();
        public static int NativeCalls,PedReads,ClockReads;
        public static void LogTrivial(string message) => Logs.Add(message);
    }
    public sealed class Player { public Ped Character; }
    public sealed class Ped
    {
        public Ped() { }
        public Ped(Model model,Vector3 position,float heading) { Game.NativeCalls++; }
        public bool Exists() { Game.PedReads++; return true; }
        public bool IsDead,IsPersistent;
        public IntPtr MemoryAddress = new IntPtr(123);
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
    public static class World { public static float? GetGroundZ(Vector3 position,bool p1,bool p2) { Game.NativeCalls++; return position.Z; } }
}
namespace Rage.Native
{
    public static class NativeFunction
    {
        public static T CallByName<T>(string name,params object[] args) { Rage.Game.NativeCalls++; throw new InvalidOperationException("Native calls are forbidden in the reset test."); }
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
namespace LosSantosAlive.Integrations
{
    public static class IntegrationManager
    {
        public static readonly List<object> Registered = new List<object>();
        public static int RegistrationThread;
        public static void Register(object integration) { Registered.Add(integration); RegistrationThread = System.Threading.Thread.CurrentThread.ManagedThreadId; }
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
        public static Rage.Ped GetPlayerConversationPed() { Rage.Game.NativeCalls++; return null; }
        public static Rage.Ped GetCurrentSpeakerPed() { Rage.Game.NativeCalls++; return null; }
    }
    public static class NpcFocus { public static void SetFocus(Rage.Ped ped,Rage.Ped player,string reason) { Rage.Game.NativeCalls++; } }
    public sealed class NpcState
    {
        public bool FollowPlayerOnFoot,FollowPaused,EnterPassengerSeatWhenPlayerEnters,ExitVehicleWhenPlayerExits,StayUnderLsaControl,InDirectedInteraction,AccompliceMode;
        public void DemoteToPassiveRuntime() { Rage.Game.NativeCalls++; }
    }
    public static class NpcStateStore
    {
        public static NpcState TryGetState(Rage.Ped ped) { Rage.Game.NativeCalls++; return new NpcState(); }
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
namespace LSA.Intelligence
{
    public sealed class OwnedParticipant { public Rage.Ped Ped; public string Lifetime; public Func<bool> Current; }
    public static class IntelligenceIntegration { internal static void LogStatus(string message)=>Rage.Game.LogTrivial(message); }
}
namespace LSA.SessionIdentity
{
    public sealed class RegistrationToken { internal string Epoch; public string IncarnationId; }
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
            var token = new RegistrationToken {Epoch = epoch,IncarnationId=Guid.NewGuid().ToString("D")}; tokens.Add(token); return token;
        }
        public bool Retire(RegistrationToken token)
        {
            AssertOwner(); LastRetirementThread = System.Threading.Thread.CurrentThread.ManagedThreadId;
            if (ThrowOnRetire) throw new InvalidOperationException("Injected owner retirement failure.");
            return token.Epoch == epoch && tokens.Remove(token);
        }
        public bool TryResolveCurrent(Rage.Ped ped,out NativeIdentityClaim claim) { AssertOwner(); claim = null; return false; }
    }
    public sealed class SessionIdentityIntegration
    {
        public static SessionIdentityIntegration Current;
        public bool IsAvailable => Owner != null;
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
