using System;
using System.Diagnostics;
using System.Threading;
using System.Web.Script.Serialization;
using LosSantosAlive.Integrations;
using LSA.SessionIdentity;
using Rage;
namespace LSA.PromotedCharacters
{
    // Loaded only in the existing Essential domain after the core pin check.
    public static class RuntimeEntry
    {
        static PromotedCharactersIntegration integration;
        static LSA.Intelligence.IntelligenceIntegration intelligence;
        static int startClaim;
        static volatile bool stopping,finished;
        public static bool Ready=>integration?.IsReady==true && !stopping;
        public static bool Alive=>!finished;
        public static bool Start(string text)
        {
            if(integration!=null || finished || stopping || text==null || text.Length>4096) return false;
            var config=new JavaScriptSerializer {MaxJsonLength=4096}.Deserialize<Config>(text);
            if(config==null || !config.enabled) return false;
            // Remoting can call Start concurrently. Only one caller may create
            // the owner fiber, including before that fiber has initialized.
            if(Interlocked.CompareExchange(ref startClaim,1,0)!=0) return false;
            // Remoting only schedules; native work executes in a game fiber.
            GameFiber.StartNew(()=>{
                string exitReason="host_unavailable";
                try {
                    GameFiber.Yield();
                    if(stopping) return;
                    integration=new PromotedCharactersIntegration(config.worldProfileId,config.pipeName,config.identityPipeName);
                    if(config.activities?.mode=="shadow") { try { integration.EnableActivityShadow(config.activities.pipeName);} catch {Game.LogTrivial("[ACT] optional_host_unavailable");} }
                    else if(config.activities?.mode=="on") { try { integration.EnableActivityExecution(config.activities.pipeName);} catch {Game.LogTrivial("[ACT] optional_host_unavailable");} }
                    integration.Prepare();
                    IntegrationManager.Register(integration);
                    if(config.intelligence?.mode=="shadow") {
                        try {
                            intelligence=new LSA.Intelligence.IntelligenceIntegration(integration.PerceptionRoster,config.intelligence.pipeName,config.intelligence.radio);
                            integration.OwnerRetired+=intelligence.OwnerRetired;
                            IntegrationManager.Register(intelligence);intelligence.Initialize();
                        } catch {Game.LogTrivial("[PS] optional_host_unavailable");}
                    }
                    Game.LogTrivial(integration.IsAvailable?"[P2] integrations_installed":"[P2] integration_unavailable");
                    var statusClock=Stopwatch.StartNew();long nextStatus=0;
                    while(!stopping && integration.IsAvailable) {
                        if(intelligence!=null && statusClock.ElapsedMilliseconds>=nextStatus) {
                            nextStatus=statusClock.ElapsedMilliseconds+10000;
                            ReportStatus();
                        }
                        GameFiber.Sleep(100);
                    }
                } catch {exitReason="host_failed";LSA.Intelligence.IntelligenceIntegration.LogStatus("[P2] host_initialization_failed");}
                finally {
                    EssentialInputInterception.ReleaseAll();
                    if(stopping) exitReason="host_stop_requested";
                    LSA.Intelligence.IntelligenceIntegration.LogStatus("[P2] host_exit reason="+exitReason+" p2_reason="+(integration?.UnavailabilityReason??"not_initialized"));
                    if(intelligence!=null) ReportStatus();
                    try {intelligence?.Shutdown(exitReason);} finally {try {integration?.RequestShutdown();} finally {finished=true;Game.LogTrivial("[P2] native_host_stopped");}}
                }
            },"LSA character host lifetime");
            return true;
        }
        public static void Stop() { stopping=true; EssentialInputInterception.ReleaseAll(); }
        public static bool LeaseInput(int mark,int text) => !stopping && EssentialInputInterception.Lease(mark,text);
        public static bool LeaseTalkInput(int talk) => !stopping && EssentialInputInterception.LeaseTalk(talk);
        public static bool PulseInput(int vk) => !stopping && EssentialInputInterception.Pulse(vk);
        public static void ReleaseInput() => EssentialInputInterception.Release();
        public static void ReleaseTalkInput() => EssentialInputInterception.ReleaseTalk();
        // UX phase 1 bridge. Strings only; DomainHost reflects into these. Callers
        // never touch game state: work is queued for the integration's Update.
        public static string Submit(string envelope) {var owner=integration;return owner!=null && !stopping?owner.SubmitLocal(envelope):"native_unavailable";}
        public static string TryTakeResult(string id)=>integration?.TakeLocalResult(id);
        public static string Snapshot() {var owner=integration;return owner!=null && !stopping?owner.LocalSnapshot():null;}
        public static void RequestSnapshots(int forMs) {var owner=integration;if(owner!=null && !stopping) owner.RequestLocalSnapshots(forMs);}
        static void ReportStatus() {
            // Observe from the existing host fiber even if Core stops dispatching Update.
            // This never drives sampling or emits new factual frames.
            LSA.Intelligence.IntelligenceIntegration.LogStatus("[PS] host_status p2_available="+(integration?.IsAvailable==true)+" p2_reason="+(integration?.UnavailabilityReason??"not_initialized")+" "+intelligence.RuntimeStatus()+" "+(integration?.IdentityRuntimeStatus??"identity_status=none"));
        }
        public sealed class Config
        {
            public bool enabled {get;set;} public string worldProfileId {get;set;}
            public string pipeName {get;set;}="LSA.PromotedCharacters.v1";
            public string identityPipeName {get;set;}="LSA.SessionIdentity.v1";
            public IntelligenceConfig intelligence {get;set;}=new IntelligenceConfig();
            public ActivitiesConfig activities {get;set;}=new ActivitiesConfig();
        }
        public sealed class IntelligenceConfig {public string mode {get;set;}="off";public string pipeName {get;set;}="LSA.Intelligence.v1";public string radio {get;set;}="off";}
        public sealed class ActivitiesConfig {public string mode {get;set;}="off";public string pipeName {get;set;}="LSA.Activities.v1";}
    }
}
