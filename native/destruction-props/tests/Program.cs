using System;
using Astra.X8;

internal static class X8Tests
{
    static int n;
    static void Check(bool value, string message) { n++; if (!value) throw new Exception(message); }
    static void Throws(Action action, string message)
    {
        n++;
        try { action(); } catch (InvalidOperationException) { return; }
        catch (ArgumentException) { return; }
        throw new Exception("Expected rejection: " + message);
    }
    static Placement P(string id, double x, double yaw = 0)
        => new Placement(id, 1, 1185366416, x, 0, 35, yaw, 1, 1);
    static void Main()
    {
        Registry r = new Registry();
        r.Register(P("A", 0)); r.Register(P("B", 20, 90));
        Check(r.Count == 2 && r.Get("A").Phase == FencePhase.Registered, "catalog");
        Throws(() => r.Register(P("A", 40)), "duplicate");
        Throws(() => r.Register(P("C", 50)), "capacity");
        Throws(() => new Registry().Register(P("bad id", 0)), "id");
        Throws(() => new Registry().Register(new Placement("X", 2, 1185366416, 0,0,0,0,1,1)), "revision");
        Throws(() => new Registry().Register(new Placement("X", 1, 7, 0,0,0,0,1,1)), "model");
        Throws(() => new Registry().Register(new Placement("X", 1, 1185366416, double.NaN,0,0,0,1,1)), "nonfinite");
        Throws(() => new Registry().Register(new Placement("X", 1, 1185366416, 0,0,0,0,1.1,1)), "scale");
        Throws(() => new Registry().Register(new Placement("X", 1, 1185366416, 0,0,0,0,1,.90)), "tilt");
        Throws(() => new Registry().Register(new Placement("X", 1, 1185366416, 0,0,0,360,1,1)), "yaw");
        Registry close = new Registry(); close.Register(P("A",0));
        Throws(() => close.Register(P("B", 2)), "hide overlap");
        Check(P("X", 2, 359).Matches(2,0,35, 1), "wraparound heading");
        Check(!P("X", 2, 90).Matches(2,0,35, 180), "orientation must match");
        Check(!P("X", 2).Matches(2.06,0,35,0), "strict pivot");
        foreach (double yaw in new [] {0.0, 90, 180, 37})
        {
            double[] low = P("A", 0, yaw).SyntheticSectionOrigin(0, .5);
            double[] mid = P("A", 0, yaw).SyntheticSectionOrigin(2, .5);
            double[] high = P("A", 0, yaw).SyntheticSectionOrigin(4, .5);
            Check(Math.Abs((low[0] + high[0])/2 - mid[0]) < 1e-10, "section symmetry x");
            Check(Math.Abs((low[1] + high[1])/2 - mid[1]) < 1e-10, "section symmetry y");
        }
        Throws(() => P("X",0).SyntheticSectionOrigin(5,.5), "physical bounds");
        r.Begin("A");
        Check(r.LeaseId == "A" && r.Get("A").Phase == FencePhase.Preparing, "prepare A");
        Throws(() => r.Begin("B"), "B cannot prepare concurrently");
        Throws(() => r.Armed("A", 9, 4, 5), "partial ownership");
        r.Armed("A", 9, 5, 5);
        Check(r.Get("B").Phase == FencePhase.Registered, "B unaffected");
        r.Active("A");
        Throws(() => r.Active("A"), "no repeat damage");
        r.Restore("A", true);
        Throws(() => r.Restored("A", false, true), "unknown restoration must latch");
        Check(r.LeaseId == "A" && r.Get("A").HideIntent, "retain hide intent");
        Throws(() => r.Begin("B"), "B blocked on restore pending");
        r.Restored("A", true, true);
        Check(r.LeaseId == null && r.Get("B").Phase == FencePhase.Registered, "A restore doesn't touch B");
        r.Begin("B");
        r.Armed("B", 19, 5, 5);
        r.Restore("B", false);
        r.Restored("B", true, true);
        Check(r.Get("A").Phase == FencePhase.Registered, "B restore doesn't touch A");
        r.Begin("A"); Throws(() => r.FailedPreparation("A", false, true), "bad original");
        Check(r.Get("A").Phase == FencePhase.RestorePending, "failure latches");
        Throws(() => r.FailedPreparation("A", true, true), "no double cleanup");
        r.Restored("A", true, true);
        Check(r.LeaseId == null, "reconciled");
        Console.WriteLine("PASS X8 pure catalog and lifecycle: " + n + " checks (not GTA)");
    }
}
