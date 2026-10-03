using System;
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
        static volatile bool starting,stopping,finished;
        public static bool Ready=>integration?.IsAvailable==true && !stopping;
        public static bool Alive=>!finished;
        public static bool Start(string text)
        {
            if(starting || integration!=null || finished || text==null || text.Length>4096) return false;
            var config=new JavaScriptSerializer {MaxJsonLength=4096}.Deserialize<Config>(text);
            if(config==null || !config.enabled) return false;
            starting=true;
            // Remoting only schedules; native work executes in a game fiber.
            GameFiber.StartNew(()=>{
                try {
                    GameFiber.Yield();
                    if(stopping) return;
                    integration=new PromotedCharactersIntegration(config.worldProfileId,config.pipeName,config.identityPipeName);
                    IntegrationManager.Register(integration); integration.Initialize();
                    if(config.intelligence?.mode=="shadow") {
                        try {
                            intelligence=new LSA.Intelligence.IntelligenceIntegration(integration.PerceptionRoster,config.intelligence.pipeName);
                            integration.OwnerRetired+=intelligence.OwnerRetired;
                            IntegrationManager.Register(intelligence);intelligence.Initialize();
                        } catch {Game.LogTrivial("[PS] optional_host_unavailable");}
                    }
                    Game.LogTrivial(integration.IsAvailable?"[P2] integrations_installed":"[P2] integration_unavailable");
                    while(!stopping && integration.IsAvailable) GameFiber.Sleep(100);
                } catch {Game.LogTrivial("[P2] host_initialization_failed");}
                finally {intelligence?.Shutdown();integration?.Shutdown(); finished=true;}
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
