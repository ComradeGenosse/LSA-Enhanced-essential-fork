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
