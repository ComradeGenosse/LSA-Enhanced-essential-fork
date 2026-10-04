using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Reflection;
using System.Threading;
using LSA.PromotedCharacters;
using LosSantosAlive.Integrations;
using Rage;

public sealed class Scenario:MarshalByRefObject
{
    const string Config="{\"enabled\":true,\"worldProfileId\":\"d7dfeaa1-13e8-4a7d-aff7-8e3fbb2ab4b5\"}";
    const string ResultId="00000000-0000-4000-8000-000000000000";
    int assertions;
    public override object InitializeLifetimeService()=>null;
    void Check(bool condition,string message) {if(!condition) throw new Exception(message);assertions++;}
    public int ConcurrentStart()
    {
        const int requests=32;
        var accepted=new bool[requests];
        var errors=new ConcurrentQueue<Exception>();
        using(var gate=new ManualResetEventSlim(false)) {
            var threads=Enumerable.Range(0,requests).Select(index=>new Thread(()=>{
                gate.Wait();
                try {accepted[index]=RuntimeEntry.Start(Config);} catch(Exception error) {errors.Enqueue(error);}
            }) {IsBackground=true}).ToArray();
            foreach(var thread in threads) thread.Start();
            gate.Set();
            Check(threads.All(thread=>thread.Join(10000)),"Parallel starts did not finish.");
        }
        Check(errors.IsEmpty,"A parallel start threw.");
        Check(accepted.Count(value=>value)==1,"More than one owner start was accepted.");
        Check(GameFiber.Scheduled==1,"More than one owner fiber was scheduled.");
        Check(PromotedCharactersIntegration.Constructed==0 && IntegrationManager.Registered==0,"Start performed integration work before the game fiber.");
        Check(!RuntimeEntry.Start(Config),"A duplicate start before fiber execution was accepted.");
        Check(RuntimeEntry.Submit("{}")=="native_unavailable" && RuntimeEntry.Snapshot()==null && RuntimeEntry.TryTakeResult(ResultId)==null,"The bridge answered before the owner existed.");
        RuntimeEntry.RequestSnapshots(1000);
        Check(PromotedCharactersIntegration.Submissions==0 && PromotedCharactersIntegration.SnapshotRequests==0,"The bridge reached an integration before the owner existed.");
        Check(GameFiber.Scheduled==1 && PromotedCharactersIntegration.ShutdownRequests==0 && PromotedCharactersIntegration.Shutdowns==0,"A rejected pending duplicate changed the owner.");
        bool pendingWaited=false,wasReady=false,wasAlive=false,rejected=false,ownerPreserved=false,bridged=false;
        GameFiber.OnSleep=()=>{
            pendingWaited=!RuntimeEntry.Ready && PromotedCharactersIntegration.Prepared==1 && PromotedCharactersIntegration.Initialized==0;
            IntegrationManager.InitializeFromCore();
            wasReady=RuntimeEntry.Ready;wasAlive=RuntimeEntry.Alive;
            rejected=!RuntimeEntry.Start(Config);
            ownerPreserved=RuntimeEntry.Ready && PromotedCharactersIntegration.ShutdownRequests==0 && PromotedCharactersIntegration.Shutdowns==0 && IntegrationManager.Registered==1 && GameFiber.Scheduled==1;
            RuntimeEntry.RequestSnapshots(1000);
            bridged=RuntimeEntry.Submit("{}")=="accepted" && RuntimeEntry.TryTakeResult(ResultId)=="{\"v\":1}" && RuntimeEntry.Snapshot()=="{\"v\":1,\"seq\":1}" && PromotedCharactersIntegration.SnapshotRequests==1;
            RuntimeEntry.Stop();
        };
        GameFiber.ExecuteNext();
        Check(pendingWaited,"The lifetime fiber did not wait for Core initialization while remaining unavailable to live commands.");
        Check(wasReady && wasAlive,"The accepted fiber did not initialize a ready owner.");
        Check(rejected,"A duplicate start while the owner was active was accepted.");
        Check(ownerPreserved,"A rejected active duplicate stopped or replaced the owner.");
        Check(bridged,"The ready owner did not receive bridge submissions, results and snapshots.");
        Check(RuntimeEntry.Submit("{}")=="native_unavailable" && RuntimeEntry.Snapshot()==null && PromotedCharactersIntegration.Submissions==1,"A stopping owner accepted bridge work.");
        RuntimeEntry.RequestSnapshots(1000);
        Check(PromotedCharactersIntegration.SnapshotRequests==1,"A stopping owner accepted snapshot interest.");
        Check(PromotedCharactersIntegration.Constructed==1 && PromotedCharactersIntegration.Prepared==1 && IntegrationManager.Registered==1,"The lifetime fiber did not prepare/register exactly one integration.");
        Check(PromotedCharactersIntegration.Initialized==1 && PromotedCharactersIntegration.InitializedOutsideCore==0,"The lifetime fiber performed native initialization instead of Core.");
        Check(PromotedCharactersIntegration.PreparationThread!=PromotedCharactersIntegration.InitializationThread,"The harness did not test Core initialization on a distinct callback thread.");
        Check(PromotedCharactersIntegration.ShutdownRequests==1 && PromotedCharactersIntegration.Shutdowns==0,"The lifetime fiber did not request exactly one deferred shutdown.");
        Check(IntegrationManager.Available,"Shutdown request removed Core callback admission before native cleanup.");
        Check(!RuntimeEntry.Ready && !RuntimeEntry.Alive,"The stopped owner still reports readiness/liveness.");
        IntegrationManager.UpdateFromCore();
        Check(PromotedCharactersIntegration.Shutdowns==1 && PromotedCharactersIntegration.ShutdownOutsideCore==0,"Core did not retire the owner exactly once.");
        Check(PromotedCharactersIntegration.InitializationThread==PromotedCharactersIntegration.ShutdownThread,"Native cleanup ran outside the initialization owner's Core thread.");
        Check(!IntegrationManager.Available,"Core cleanup left the integration available.");
        Check(!RuntimeEntry.Start(Config) && GameFiber.Scheduled==1,"A finished owner was restarted in the same domain.");
        Check(!Game.Logs.Contains("[P2] host_initialization_failed"),"The owner fiber swallowed a harness failure.");
        return assertions;
    }
    public int StopBeforeExecution()
    {
        Check(RuntimeEntry.Start(Config),"The first start was rejected.");
        Check(GameFiber.Scheduled==1,"The first start did not schedule one fiber.");
        RuntimeEntry.Stop();
        Check(!RuntimeEntry.Ready,"Stop left pending native actions ready.");
        GameFiber.ExecuteNext();
        Check(PromotedCharactersIntegration.Constructed==0 && PromotedCharactersIntegration.Prepared==0 && PromotedCharactersIntegration.Initialized==0 && IntegrationManager.Registered==0,"A stopped pending fiber prepared or initialized an integration.");
        Check(PromotedCharactersIntegration.ShutdownRequests==0 && PromotedCharactersIntegration.Shutdowns==0,"A stopped pending fiber requested shutdown of an unrelated integration.");
        Check(!RuntimeEntry.Alive && !RuntimeEntry.Ready,"The canceled fiber did not finish.");
        Check(!RuntimeEntry.Start(Config) && GameFiber.Scheduled==1,"A canceled owner was restarted in the same domain.");
        return assertions;
    }
}
static class Program
{
    static int Run(string name,Func<Scenario,int> exercise)
    {
        // Fresh domains reset the production static state between scenarios;
        // no test resets or mutates RuntimeEntry's private fields.
        var domain=AppDomain.CreateDomain(name);
        try {
            var scenario=(Scenario)domain.CreateInstanceFromAndUnwrap(Assembly.GetExecutingAssembly().Location,typeof(Scenario).FullName);
            return exercise(scenario);
        } finally {AppDomain.Unload(domain);}
    }
    static void Main()
    {
        int count=Run("runtime_parallel_start",scenario=>scenario.ConcurrentStart())+Run("runtime_stop_before_execution",scenario=>scenario.StopBeforeExecution());
        Console.WriteLine(count+" production runtime admission/lifetime assertions passed; no game assemblies executed.");
    }
}
