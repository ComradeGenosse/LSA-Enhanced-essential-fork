using System;
using System.Linq;
using LSA.Enhanced.VehicleHud;
using LSA.Enhanced.Settings;

static partial class Program
{
    static VehicleReading Reading(int handle = 41,float engine = 1000f,float body = 1000f,float tank = 1000f,
        int burst = 0,int known = 15,float speed = 0,float steer = 0,float lateral = 0,bool ground = true,bool forward = true)
    {
        return new VehicleReading {Handle = handle,Engine = engine,Body = body,Tank = tank,
            BurstTires = burst,KnownTires = known,SpeedMps = speed,SteeringDegrees = steer,
            LateralSpeedMps = lateral,OnAllWheels = ground,MovingForward = forward};
    }
    static void VehicleHudTests()
    {
        VehicleMeshTests();
        VehicleGeometryTests();
        VehicleCrashTests();
        var tracker = new VehicleDamageTimeline();
        tracker.Update(Reading(),1000);
        Check(tracker.Current.Events.Length == 0,"initial car reading has no synthetic damage event");
        tracker.Update(Reading(engine:960,body:980,tank:950,burst:1),1200);
        Check(tracker.Current.Events.Select(x=>x.Text).SequenceEqual(new[]{
            "Engine -40 HP","Body -20 HP","Fuel tank -50 HP","Front-left tire burst"
        }),"health deltas and burst captured by component");
        tracker.Update(Reading(engine:960,body:980,tank:950,burst:1),1400);
        Check(tracker.Current.Events.Length == 4,"unchanged state does not duplicate events");
        tracker.Update(Reading(engine:1000,body:1000,tank:1000,burst:0),1600);
        Check(tracker.Current.Events.Length == 5 &&
            tracker.Current.Events.Last().Text == "Front-left tire repaired","repairs and bounded timeline");
        tracker.Update(Reading(handle:99,engine:500,burst:2),1800);
        Check(tracker.Current.Events.Length == 0,"switching vehicle resets event history");
        tracker.Update(Reading(handle:99,engine:480,burst:0,known:0),2000);
        Check(tracker.Current.Events.Length == 1 &&
            !tracker.Current.Events.Any(x=>x.Text.Contains("tire")),"unknown tire states never reported intact or burst");
        tracker.Update(null,2200);
        Check(tracker.Current == null,"exiting vehicle clears snapshot");
        Check(VehicleDamageTimeline.Drift(Reading(speed:17,lateral:0.9f)) == "rightward","stable straight-line lateral drift is inferred");
        Check(VehicleDamageTimeline.Drift(Reading(speed:17,lateral:-0.9f)) == "leftward","lateral drift sign preserved");
        Check(VehicleDamageTimeline.Drift(Reading(speed:17,steer:5,lateral:0.9f)) == null,"turning suppresses drift");
        Check(VehicleDamageTimeline.Drift(Reading(speed:7,lateral:0.9f)) == null,"low speed suppresses drift");
        Check(VehicleDamageTimeline.Drift(Reading(speed:17,lateral:0.9f,ground:false)) == null,"airborne suppresses drift");
        Check(VehicleDamageTimeline.Drift(Reading(speed:17,lateral:0.9f,forward:false)) == null,"reversing suppresses drift");
        Check(VehicleDamageTimeline.Drift(Reading(speed:17,lateral:4f)) == null,"large slide suppresses drift");
        tracker.Update(Reading(speed:17,lateral:0.9f),3000); // vehicle-switch baseline
        tracker.Update(Reading(speed:17,lateral:0.9f),3200); // first eligible lateral sample
        tracker.Update(Reading(speed:17,lateral:0.9f),4400);
        Check(tracker.Current.DriftHint == null,"brief lateral motion cannot imply pull");
        tracker.Update(Reading(speed:17,lateral:0.9f),4800);
        Check(tracker.Current.DriftHint != null && tracker.Current.Events.Last().Text.Contains("inferred"),
            "sustained drift labeled inferred and logged");
        tracker.Update(Reading(speed:17,lateral:0f),5000);
        Check(tracker.Current.DriftHint == null,"drift display clears when motion straightens");
        // Per-wheel API readings remain distinct from punctures and health percentages.
        var samples = new VehicleDamageTimeline();
        var w0 = Reading();
        w0.KnownWheelHealth = 1; w0.WheelHealth[0] = 1000f;
        w0.KnownTireHealth = 1; w0.TireHealth[0] = 900f;
        w0.KnownDeformation = 1; w0.Deformation[0] = 0.10f;
        samples.Update(w0,10000);
        var w1 = Reading(body:820);
        w1.KnownWheelHealth = 1; w1.WheelHealth[0] = 975f;
        w1.KnownTireHealth = 1; w1.TireHealth[0] = 870f;
        w1.KnownDeformation = 1; w1.Deformation[0] = 0.35f;
        samples.Update(w1,10200);
        Check(samples.Current.Events.Any(x=>x.Text=="Major body damage -180 HP"),
            "substantial body delta is reported as aggregate damage, not impact-zone certainty");
        Check(samples.Current.Events.Any(x=>x.Text=="Wheel slot 0 -25 raw units") &&
            samples.Current.Events.Any(x=>x.Text=="Tire slot 0 -30 raw units"),
            "wheel and tire health are independent raw sampled measurements");
        Check(samples.Current.Events.Any(x=>x.Text.StartsWith("Chassis probe 0 +")),
            "deformation delta reports its anonymous fixed probe location");
        var missing = Reading(body:820);
        missing.WheelHealth[0] = 0; missing.TireHealth[0] = 0; missing.Deformation[0] = 4;
        samples.Update(missing,10400);
        Check(!samples.Current.Events.Any(x=>x.Text.Contains("slot 0 recovered")),
            "unavailable getter is not interpreted as recovered wheel health");
        samples.Update(Reading(handle:77,body:820),10600);
        Check(samples.Current.Events.Length == 0,"wheel/probe history resets across vehicles");

        // VH2 player HUD: readable alerts must never map unverified RPH wheel
        // slots to physical corners or declare unknown values healthy.
        var uiTracker = new VehicleDamageTimeline();
        Check(VehicleHudPresentation.WheelState(Reading(known:0),0) == 0,
            "unavailable native puncture data is unknown, not a healthy wheel");
        uiTracker.Update(Reading(),20000);
        uiTracker.Update(Reading(known:15,burst:1,body:905),20200);
        var uiView = uiTracker.Current;
        var ui = VehicleHudPresentation.Build(uiView,20200);
        Check(ui.Status == "TIRE PUNCTURE" && ui.Severity == 2 &&
            VehicleHudPresentation.WheelState(uiView.Reading,0) == 2 &&
            VehicleHudPresentation.WheelState(uiView.Reading,1) == 1,
            "puncture is critical while other wheels mean no native burst only");
        Check(ui.Alerts.Any(x=>x.Text == "FRONT-LEFT TIRE PUNCTURED") &&
            ui.Alerts.Any(x=>x.Text == "BODY DAMAGE"),
            "high-level alerts report two actionable observations");
        Check(VehicleHudPresentation.Translate("Wheel slot 0 -40 raw units") == null &&
            VehicleHudPresentation.Translate("Tire slot 0 -200 raw units") == null &&
            VehicleHudPresentation.Translate("Chassis probe 2 +0.13 units (sample)") == null,
            "experimental raw slots and probes never become gameplay alerts");
        Check(VehicleHudPresentation.Build(uiView,30000).Alerts.Length == 0,
            "alerts expire instead of lingering during normal driving");
        Check(VehicleHudPresentation.HealthPercent(float.NaN) == -1 &&
            VehicleHudPresentation.HealthPercent(-10) == -1 &&
            VehicleHudPresentation.HealthPercent(980) == 98,
            "missing health cannot be drawn as 100% condition");
        var csvReading=Reading();
        csvReading.KnownTireHealth=1; csvReading.TireHealth[0]=0;
        var csv = VehicleTelemetryCsv.Row("2026-10-25T00:00:00Z","sample","testcar",
            new VehicleView(csvReading,null,new DamageEvent[0]));
        Check(csv.Split(',').Length == 22 && csv.Contains(",0,") &&
            csv.Contains(",,,,") && VehicleTelemetryCsv.Header.Split(',').Length == 22,
            "CSV preserves zero tire health separately from unavailable slots");

        // VH3 forensic trace: a valid zero differs from an unsupported
        // sample, and timing/position are retained without changing 24-field CSV.
        var traceBounds=new DeformationBounds(-1,-2,-.2f,1,2,1.5f);
        var traceCapture=new DeformationCapture("trace-01","baseline","adder",31,
            "2026-10-25T19:00:00Z",traceBounds,987,943);
        traceCapture.Record(0f,0f,0f);
        var traceRow=VehicleProbeTrace.Row(traceCapture,traceCapture.Results[0],
            "2026-10-25T19:00:01Z",240,42,0f,float.NaN,2.5f,12f,
            "1.0.1158.16","1.132");
        Check(VehicleProbeTrace.Header.Split(',').Length==25 &&
            traceRow.Split(',').Length==25 && traceRow.Contains(",240,42,0,") &&
            traceRow.Contains(",,2.5,12,"),
            "forensic CSV retains per-probe time, real zero speed and unknown coordinate");
        traceCapture.Record(float.NaN,float.NaN,float.NaN,"native_Unsupported");
        var badRow=VehicleProbeTrace.Row(traceCapture,traceCapture.Results[1],
            "2026-10-25T19:00:02Z",650,248,float.NaN,float.NaN,float.NaN,float.NaN,
            "unavailable","1.132");
        Check(badRow.Contains("native_Unsupported") && badRow.Contains(",0,") &&
            badRow.Split(',').Length==25,
            "unsupported probe is recorded with reason and missing motion data");

        // VH3: geometry normalization and native-independent capture/export.
        var bounds = new DeformationBounds(-1f,-2.2f,-0.25f,1f,2.2f,1.65f);
        var probeGrid = VehicleDeformationGrid.Build(bounds);
        Check(probeGrid.Length == 48 && probeGrid.Select(p => p.Index).SequenceEqual(
            Enumerable.Range(0,48)), "48 stable, indexed exterior probes");
        Check(probeGrid.Count(p=>p.Region=="front")==9 &&
            probeGrid.Count(p=>p.Region=="rear")==9 &&
            probeGrid.Count(p=>p.Region=="left")==12 &&
            probeGrid.Count(p=>p.Region=="right")==12 &&
            probeGrid.Count(p=>p.Region=="roof")==6,
            "probe census covers both ends, both sides and roof");
        Check(probeGrid.All(p=>p.X>=bounds.MinX&&p.X<=bounds.MaxX &&
            p.Y>=bounds.MinY&&p.Y<=bounds.MaxY &&
            p.Z>=bounds.MinZ&&p.Z<=bounds.MaxZ),
            "all sample offsets remain inside validated model bounds");
        Check(VehicleDeformationGrid.Build(new DeformationBounds(0,0,0,0,0,0)).Length==0 &&
            VehicleDeformationGrid.Build(new DeformationBounds(float.NaN,-2,0,1,2,1)).Length==0,
            "missing, degenerate or NaN model bounds fail closed");
        var baseline=new DeformationCapture("cap_1","baseline","testcar",42,
            "2026-10-25T19:00:00Z",bounds,1000f,1000f);
        Check(baseline.Next.Index==0 && !baseline.Complete,"capture starts blank");
        for(int i=0;i<48;i++)
            baseline.Record(i==1 ? float.NaN : 0,i==1 ? 0.0f : 0,0,
                i==2 ? "native_not_supported" : null);
        Check(baseline.Complete && baseline.Count==48 && baseline.ValidCount==46,
            "zero deformation is a valid native response while failures remain unknown");
        var output=baseline.Csv();
        var rows=output.Trim().Split('\n');
        Check(rows.Length==49 && DeformationCapture.Header.Split(',').Length==24 &&
            rows.Skip(1).All(r=>r.TrimEnd('\r').Split(',').Length==24),
            "48 bounded capture CSV rows with full vector and model bounds");
        Check(rows[1].Contains(",0,0,0,0,1,") &&
            output.Contains("\"native_not_supported\"") &&
            output.Contains(",0,\"invalid_vector\""),
            "CSV differentiates real zero vectors, explicit probe errors and invalid readings");
        Check(Math.Abs(baseline.Points[0].Y - bounds.Y(0.96f))<0.0001f,
            "front offsets scale with model dimensions");
        bool blocked=false;
        try {baseline.Record(0,0,0);}catch(InvalidOperationException){blocked=true;}
        Check(blocked,"capture cannot silently exceed 48 probes");

        Check(Settings("{\"version\":1,\"vehicleHud\":{\"mode\":\"minimal\"}}").VehicleHudMode == "minimal",
            "minimal vehicle HUD setting accepted");
        Check(Settings("{\"version\":1,\"vehicleHud\":{\"mode\":\"off\"}}").VehicleHudMode == "off",
            "HUD can be disabled independently from AI UI");
        Check(EnhancedSettings.Defaults(catalog).VehicleHudMode == "full",
            "HUD enabled by default for drivers");
        Check(SettingsError("{\"version\":1,\"vehicleHud\":{\"mode\":\"banana\"}}").Contains("vehicleHud.mode"),
            "invalid HUD mode fails closed");
    }
}
