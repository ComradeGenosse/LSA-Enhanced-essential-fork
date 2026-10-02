using System;
using System.IO;
using System.Web.Script.Serialization;
using LosSantosAlive.Integrations;
using Rage;
using Rage.Attributes;

[assembly: Plugin("LSA Promoted Characters",Description = "Explicit persistent character ownership and Essential companion controls",Author = "ComradeGenosse",EntryPoint = "LSA.PromotedCharacters.EntryPoint.Main",ExitPoint = "LSA.PromotedCharacters.EntryPoint.Shutdown")]
namespace LSA.PromotedCharacters
{
    public static class EntryPoint
    {
        static PromotedCharactersIntegration integration;
        public static void Main()
        {
            try {
                string file = Path.Combine(Path.GetDirectoryName(typeof(EntryPoint).Assembly.Location),"LSA.PromotedCharacters.json");
                if (!File.Exists(file) || new FileInfo(file).Length > 4096) return;
                var config = new JavaScriptSerializer {MaxJsonLength = 4096}.Deserialize<Config>(File.ReadAllText(file));
                if (config == null || !config.enabled) return;
                integration = new PromotedCharactersIntegration(config.worldProfileId,config.pipeName,config.identityPipeName);
                IntegrationManager.Register(integration); integration.Initialize();
                PlayerCommands.Initialize(config.editorPort);
                // Essential owns Update and every follower/task scheduler. This
                // plugin's fiber only keeps the explicitly loaded plugin alive.
                while (integration.IsAvailable) { PlayerCommands.Update(); GameFiber.Sleep(100); }
            } catch { Game.LogTrivial("[P2] optional_initialization_failed"); }
            finally { Shutdown(); }
        }
        public static void Shutdown() { PlayerCommands.Shutdown(); integration?.Shutdown(); }
        public sealed class Config
        {
            public bool enabled {get;set;}
            public string worldProfileId {get;set;}
            public string pipeName {get;set;} = "LSA.PromotedCharacters.v1";
            public string identityPipeName {get;set;} = "LSA.SessionIdentity.v1";
            public int editorPort {get;set;} = 37921;
        }
    }
}
