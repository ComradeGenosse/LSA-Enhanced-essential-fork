using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using LSA.PromotedCharacters;

// The real RuntimeEntry runs with a substitute fiber/Core manager and integrations.
// IntegrationManager's Register/Update semantics match the pinned Core IL audit.
// Intelligence's actual counter/failure behavior is tested by integration-tests.
static class Program
{
    static int assertions;
    static void Check(bool value,string label) {if(!value)throw new Exception(label);assertions++;}
    static void Main(string[] args)
    {
        var scenario=args.Length==0?"continuous":args[0];
        int elapsed=0;long callsAtStall=0;
        Rage.GameFiber.OnSleep=milliseconds=>{
            elapsed+=milliseconds;
            if(scenario=="stop") {RuntimeEntry.Stop();return;}
            if(scenario=="failed") throw new Exception("test host fiber failure");
            if(scenario!="stalled"||elapsed<=4000) LosSantosAlive.Integrations.IntegrationManager.Update();
            if(elapsed==4000) callsAtStall=LSA.Intelligence.IntelligenceIntegration.Instance.UpdateCalls;
            if(elapsed>=21100) {PromotedCharactersIntegration.Instance.LoseAvailability();return;}
            Thread.Sleep(milliseconds);
        };
        var config="{\"enabled\":true,\"worldProfileId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"intelligence\":{\"mode\":\"shadow\"}}";
        Check(RuntimeEntry.Start(config),"real RuntimeEntry starts");
        var intelligence=LSA.Intelligence.IntelligenceIntegration.Instance;
        Check(LosSantosAlive.Integrations.IntegrationManager.Registered.Count==2,"P2 and PS register with Core manager");
        Check(!RuntimeEntry.Alive&&!RuntimeEntry.Ready,"host completes and releases availability");
        Check(intelligence.ShutdownCalls==1&&PromotedCharactersIntegration.Instance.ShutdownCalls==1,"host shuts down each dependency once");
        var status=Rage.Game.Logs.Where(l=>l.StartsWith("[PS] host_status ")).ToArray();
        if(scenario=="stop"||scenario=="failed") {
            Check(intelligence.UpdateCalls==0,"host does not invent a sampling pump");
            Check(intelligence.ShutdownReason==(scenario=="stop"?"host_stop_requested":"host_failed"),"explicit stop/failure reason retained");
        } else {
            Check(status.Length==4,"status emits at startup, 10s, 20s and exit");
            Check(intelligence.ShutdownReason=="host_unavailable","host dependency loss attributed");
            Check(Rage.Game.Logs.Any(l=>l=="[P2] host_exit reason=host_unavailable p2_reason=clock_regression"),"dependency reason recorded before teardown");
            Check(status.Last().Contains("p2_available=False"),"final status observes failed availability");
            if(scenario=="stalled") {
                Check(intelligence.UpdateCalls==callsAtStall,"host status does not tick stopped Core caller");
                Check(status[1].Contains("update_calls="+callsAtStall)&&status[2].Contains("update_calls="+callsAtStall),"heartbeat continues with unchanged counts during stall");
            } else Check(intelligence.UpdateCalls==211,"Core supplies each update exactly once");
        }
        Check(!RuntimeEntry.Start(config),"completed host cannot restart implicitly");
        Console.WriteLine("PASS "+assertions+" real host lifecycle assertions: "+scenario);
    }
}

namespace Rage
{
    public static class Game {public static readonly List<string> Logs=new List<string>();public static void LogTrivial(string text)=>Logs.Add(text);}
    public static class GameFiber {public static Action<int> OnSleep;public static void StartNew(Action work,string name)=>work();public static void Yield(){}public static void Sleep(int ms)=>OnSleep(ms);}
}
namespace LSA.SessionIdentity { }
namespace LosSantosAlive.Integrations
{
    public interface IIntegration {bool IsAvailable{get;}void Update();}
    public static class IntegrationManager
    {
        public static readonly List<IIntegration> Registered=new List<IIntegration>();
        public static void Register(IIntegration item)=>Registered.Add(item);
        public static void Update() {foreach(var item in Registered)if(item.IsAvailable)item.Update();}
    }
}
namespace LSA.PromotedCharacters
{
    public sealed class PromotedCharactersIntegration:LosSantosAlive.Integrations.IIntegration
    {
        public static PromotedCharactersIntegration Instance;public bool IsAvailable{get;private set;}public int ShutdownCalls;internal string UnavailabilityReason{get;private set;}="none";
        public event Action<string> OwnerRetired {add{}remove{}}
        public PromotedCharactersIntegration(string world,string pipe,string identity) {Instance=this;}
        public void Prepare()=>IsAvailable=true;
        public bool IsReady=>IsAvailable;
        internal string IdentityRuntimeStatus=>"identity_status=test";
        public void RequestShutdown(){ShutdownCalls++;IsAvailable=false;}
        public void Initialize()=>IsAvailable=true;
        public void Update(){}
        internal void EnableActivityShadow(string pipeName) {}
        public LSA.Intelligence.OwnedParticipant[] PerceptionRoster()=>new LSA.Intelligence.OwnedParticipant[0];
        public void LoseAvailability(){IsAvailable=false;UnavailabilityReason="clock_regression";}
        internal string SubmitLocal(string envelope)=>"accepted";internal string TakeLocalResult(string id)=>null;internal string LocalSnapshot()=>null;internal void RequestLocalSnapshots(int forMs){}
        internal void Shutdown(string reason){ShutdownCalls++;IsAvailable=false;}
    }
}
namespace LSA.Intelligence
{
    public sealed class OwnedParticipant { }
    public sealed class IntelligenceIntegration:LosSantosAlive.Integrations.IIntegration
    {
        public static IntelligenceIntegration Instance;public bool IsAvailable{get;private set;}public long UpdateCalls;public int ShutdownCalls;public string ShutdownReason="none";
        public IntelligenceIntegration(Func<OwnedParticipant[]> roster,string pipe){Instance=this;}
        public void Initialize()=>IsAvailable=true;
        public void Update(){UpdateCalls++;}
        public void OwnerRetired(string lifetime){}
        internal void Shutdown(string reason){ShutdownCalls++;ShutdownReason=reason;IsAvailable=false;}
        internal string RuntimeStatus()=>"available="+IsAvailable+" update_calls="+UpdateCalls;
        internal static void LogStatus(string text)=>Rage.Game.LogTrivial(text);
    }
}
