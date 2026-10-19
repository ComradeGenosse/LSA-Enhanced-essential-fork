using System;
using System.Diagnostics;
using System.IO;
using System.Web.Script.Serialization;
using Rage;
using Rage.Attributes;

[assembly: Plugin("LSA AGM E0 Lab", Description="Isolated AI Game Master capability census; LAB SAVE ONLY", Author="ComradeGenosse", EntryPoint="LSA.AGM.E0.EntryPoint.Main", ExitPoint="LSA.AGM.E0.EntryPoint.Shutdown", PrefersSingleInstance=true)]

namespace LSA.AGM.E0
{
    public static class EntryPoint
    {
        private static volatile bool stopping;
        private static LabRuntime runtime;
        private static string gate;
        private const string Consent = "I_ACCEPT_AGM_E0_LAB_SAVE_RISK";
        public static void Main()
        {
            try {
                if(!string.Equals(Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName),"GTA5_Enhanced.exe",StringComparison.OrdinalIgnoreCase)) return;
                var root=Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
                gate=Path.Combine(root,"Plugins","LSA.AGM.E0.lab.json");
                if(!File.Exists(gate) || new FileInfo(gate).Length>1024) {
                    Game.LogTrivial("[AGM-E0] inert: lab config missing"); return;
                }
                var settings=new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(gate));
                if(settings==null || settings.enabled!=true || settings.acknowledgeLabOnly!=Consent) {
                    Game.LogTrivial("[AGM-E0] inert: explicit lab opt-in missing");return;
                }
                stopping=false;
                runtime=new LabRuntime(Path.Combine(root,"Plugins","LSA.AGM.E0"),settings);
                runtime.Log("boot",new { sdk="RagePluginHook NuGet 1.124.0", gta= "runtime_observation_required",
                    rph= "runtime_observation_required", branch="experiment/agm-e0-native-capability-census",
                    disclaimer="E0 lab; zero production integration", runId=runtime.RunId });
                runtime.Print("AGM E0 enabled for a lab save. AGME0Help / AGME0Status / AGME0Run e0.1");
                while(!stopping) {
                    try {runtime.Tick();} catch(Exception e) {runtime.Fail("tick_exception",e);runtime.Stop("tick_failure");}
                    GameFiber.Sleep(25);
                }
            } catch(Exception e) {Game.LogTrivial("[AGM-E0] fatal "+e.GetType().Name);}
            finally {Shutdown();}
        }
        public static void Shutdown()
        {
            stopping=true;
            var r=runtime;
            runtime=null;
            if(r!=null) {try {r.Stop("plugin_exit");}catch {} try {r.Dispose();}catch{} }
        }
        private static bool Ready(out LabRuntime r)
        {
            r=runtime;
            if(r==null || stopping) {Game.Console.Print("AGM E0 inert. See Plugins/LSA.AGM.E0.lab.json.");return false;}
            return true;
        }
        public sealed class Settings
        {
            public bool enabled {get;set;}
            public string acknowledgeLabOnly {get;set;}
        }
        [ConsoleCommand(Name="AGME0Help",Description="List isolated E0 census lab commands.")]
        public static void Help()
        {
            Game.Console.Print("AGME0Site terminal|grapeseed|vinewood|delperro (visit site first)");
            Game.Console.Print("AGME0Condition essential_off|yield_off|yield_on");
            Game.Console.Print("AGME0Task walk|drive|flee|guard|chase|follow|combat");
            Game.Console.Print("AGME0Run e0.1 ... e0.8 ; AGME0Status ; AGME0Cancel ; AGME0Clean");
            Game.Console.Print("AGME0Day day|night ; AGME0Nathan present|absent ; AGME0Truth pass|fail|unknown");
            Game.Console.Print("No automatic teleports, no model calls, no production hooks.");
        }
        [ConsoleCommand(Name="AGME0Site",Description="Label your current test area; walk there yourself.")]
        public static void Site(string value) {if(Ready(out var r)) r.SetSite(value);}
        [ConsoleCommand(Name="AGME0Condition",Description="Set Essential/yield negative-control condition.")]
        public static void Condition(string value) {if(Ready(out var r)) r.SetCondition(value);}
        [ConsoleCommand(Name="AGME0Task",Description="Select controlled scene-owned task policy.")]
        public static void Task(string value) {if(Ready(out var r)) r.SetTask(value);}
        [ConsoleCommand(Name="AGME0Day",Description="Record observed lighting: day or night.")]
        public static void Day(string value) {if(Ready(out var r)) r.SetDay(value);}
        [ConsoleCommand(Name="AGME0Nathan",Description="Record Nathan present or absent; never summon or control him.")]
        public static void Nathan(string value) {if(Ready(out var r)) r.SetNathan(value);}
        [ConsoleCommand(Name="AGME0Run",Description="Run exactly one bounded E0.1-E0.8 probe.")]
        public static void Run(string name) {if(Ready(out var r)) r.Run(name);}
        [ConsoleCommand(Name="AGME0Status",Description="Inspect current E0 lease and diagnostic location.")]
        public static void Status() {if(Ready(out var r)) r.Status();}
        [ConsoleCommand(Name="AGME0Cancel",Description="Emergency cancellation and cleanup of all owned entities.")]
        public static void Cancel() {if(Ready(out var r)) r.Stop("emergency_cancel");}
        [ConsoleCommand(Name="AGME0Clean",Description="Delete owned scene entities and sweep same-run orphans.")]
        public static void Clean() {if(Ready(out var r)) r.Stop("manual_cleanup");}
        [ConsoleCommand(Name="AGME0Truth",Description="Record video-ground-truth sensor label for E0.5: pass/fail/unknown.")]
        public static void Truth(string value) {if(Ready(out var r)) r.Truth(value);}
    }
}