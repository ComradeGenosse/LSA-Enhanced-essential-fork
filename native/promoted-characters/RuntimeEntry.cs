using System;
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
                try {
                    GameFiber.Yield();
                    if(stopping) return;
                    integration=new PromotedCharactersIntegration(config.worldProfileId,config.pipeName,config.identityPipeName);
                    integration.Prepare();
                    IntegrationManager.Register(integration);
                    if(config.intelligence?.mode=="shadow") {
                        try {
                            intelligence=new LSA.Intelligence.IntelligenceIntegration(integration.PerceptionRoster,config.intelligence.pipeName);
                            integration.OwnerRetired+=intelligence.OwnerRetired;
                            IntegrationManager.Register(intelligence);
                        } catch {Game.LogTrivial("[PS] optional_host_unavailable");}
                    }
                    Game.LogTrivial("[P2] integrations_registered");
                    while(!stopping && integration.IsAvailable) GameFiber.Sleep(100);
                    Game.LogTrivial(stopping?"[P2] native_host_shutdown_requested":"[P2] native_integration_became_unavailable");
                } catch {Game.LogTrivial("[P2] host_initialization_failed");}
                finally {try {intelligence?.Shutdown();} finally {try {integration?.RequestShutdown();} finally {finished=true;Game.LogTrivial("[P2] native_host_stopped");}}}
            },"LSA character host lifetime");
            return true;
        }
        public static void Stop()=>stopping=true;
        public sealed class Config
        {
            public bool enabled {get;set;} public string worldProfileId {get;set;}
            public string pipeName {get;set;}="LSA.PromotedCharacters.v1";
            public string identityPipeName {get;set;}="LSA.SessionIdentity.v1";
            public IntelligenceConfig intelligence {get;set;}=new IntelligenceConfig();
        }
        public sealed class IntelligenceConfig {public string mode {get;set;}="off";public string pipeName {get;set;}="LSA.Intelligence.v1";}
    }
}
