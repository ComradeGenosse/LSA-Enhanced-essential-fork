using System;
using System.Diagnostics;
using System.IO;
using System.Web.Script.Serialization;
using LSA.Enhanced;
using Rage;
using Rage.Attributes;
[assembly: Plugin("LSA Promoted Characters",Description="Persistent character host for the running Essential instance",Author="ComradeGenosse",EntryPoint="LSA.PromotedCharacters.EntryPoint.Main",ExitPoint="LSA.PromotedCharacters.EntryPoint.Shutdown",AssemblyProbingPaths="Plugins;Plugins/LSA.PromotedCharacters",PrefersSingleInstance=true)]
namespace LSA.PromotedCharacters
{
    // This RAGE plugin has no reference to Core/P1. Their static targeting,
    // integration manager and state must stay in the actual Essential domain.
    public static class EntryPoint
    {
        static DomainHost host;
        static volatile bool stopping;
        public static void Main()
        {
            try {
                string executable=Process.GetCurrentProcess().MainModule.FileName;
                if(!string.Equals(Path.GetFileName(executable),"GTA5_Enhanced.exe",StringComparison.OrdinalIgnoreCase)) return;
                string plugins=Path.Combine(Path.GetDirectoryName(executable),"Plugins");
                string bootstrap=Path.Combine(plugins,"LSA.PromotedCharacters","LSA.PromotedCharacters.Bootstrap.dll");
                // RAGE shadow-copies DLLs to Temp; Assembly.Location isn't the
                // installation folder and must never determine configuration.
                string file=Path.Combine(plugins,"LSA.PromotedCharacters.json");
                if(!File.Exists(file) || new FileInfo(file).Length>4096) return;
                string text=File.ReadAllText(file);
                var config=new JavaScriptSerializer {MaxJsonLength=4096}.Deserialize<Config>(text);
                if(config==null || !config.enabled) return;
                stopping=false;
                PlayerCommands.Initialize(config.editorPort);
                LogSteamModules();
                // UX phases 2-3: the input router and native menu run on their own
                // fiber in this domain. LSA.Enhanced.json keeps both off by default.
                try {
                    string editor="http://127.0.0.1:"+config.editorPort;
                    EnhancedHost.Start(plugins,()=>editor);
                    PlayerCommands.MenuRequested=EnhancedHost.RequestMenu;
                } catch {Game.LogTrivial("[UX] enhanced_host_start_failed");}
                try {StartHost(plugins,bootstrap,text);} catch {Game.LogTrivial("[P2] optional_initialization_failed");StopHost();}
                // The console frontend belongs to this plugin. An optional host
                // failure must not return Main and remove its commands.
                bool reported=false, auditedLater=false;
                var deadline=Stopwatch.StartNew();
                while(!stopping) {
                    bool ready=false;
                    if(host!=null) {
                        try {
                            if(!host.Alive) {Game.LogTrivial("[P2] native_host_finished");StopHost();}
                            else ready=host.Ready;
                        } catch {Game.LogTrivial("[P2] native_host_disconnected");StopHost();}
                    }
                    PlayerCommands.SetNativeReady(ready);
                    if(!reported && ready) {
                        Game.LogTrivial("[P2] essential_host_ready");reported=true;
                        try {Game.LogTrivial("[UX] command_bridge available="+host.BridgeAvailable);} catch {}
                    }
                    if(!reported && host!=null && deadline.ElapsedMilliseconds>15000) {Game.LogTrivial("[P2] host_start_timeout");StopHost();}
                    if(!auditedLater && deadline.ElapsedMilliseconds>30000) {Game.LogTrivial("[P2] frontend_alive_30s");auditedLater=true;}
                    PlayerCommands.Update();GameFiber.Sleep(100);
                }
            } catch {Game.LogTrivial("[P2] frontend_initialization_failed");}
            finally {Shutdown();Game.LogTrivial("[P2] frontend_stopped");}
        }
        static void StartHost(string plugins,string bootstrap,string text)
        {
                Game.LogTrivial("[P2] host_starting");
                AppDomain target=null;
                var deadline=Stopwatch.StartNew();
                while(!stopping && target==null && deadline.ElapsedMilliseconds<15000) {
                    target=ClrDomains.FindEssential(bootstrap);
                    if(target==null) GameFiber.Sleep(250);
                }
                if(stopping) return;
                if(target==null) {Game.LogTrivial("[P2] essential_host_unavailable");return;}
                host=(DomainHost)target.CreateInstanceFromAndUnwrap(bootstrap,typeof(DomainHost).FullName);
                if(stopping) {StopHost();return;}
                if(!host.Start(plugins,text)) {Game.LogTrivial("[P2] essential_host_rejected_"+host.Status);return;}
                // UX phase 1: console bridge commands submit strings to this host;
                // the phase 2 dispatcher and phase 3 menu use the same bridge.
                PlayerCommands.SetNativeHost(host);
                EnhancedHost.SetNativeHost(host);
        }
        static void StopHost() {try{host?.Stop();}catch{}host=null;PlayerCommands.SetNativeHost(null);EnhancedHost.SetNativeHost(null);PlayerCommands.SetNativeReady(false);}
        // Phase 0 spike S5 support: report once whether Steam's API and overlay
        // renderer are loaded in the game process under RPH. Read-only.
        static void LogSteamModules()
        {
            try {
                bool api=false,overlay=false;
                foreach(ProcessModule module in Process.GetCurrentProcess().Modules) {
                    string name=module.ModuleName;
                    if(string.Equals(name,"steam_api64.dll",StringComparison.OrdinalIgnoreCase)) api=true;
                    else if(string.Equals(name,"gameoverlayrenderer64.dll",StringComparison.OrdinalIgnoreCase)) overlay=true;
                    module.Dispose();
                }
                Game.LogTrivial("[UX] steam_modules steam_api64="+api+" gameoverlayrenderer64="+overlay);
            } catch {Game.LogTrivial("[UX] steam_modules_unavailable");}
        }
        public static void Shutdown() {stopping=true;PlayerCommands.MenuRequested=null;EnhancedHost.Stop();PlayerCommands.Shutdown();StopHost();}
        public sealed class Config {public bool enabled {get;set;} public int editorPort {get;set;}=37921;}
    }
}
