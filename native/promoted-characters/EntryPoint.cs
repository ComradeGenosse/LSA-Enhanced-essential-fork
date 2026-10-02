using System;
using System.Diagnostics;
using System.IO;
using System.Web.Script.Serialization;
using Rage;
using Rage.Attributes;
[assembly: Plugin("LSA Promoted Characters",Description="Persistent character host for the running Essential instance",Author="ComradeGenosse",EntryPoint="LSA.PromotedCharacters.EntryPoint.Main",ExitPoint="LSA.PromotedCharacters.EntryPoint.Shutdown",AssemblyProbingPaths="Plugins",PrefersSingleInstance=true)]
namespace LSA.PromotedCharacters
{
    // This RAGE plugin has no reference to Core/P1. Their static targeting,
    // integration manager and state must stay in the actual Essential domain.
    public static class EntryPoint
    {
        static DomainHost host;
        public static void Main()
        {
            try {
                string executable=Process.GetCurrentProcess().MainModule.FileName;
                if(!string.Equals(Path.GetFileName(executable),"GTA5_Enhanced.exe",StringComparison.OrdinalIgnoreCase)) return;
                string plugins=Path.Combine(Path.GetDirectoryName(executable),"Plugins");
                // RAGE shadow-copies DLLs to Temp; Assembly.Location isn't the
                // installation folder and must never determine configuration.
                string file=Path.Combine(plugins,"LSA.PromotedCharacters.json");
                if(!File.Exists(file) || new FileInfo(file).Length>4096) return;
                string text=File.ReadAllText(file);
                var config=new JavaScriptSerializer {MaxJsonLength=4096}.Deserialize<Config>(text);
                if(config==null || !config.enabled) return;
                Game.LogTrivial("[P2] host_starting");
                AppDomain target=null;
                var deadline=Stopwatch.StartNew();
                while(target==null && deadline.ElapsedMilliseconds<15000) {
                    target=ClrDomains.FindEssential(Path.Combine(plugins,"LSA.PromotedCharacters.dll"));
                    if(target==null) GameFiber.Sleep(250);
                }
                if(target==null) {Game.LogTrivial("[P2] essential_host_unavailable");return;}
                host=(DomainHost)target.CreateInstanceFromAndUnwrap(Path.Combine(plugins,"LSA.PromotedCharacters.dll"),typeof(DomainHost).FullName);
                if(!host.Start(plugins,text)) {Game.LogTrivial("[P2] essential_host_rejected_"+host.Status);return;}
                PlayerCommands.Initialize(config.editorPort);
                bool reported=false;
                deadline.Restart();
                while(host.Alive) {
                    if(!reported && host.Ready) {Game.LogTrivial("[P2] essential_host_ready");reported=true;}
                    if(!reported && deadline.ElapsedMilliseconds>15000) {Game.LogTrivial("[P2] host_start_timeout");break;}
                    PlayerCommands.Update();GameFiber.Sleep(100);
                }
            } catch {Game.LogTrivial("[P2] optional_initialization_failed");}
            finally {Shutdown();}
        }
        public static void Shutdown() {PlayerCommands.Shutdown();try{host?.Stop();}catch{}host=null;}
        public sealed class Config {public bool enabled {get;set;} public int editorPort {get;set;}=37921;}
    }
}
