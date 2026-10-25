using System;
using System.Linq;
using LSA.Enhanced.VehicleHud;

static partial class Program
{
    static void VehicleCrashTests()
    {
        var recorder=new VehicleCrashFlightRecorder();
        Check(!recorder.Enabled && recorder.Status=="OFF",
            "VH4 flight recorder is OFF by default");
        Check(recorder.Observe(new VehicleView(Reading(),null,new DamageEvent[0]),"adder",0,
            "2026-10-25T19:00:00Z")==null,
            "disabled flight recorder does no work");
        recorder.SetEnabled(true);
        string output=null;
        for(int i=0;i<=75;i++) {
            long at=i*200;
            var reading=Reading(body:i>=22?920f:1000f,engine:1000f);
            var view=new VehicleView(reading,null,new DamageEvent[0],at);
            string next=recorder.Observe(view,"adder",at,"2026-10-25T19:00:00Z");
            if(next!=null)output=next;
        }
        Check(output!=null && recorder.IncidentCount==1 &&
            recorder.Status.StartsWith("ARMED"),
            "opt-in recorder saves one event after fixed 8s post window");
        var lines=output.Trim().Split('\n');
        Check(lines.Length>30 && lines.Length<=111 &&
            lines[0].StartsWith("incident_id,trigger,relative_ms") &&
            lines.Skip(1).All(x=>x.TrimEnd('\r').Split(',').Length==29),
            "flight recorder exports bounded 29-column 5Hz snapshots");
        Check(output.Contains("body_hp_drop") && output.Contains(",-") &&
            output.Contains(",920,"),
            "flight event includes pre-impact history and body-damage measurements");
        recorder.SetEnabled(false);
        Check(recorder.Status=="OFF" && !recorder.Enabled,
            "flight stop drops in-memory rolling history");
        var tire=new VehicleCrashFlightRecorder();
        tire.SetEnabled(true);
        tire.Observe(new VehicleView(Reading(burst:0),null,new DamageEvent[0]),"adder",0,"utc");
        tire.Observe(new VehicleView(Reading(burst:1),null,new DamageEvent[0]),"adder",200,"utc");
        Check(tire.Status=="RECORDING tire_burst",
            "verified tire burst triggers the flight recorder without body loss");
        tire.NoVehicle();
        Check(tire.IncidentCount==0 &&
            tire.Status=="ARMED - waiting for vehicle",
            "vehicle exit discards incomplete incident without extra I/O");
        tire.SetEnabled(false);
        var unknown=new VehicleCrashFlightRecorder();
        unknown.SetEnabled(true);
        unknown.Observe(new VehicleView(Reading(burst:0,known:0),null,new DamageEvent[0]),"adder",0,"utc");
        unknown.Observe(new VehicleView(Reading(burst:1,known:15),null,new DamageEvent[0]),"adder",200,"utc");
        Check(!unknown.Status.StartsWith("RECORDING"),
            "unknown previous tire state does not fabricate a puncture event");
        unknown.SetEnabled(false);
    }
}
