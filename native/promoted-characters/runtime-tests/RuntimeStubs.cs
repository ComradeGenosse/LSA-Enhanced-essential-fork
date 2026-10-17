using System;
using System.Collections.Concurrent;
using System.Threading;

// The production RuntimeEntry source is executed with a manually advanced fiber
// queue. No RAGE, Essential, P1, native ped, or production pipe is loaded.
namespace Rage
{
    public sealed class Ped
    {
        public uint Handle;
        public bool Alive = true, IsDead;
        public bool Exists()=>Alive;
        public override bool Equals(object value) => value is Ped other && other.Handle==Handle;
        public override int GetHashCode() => (int)Handle;
    }
    public static class Game
    {
        public static readonly ConcurrentQueue<string> Logs=new ConcurrentQueue<string>();
        public static void LogTrivial(string message)=>Logs.Enqueue(message);
    }
    public sealed class GameFiber
    {
        static readonly ConcurrentQueue<Action> work=new ConcurrentQueue<Action>();
        public static int Scheduled;
        public static Action OnSleep;
        public static GameFiber StartNew(Action action,string name)
        {
            Interlocked.Increment(ref Scheduled); work.Enqueue(action); return new GameFiber();
        }
        public static void Yield() { }
        public static void Sleep(int milliseconds)
        {
            if(OnSleep==null) throw new InvalidOperationException("Test must explicitly stop the fiber.");
            OnSleep();
        }
        public static void ExecuteNext()
        {
            if(!work.TryDequeue(out var action)) throw new InvalidOperationException("No scheduled fiber.");
            action();
        }
    }
}
namespace LosSantosAlive.Integrations
{
    public static class IntegrationManager
    {
        public static int Registered;
        static LSA.PromotedCharacters.PromotedCharactersIntegration current;
        static readonly BlockingCollection<Action> coreWork=new BlockingCollection<Action>();
        static Thread coreThread;
        [ThreadStatic] public static bool InCoreCallback;
        public static bool Available=>current?.IsAvailable==true;
        public static void Register(LSA.PromotedCharacters.PromotedCharactersIntegration integration)
        {
            current=integration;Interlocked.Increment(ref Registered);
        }
        public static void Register(object integration) { Interlocked.Increment(ref Registered); }
        static void RunOnCore(Action callback)
        {
            // The real owner must bind on Core's callback thread, independently
            // of the lifetime fiber. Initialization and cleanup share that same
            // dedicated Core thread, just as the authoritative callback does.
            if(coreThread==null) {
                coreThread=new Thread(()=>{InCoreCallback=true;foreach(var work in coreWork.GetConsumingEnumerable()) work();}) {IsBackground=true};
                coreThread.Start();
            }
            Exception failure=null;
            using(var completed=new ManualResetEventSlim(false)) {
                coreWork.Add(()=>{try {callback();} catch(Exception error) {failure=error;} finally {completed.Set();}});
                if(!completed.Wait(10000)) throw new Exception("Core callback did not finish.");
            }
            if(failure!=null) throw new Exception("Core callback failed.",failure);
        }
        public static void InitializeFromCore()=>RunOnCore(()=>current.Initialize());
        public static void UpdateFromCore()=>RunOnCore(()=>{if(current.IsAvailable) current.Update();});
    }
}
namespace LSA.SessionIdentity { public sealed class SessionIdentityIntegration { } }
namespace LSA.PromotedCharacters
{
    internal sealed class PrimaryBehaviorOwner
    {
        public string owner, mode;
        public PrimaryBehaviorOwner(string who,string state) {owner=who;mode=state;}
    }
    public sealed class PromotedCharactersIntegration
    {
        public static int Constructed,Prepared,Initialized,InitializedOutsideCore,ShutdownRequests,Shutdowns,ShutdownOutsideCore,PreparationThread,InitializationThread,ShutdownThread;
        bool prepared,shutdown;
        volatile bool ready,shutdownRequested;
        public event Action<string> OwnerRetired;
        public bool IsAvailable=>prepared && !shutdown;
        public bool IsReady=>ready && !shutdownRequested && !shutdown;
        internal string UnavailabilityReason=>shutdown?"shutdown":"none";
        internal string IdentityRuntimeStatus=>"identity_status=test";
        public PromotedCharactersIntegration(string world,string pipe,string identityPipe,HostContext host=null)=>Interlocked.Increment(ref Constructed);
        public static LSA.Intelligence.OwnedParticipant[] RosterOverride=new LSA.Intelligence.OwnedParticipant[0];
        public LSA.Intelligence.OwnedParticipant[] PerceptionRoster()=>RosterOverride;
        public object SampleMemoryNativeAuthority()=>null;
        public object SampleMemoryCurrentOwnerPlayer()=>null;
        public void Prepare()
        {
            Interlocked.Increment(ref Prepared);PreparationThread=Thread.CurrentThread.ManagedThreadId;prepared=true;
        }
        public void Initialize()
        {
            if(!LosSantosAlive.Integrations.IntegrationManager.InCoreCallback) {
                Interlocked.Increment(ref InitializedOutsideCore);throw new Exception("Runtime lifetime fiber must not initialize native ownership.");
            }
            Interlocked.Increment(ref Initialized);InitializationThread=Thread.CurrentThread.ManagedThreadId;ready=true;
        }
        public void RequestShutdown() {Interlocked.Increment(ref ShutdownRequests);shutdownRequested=true;}
        // UX phase 1 bridge surface reached through RuntimeEntry.
        public static int Submissions,SnapshotRequests;
        internal string SubmitLocal(string envelope) {Interlocked.Increment(ref Submissions);return IsReady?"accepted":"native_unavailable";}
        internal string TakeLocalResult(string id)=>id=="00000000-0000-4000-8000-000000000000"?"{\"v\":1}":null;
        internal string LocalSnapshot()=>"{\"v\":1,\"seq\":1}";
        internal void RequestLocalSnapshots(int forMs) {Interlocked.Increment(ref SnapshotRequests);}
        public void Update() {if(shutdownRequested) Shutdown();}
        public static int ActivityShadowStarts,ActivityExecutionStarts;public static bool DialogueReceiptsEnabled;
        internal void EnableActivityShadow(string pipeName,bool dialogueReceipts=false) {ActivityShadowStarts++;DialogueReceiptsEnabled=dialogueReceipts;}
        internal void EnableActivityExecution(string pipeName,bool dialogueReceipts=false) {ActivityExecutionStarts++;DialogueReceiptsEnabled=dialogueReceipts;}
        public void Shutdown()
        {
            if(!LosSantosAlive.Integrations.IntegrationManager.InCoreCallback) {
                Interlocked.Increment(ref ShutdownOutsideCore);throw new Exception("Runtime lifetime fiber must not retire native ownership.");
            }
            Interlocked.Increment(ref Shutdowns);ShutdownThread=Thread.CurrentThread.ManagedThreadId;shutdown=true;ready=false;
        }
    }
}
namespace LSA.Intelligence
{
    public static class DirectorAdmission {public const int NormalMaxAttempts=4,TestingMaxAttempts=12;}
    public sealed class OwnedParticipant { public Rage.Ped Ped; public Func<object> PrimaryOwner; public Func<bool> Current; }
    public sealed class IntelligenceIntegration
    {
        public IntelligenceIntegration(Func<OwnedParticipant[]> roster,string pipeName,LSA.PromotedCharacters.HostContext host=null,bool directorShadow=false,bool directorExperimental=false,string radioMode="off",int directorAttemptsPerMinute=4,Func<object> memoryAuthoritySample=null,Func<object> memoryCurrentOwnerPlayerSample=null,NativeProducerPolicy producerPolicy=null) { }
        public void OwnerRetired(string incarnationId) { }
        public void Shutdown() { }
        public void Shutdown(string reason) { }
        public void Initialize() { }
        internal string RuntimeStatus()=>"test";
        internal static void LogStatus(string message)=>Rage.Game.LogTrivial(message);
    }
}

// Compile-only facsimiles for the optional reaction host integration. The
// actual reaction state machine has its own 30-test offline harness.
namespace LSA.Reactions
{
    public sealed class ReactionOptions
    {
        public string Mode;
        public bool AllowDuringOwnedBehavior;
        public readonly System.Collections.Generic.HashSet<string> Disabled =
            new System.Collections.Generic.HashSet<string>();
    }
    public static class ReactionCatalog
    {
        public static bool IsKnown(string name) => name=="facepalm" || name=="middle_finger";
    }
    public sealed class ReactionIntegration
    {
        public static int Requests, UnsafeShutdowns;
        public ReactionIntegration(ReactionOptions options,string pipeName,string hostRunId,
            Func<int> epoch,Func<long> now,Func<Rage.Ped,bool> owns) { }
        public void Initialize() { }
        public void WorldChanged(string reason) { }
        public void RequestShutdown() { System.Threading.Interlocked.Increment(ref Requests); }
        public void Shutdown() { System.Threading.Interlocked.Increment(ref UnsafeShutdowns); }
    }
}
