using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Web.Script.Serialization;
using Rage;
using Rage.Attributes;
using Rage.Native;

[assembly: Plugin("LSA WPS E0 Lab",Description="Isolated explicit opt-in GTA V Enhanced capability census",Author="ComradeGenosse",EntryPoint="LSA.WPS.Lab.EntryPoint.Main",ExitPoint="LSA.WPS.Lab.EntryPoint.Shutdown",PrefersSingleInstance=true)]
namespace LSA.WPS.Lab
{
    public static class EntryPoint
    {
        static readonly ConcurrentQueue<Action> commands=new ConcurrentQueue<Action>();
        static volatile bool stop;
        static LabRunner runner;
        public static void Main()
        {
            try {
                if (!string.Equals(Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName),"GTA5_Enhanced.exe",StringComparison.OrdinalIgnoreCase))
                    return;
                string root=Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
                string file=Path.Combine(root,"Plugins","LSA.WPS.Lab.json");
                if(!File.Exists(file)||new FileInfo(file).Length>16384) {Game.LogTrivial("[WPS-LAB] Missing/oversized config; no probes active");return;}
                var cfg=new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(file));
                if(cfg==null)return;cfg.Validate();
                if(!cfg.enabled){Game.LogTrivial("[WPS-LAB] Lab disabled; no probes active");return;}
                runner=new LabRunner(root,cfg);
                stop=false;
                Game.LogTrivial("[WPS-LAB] E0 ready. Console: WPSE0Start E0.0, WPSE0Status, WPSE0Cancel, WPSE0Reset, WPSE0ArmBudget");
                while(!stop) {
                    while(commands.TryDequeue(out var command)) {try{command();}catch(Exception ex){Game.LogTrivial("[WPS-LAB] command_error "+ex.GetType().Name);}}
                    runner.Tick();
                    GameFiber.Sleep(0);
                }
            }catch(Exception ex){Game.LogTrivial("[WPS-LAB] fatal "+ex.GetType().Name);}
            finally {try{runner?.Shutdown();}catch{} runner=null;}
        }
        public static void Shutdown(){stop=true;runner?.SignalCancel();}
        static void Queue(Action action){if(runner==null){Game.Console.Print("E0 lab not enabled or loaded");return;}commands.Enqueue(action);}
        [ConsoleCommand(Name="WPSE0Start",Description="Run exactly one E0 probe; world-changing probes require configured consent.")]
        public static void Start(string id)=>Queue(()=>runner.Start(id));
        [ConsoleCommand(Name="WPSE0Status",Description="Show active experiment and recorded verdicts.")]
        public static void Status()=>Queue(()=>runner.Status());
        [ConsoleCommand(Name="WPSE0Cancel",Description="Emergency stop; rollback owned entities, IPL and time scale.")]
        public static void Cancel()=>Queue(()=>runner.Cancel("operator_cancel"));
        [ConsoleCommand(Name="WPSE0Reset",Description="Stop, restore game state, clear only in-memory probe counters.")]
        public static void Reset()=>Queue(()=>runner.Reset());
        [ConsoleCommand(Name="WPSE0ArmBudget",Description="One-use consent to E0.9 up to configured cap.")]
        public static void ArmBudget()=>Queue(()=>runner.ArmBudget());
        [ConsoleCommand(Name="WPSE0Mode",Description="Set E0.4 manual fire mode: single, burst, auto, shotgun, npc.")]
        public static void Mode(string value)=>Queue(()=>runner.Mode(value));
    }
}
