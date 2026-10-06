using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LSA.PromotedCharacters;
using LSA.SessionIdentity;
using LosSantosAlive.Context;
using LosSantosAlive.Integrations;
using Rage;

class Program
{
    static int count;
    static readonly string WorldId = Guid.NewGuid().ToString("D");
    static void Check(bool value) { count++; if (!value) throw new Exception("P2 lifecycle assertion " + count); }
    static T Field<T>(object source,string name) => (T)source.GetType().GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(source);
    static Dictionary<string,Encounter> Encounters(PromotedCharactersIntegration integration) => Field<Dictionary<string,Encounter>>(integration,"encounters");
    static Dictionary<string,Capture> Captures(PromotedCharactersIntegration integration) => Field<Dictionary<string,Capture>>(integration,"captures");
    static string HelloEpoch(string pipeName)
    {
        using (var pipe = new NamedPipeClientStream(".",pipeName,PipeDirection.InOut)) {
            pipe.Connect(3000);
            var frame = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new StreamReader(pipe).ReadLine());
            return (string)frame["ownerEpoch"];
        }
    }
    static PromotedCharactersIntegration Create(out string pipeName)
    {
        Game.GameTime = 2000; Game.NativeCalls = 0; Game.PedReads = 0; Game.ClockReads = 0; Game.Logs.Clear();
        SessionIdentityIntegration.Current = null;
        IntegrationManager.Registered.Clear();
        pipeName = "LSA.P2.lifecycle." + Guid.NewGuid().ToString("N");
        var integration = new PromotedCharactersIntegration(WorldId,pipeName);
        integration.Prepare();
        Check(integration.IsAvailable && !integration.IsReady);
        Check(!SessionIdentityIntegration.Current.IsAvailable && Game.ClockReads == 0 && Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Initialize(); Check(integration.IsAvailable && integration.IsReady);
        return integration;
    }
    static Encounter Seed(PromotedCharactersIntegration integration)
    {
        var ped = new Ped();
        var encounter = new Encounter {Ped = ped,Address = ped.MemoryAddress,Created = true,OwnerAlias = "promoted." + Guid.NewGuid().ToString("D"),OwnershipToken = Guid.NewGuid().ToString("D")};
        encounter.Registration = SessionIdentityIntegration.Current.Owner.Register(ped,encounter.OwnerAlias,WorldId);
        Encounters(integration).Add("old-ped",encounter);
        Captures(integration).Add("old-capture",new Capture {Encounter = encounter,ExpiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+10000});
        return encounter;
    }
    static Task<bool> QueuePending(string pipeName)
    {
        return Task.Run(()=>{
            try {
                using (var pipe = new NamedPipeClientStream(".",pipeName,PipeDirection.InOut)) {
                    pipe.Connect(3000); var reader = new StreamReader(pipe); var writer = new StreamWriter(pipe) {AutoFlush = true};
                    var json = new JavaScriptSerializer();
                    var hello = json.Deserialize<Dictionary<string,object>>(reader.ReadLine());
                    writer.WriteLine(json.Serialize(new {version = 1,requestId = Guid.NewGuid().ToString("D"),worldProfileId = WorldId,ownerEpoch = (string)hello["ownerEpoch"],operation = "capture",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+2500}));
                    return reader.ReadLine() == null;
                }
            } catch (IOException) {return true;}
        });
    }
    static ControlRequest AwaitQueued(ControlChannel channel)
    {
        var requests = Field<ConcurrentQueue<ControlRequest>>(channel,"requests");
        var deadline = DateTime.UtcNow.AddSeconds(3);
        while (DateTime.UtcNow < deadline) { if (requests.TryPeek(out var request)) return request; Thread.Sleep(10); }
        throw new Exception("Timed out waiting for the real control pipe request.");
    }
    static void Main()
    {
        try {
            DeferredInitialization(); ShutdownOnCoreUpdate(); ResetWithPendingRequest(); ResetAfterP1(); RetireFailure(); ForwardClock(); ActivityIsolation();
            Console.WriteLine("P2 production clock recovery and Windows pipe cancellation: " + count + " assertions passed; no game assemblies loaded.");
        } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); Environment.ExitCode = 1; }
    }
    static void ActivityIsolation()
    {
        var integration = Create(out _);
        integration.EnableActivityShadow("LSA.ACT.lifecycle." + Guid.NewGuid().ToString("N"));
        integration.InjectActivityFault(true);
        integration.Update();
        Check(integration.IsAvailable && integration.ActivityDisabled);
        integration.Shutdown();
        integration = Create(out _);
        integration.EnableActivityShadow("LSA.ACT.lifecycle." + Guid.NewGuid().ToString("N"));
        for (var n = 0; n < 3; n++) { integration.InjectActivityFault(false); integration.Update(); }
        Check(integration.IsAvailable && !integration.ActivityDisabled && integration.ActivityFaults == 3 && integration.ActivityBreakerTrips == 1);
        Check(Game.Logs.Count(line => line == "[ACT] breaker_tripped") == 1);
        integration.Shutdown();
    }
    static void DeferredInitialization()
    {
        Game.GameTime = 2000; Game.NativeCalls = 0; Game.PedReads = 0; Game.ClockReads = 0;
        SessionIdentityIntegration.Current = null; IntegrationManager.Registered.Clear();
        var integration = new PromotedCharactersIntegration(WorldId,"LSA.P2.lifecycle." + Guid.NewGuid().ToString("N"));
        // Preparation can come from the addon fiber, while the subsequent
        // Initialize/Update callback comes from Core's distinct owner thread.
        Task.Run(()=>integration.Prepare()).GetAwaiter().GetResult();
        Check(integration.IsAvailable && !integration.IsReady);
        Check(SessionIdentityIntegration.Current.Owner == null && SessionIdentityIntegration.Current.InitializationCalls == 0);
        Check(Game.ClockReads == 0 && Game.NativeCalls == 0 && Game.PedReads == 0);
        int registrationCount = IntegrationManager.Registered.Count;
        integration.Prepare(); Check(IntegrationManager.Registered.Count == registrationCount && registrationCount == 1);
        integration.EnrichActor(new Ped(),new ActorContext {PedId = "12"});
        Check(Encounters(integration).Count == 0 && Game.PedReads == 0);
        integration.Update();
        Check(integration.IsAvailable && integration.IsReady);
        Check(SessionIdentityIntegration.Current.InitializationThread == Thread.CurrentThread.ManagedThreadId);
        Check(SessionIdentityIntegration.Current.InitializationThread != IntegrationManager.RegistrationThread);
        Check(IntegrationManager.Registered.Count == registrationCount);
        Check(SessionIdentityIntegration.Current.InitializationCalls == 1);
        integration.Update(); Check(SessionIdentityIntegration.Current.InitializationCalls == 1 && integration.IsReady);
        integration.Shutdown();
    }
    static void ResetWithPendingRequest()
    {
        var integration = Create(out var pipeName); var old = Field<ControlChannel>(integration,"channel");
        string epoch = HelloEpoch(pipeName); var encounter = Seed(integration);
        var client = QueuePending(pipeName); var request = AwaitQueued(old);
        Game.GameTime = 1000; integration.Update();
        Check(integration.IsAvailable); Check(!ReferenceEquals(old,Field<ControlChannel>(integration,"channel")));
        Check(HelloEpoch(pipeName) != epoch);
        Check(request.Cancelled && request.Done.IsSet); Check(client.GetAwaiter().GetResult());
        Check(!old.TryTake(out _));
        Check(Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(SessionIdentityIntegration.Current.Owner.Count == 0);
        Check(encounter.Registration == null && encounter.OwnerAlias == null && encounter.OwnershipToken == null);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        Check(Game.Logs.Count(message=>message == "[P2] game_clock_reset") == 1);
        // P1 can rotate after P2 in the same tick without ending P2's lifetime.
        SessionIdentityIntegration.Current.ResetForTest(); Game.GameTime = 1100; integration.Update();
        Check(integration.IsAvailable); Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Shutdown();
    }
    static void ShutdownOnCoreUpdate()
    {
        var integration = Create(out var pipeName); var encounter = Seed(integration);
        var owner = SessionIdentityIntegration.Current.Owner;
        encounter.Ped.IsDead = true;
        Task.Run(()=>integration.RequestShutdown()).GetAwaiter().GetResult();
        Check(integration.IsAvailable && !integration.IsReady);
        Check(owner.Count == 1 && owner.LastRetirementThread == 0);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.EnrichActor(encounter.Ped,new ActorContext {PedId = "12"});
        integration.OnPedControlChanged(encounter.Ped,false);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0 && owner.Count == 1);
        integration.Update();
        Check(!integration.IsAvailable && !integration.IsReady);
        Check(owner.Count == 0 && owner.LastRetirementThread == Thread.CurrentThread.ManagedThreadId);
        Check(Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(Game.PedReads > 0 && Game.NativeCalls == 0);
        integration.Shutdown();
    }
    static void ResetAfterP1()
    {
        var integration = Create(out var pipeName); var encounter = Seed(integration);
        SessionIdentityIntegration.Current.ResetForTest();
        var newOwner = SessionIdentityIntegration.Current.Owner;
        newOwner.Register(new Ped(),"unrelated-owner",WorldId);
        Game.GameTime = 1000; integration.Update();
        Check(integration.IsAvailable); Check(newOwner.Count == 1);
        Check(encounter.Registration == null && Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Shutdown();
    }
    static void RetireFailure()
    {
        var integration = Create(out var pipeName); Seed(integration);
        SessionIdentityIntegration.Current.Owner.ThrowOnRetire = true;
        Game.GameTime = 1000; integration.Update();
        Check(!integration.IsAvailable);
        Check(Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        Check(Game.Logs.Contains("[P2] game_clock_reset_failed"));
        integration.Shutdown();
    }
    static void ForwardClock()
    {
        var integration = Create(out var pipeName); var original = Field<ControlChannel>(integration,"channel");
        integration.Update(); Game.GameTime = 2500; integration.Update();
        Check(integration.IsAvailable && ReferenceEquals(original,Field<ControlChannel>(integration,"channel")));
        Check(!Game.Logs.Contains("[P2] game_clock_reset"));
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Shutdown();
    }
}
