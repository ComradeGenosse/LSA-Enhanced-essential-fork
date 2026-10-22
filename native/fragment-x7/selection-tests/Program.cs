using System;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using Astra.X7;

static class Program
{
    static int assertions;
    static int tests;

    static void Main()
    {
        Run("frozen spec dimensions", FrozenDimensions);
        Run("observed profile examples", ProfileExamples);
        Run("pair ties and one-ULP neighbours", PairBoundaries);
        Run("float-origin coordinates keep strict bounds", FloatOriginCoordinates);
        Run("all section seams and sheet edges", SheetEdges);
        Run("reject sheet misses and empty top band", Misses);
        Run("reject nonfinite hit coordinates", InvalidHitNumbers);
        Run("oblique prediction uses intersection, not present U", ObliquePrediction);
        Run("normal direction and already-crossed rejection", Direction);
        Run("projection horizon and exact-face boundary", Horizon);
        Run("projected miss is rejected without clamping", ProjectedMisses);
        Run("reject every nonfinite projection input", InvalidPredictionNumbers);
        Run("overflow cannot select a section", Overflow);
        Run("dense independent nearest-pair oracle and determinism", DenseSweep);
        Run("projection invariant under T-origin translation", TranslatedFace);
        Run("baseline handle reuse: two-frame launch corridor proof", BaselineHandleReuse);
        Run("baseline guard rejects unrelated/stationary/reversed", BaselineRejectUnrelated);
        Run("baseline guard rejects stale/nonfinite/one-frame artifact", BaselineRejectInvalid);
        Console.WriteLine("PASS: " + tests + " deterministic tests, " + assertions + " assertions. No GTA/native calls.");
    }

    static void Run(string name, Action test)
    {
        test();
        tests++;
        Console.WriteLine("PASS " + name);
    }

    static void Check(bool condition, string message)
    {
        assertions++;
        if (!condition) throw new Exception(message);
    }

    static void Near(double actual, double expected, string message)
    {
        Check(Math.Abs(actual - expected) <= 1e-12, message + ": " + actual + " vs " + expected);
    }

    static ImpactSectionSelector.Selection Select(double u, double v = 0.8)
    {
        ImpactSectionSelector.Selection selection;
        Check(ImpactSectionSelector.TrySelect(u, v, out selection), "Expected accepted intersection " + u + ", " + v);
        return selection;
    }

    static void Pair(double u, int first, double v = 0.8)
    {
        ImpactSectionSelector.Selection selection = Select(u, v);
        Check(selection.FirstIndex == first && selection.SecondIndex == first + 1, "Wrong pair at U=" + u);
        Check(selection.Mask == (3 << first), "Wrong physical-position mask at U=" + u);
        Near(selection.ImpactU, u, "Intersection U retained");
        Near(selection.ImpactV, v, "Intersection V retained");
    }

    static bool Predict(double[] values, out ImpactSectionSelector.Selection selection)
    {
        return ImpactSectionSelector.TryPredictAndSelect(values[0], values[1], values[2],
            values[3], values[4], values[5], values[6], values[7], out selection);
    }

    static void FrozenDimensions()
    {
        DirectoryInfo folder = new DirectoryInfo(AppContext.BaseDirectory);
        while (folder != null && !File.Exists(Path.Combine(folder.FullName, "spec.py"))) folder = folder.Parent;
        Check(folder != null, "Could not locate committed fragment-x7/spec.py");
        string spec = File.ReadAllText(Path.Combine(folder.FullName, "spec.py"));
        Match dimensions = Regex.Match(spec, @"(?m)^W, H, SHEET_H, PITCH = ([0-9.]+), ([0-9.]+), ([0-9.]+),");
        Check(dimensions.Success, "Frozen dimension assignment changed; audit selector constants");
        Near(ImpactSectionSelector.Width, double.Parse(dimensions.Groups[1].Value, CultureInfo.InvariantCulture), "Width matches spec");
        Near(ImpactSectionSelector.SheetHeight, double.Parse(dimensions.Groups[3].Value, CultureInfo.InvariantCulture), "Sheet height matches spec");
        Match sections = Regex.Match(spec, @"(?m)^SECTIONS = ([0-9]+)");
        Check(sections.Success && ImpactSectionSelector.SectionCount == int.Parse(sections.Groups[1].Value, CultureInfo.InvariantCulture), "Section count matches spec");
        Near(2 * ImpactSectionSelector.SectionWidth, 1.0144, "Nominal two-strip width");
    }

    static void ProfileExamples()
    {
        Pair(-0.65, 0);
        Pair(0, 1);
        Pair(0.65, 3);
        Pair(0.25, 2);
    }

    static void PairBoundaries()
    {
        double width = ImpactSectionSelector.SectionWidth;
        Pair(-width, 0);
        Pair(Math.BitDecrement(-width), 0);
        Pair(Math.BitIncrement(-width), 1);
        Pair(0, 1);
        Pair(Math.BitDecrement(0.0), 1);
        Pair(Math.BitIncrement(0.0), 2);
        Pair(width, 2);
        Pair(Math.BitDecrement(width), 2);
        Pair(Math.BitIncrement(width), 3);
    }

    static void FloatOriginCoordinates()
    {
        // The GTA adapter supplies floats. Widening does not restore exact decimal edges/ties.
        // Remain fail-closed; do not introduce a broad tolerance that can turn misses into hits.
        Reject((double)(float)(ImpactSectionSelector.Width / 2), 0.8);
        Reject((double)(float)(-ImpactSectionSelector.Width / 2), 0.8);
        Reject(0, (double)(float)ImpactSectionSelector.SheetHeight);
        Pair((double)(float)ImpactSectionSelector.SectionWidth, 3);
        Pair((double)(float)(-ImpactSectionSelector.SectionWidth), 0);
    }

    static void SheetEdges()
    {
        Pair(-ImpactSectionSelector.Width / 2, 0, 0);
        Pair(ImpactSectionSelector.Width / 2, 3, ImpactSectionSelector.SheetHeight);
        for (int seam = 0; seam <= 5; seam++)
        {
            double u = -ImpactSectionSelector.Width / 2 + seam * ImpactSectionSelector.SectionWidth;
            ImpactSectionSelector.Selection selection = Select(u);
            Check(selection.FirstIndex >= 0 && selection.SecondIndex < 5, "Bounded pair at section seam");
            Check(selection.SecondIndex - selection.FirstIndex == 1, "Contiguous sections at seam");
        }
    }

    static void Reject(double u, double v)
    {
        ImpactSectionSelector.Selection selection;
        Check(!ImpactSectionSelector.TrySelect(u, v, out selection), "Expected rejected hit " + u + ", " + v);
        Check(selection.Mask == 0, "Failed selection has no armed mask");
    }

    static void Misses()
    {
        Reject(Math.BitDecrement(-ImpactSectionSelector.Width / 2), 0.8);
        Reject(Math.BitIncrement(ImpactSectionSelector.Width / 2), 0.8);
        Reject(0, Math.BitDecrement(0.0));
        Reject(0, Math.BitIncrement(ImpactSectionSelector.SheetHeight));
        Reject(0, 2.20); // Inside overall 2.351m asset bounds but above metal sheet.
        Reject(-4, 0.8);
        Reject(4, 0.8);
    }

    static void InvalidHitNumbers()
    {
        foreach (double invalid in new double[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
        {
            Reject(invalid, 0.8);
            Reject(0, invalid);
        }
    }

    static void ObliquePrediction()
    {
        ImpactSectionSelector.Selection selection;
        Check(Predict(new double[] { -0.65, -2, 1, 13, 20, -2, 0, 0.1 }, out selection), "Oblique impact accepted");
        Near(selection.ImpactU, 0.65, "Projected U crosses the fence");
        Near(selection.ImpactV, 0.8, "Projected vertical position");
        Near(selection.TimeToFaceSeconds, 0.1, "Projected face time");
        Check(selection.FirstIndex == 3 && selection.Mask == 24, "Uses projected right-side pair, not present left-side pair");
    }

    static void Direction()
    {
        ImpactSectionSelector.Selection selection;
        foreach (double speed in new double[] { -20, 0, 0.001, 3 })
            Check(!Predict(new double[] { 0, -1, 0.8, 0, speed, 0, 0, 0.1 }, out selection), "Reject receding/parallel/slow projectile");
        Check(Predict(new double[] { 0, -0.01, 0.8, 0, Math.BitIncrement(3), 0, 0, 0.1 }, out selection), "Speed strictly above threshold accepted");
        Check(!Predict(new double[] { 0, 0.001, 0.8, 0, 20, 0, 0, 0.1 }, out selection), "Already crossed face rejected");
    }

    static void Horizon()
    {
        ImpactSectionSelector.Selection selection;
        Check(Predict(new double[] { 0, -2, 0.8, 0, 20, 0, 0, 0.1 }, out selection), "Exact horizon accepted");
        Check(!Predict(new double[] { 0, -2, 0.8, 0, 20, 0, 0, Math.BitDecrement(0.1) }, out selection), "Beyond horizon rejected");
        Check(Predict(new double[] { 0, 0, 0.8, 0, 20, 0, 0, 0.1 }, out selection), "Exact face allowed by geometry; adapter must enforce early commit");
        Near(selection.TimeToFaceSeconds, 0, "Exact face has zero time");
        foreach (double horizon in new double[] { 0, -0.1, Math.BitIncrement(ImpactSectionSelector.MaximumHorizonSeconds) })
            Check(!Predict(new double[] { 0, -0.1, 0.8, 0, 20, 0, 0, horizon }, out selection), "Invalid horizon rejected");
        Check(Predict(new double[] { 0, -5, 0.8, 0, 20, 0, 0, 0.250 }, out selection), "Maximum policy horizon accepted");
    }

    static void ProjectedMisses()
    {
        ImpactSectionSelector.Selection selection;
        Check(!Predict(new double[] { 0, -2, 0.8, 20, 20, 0, 0, 0.1 }, out selection), "Projected side miss rejected");
        Check(!Predict(new double[] { 0, -2, 2.1, 0, 20, 2, 0, 0.1 }, out selection), "Projected top-band miss rejected");
        Check(!Predict(new double[] { 0, -2, 0.1, 0, 20, -2, 0, 0.1 }, out selection), "Projected ground miss rejected");
        Check(Predict(new double[] { -2, -2, 0.8, 20, 20, 0, 0, 0.1 }, out selection), "Present U outside sheet can project to a valid impact");
        Check(selection.FirstIndex == 1, "Projected centre chooses lower tied pair");
    }

    static void InvalidPredictionNumbers()
    {
        ImpactSectionSelector.Selection selection;
        for (int input = 0; input < 8; input++)
            foreach (double invalid in new double[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
            {
                double[] values = { 0, -1, 0.8, 0, 20, 0, 0, 0.1 };
                values[input] = invalid;
                Check(!Predict(values, out selection), "Reject nonfinite projection input " + input);
                Check(selection.Mask == 0, "Invalid projection produces empty mask");
            }
    }

    static void Overflow()
    {
        ImpactSectionSelector.Selection selection;
        Check(!Predict(new double[] { 0, -double.MaxValue, 0.8, 0, 20, 0, double.MaxValue, 0.1 }, out selection), "Overflowing distance rejected");
        Check(!Predict(new double[] { double.MaxValue, -1, 0.8, double.MaxValue, 20, 0, 0, 0.1 }, out selection), "Overflowing projected U rejected");
    }

    static void DenseSweep()
    {
        int previousFirst = -1;
        for (int i = 0; i <= 20000; i++)
        {
            double u = -ImpactSectionSelector.Width / 2 + ImpactSectionSelector.Width * i / 20000;
            ImpactSectionSelector.Selection selection = Select(u);
            Check(selection.FirstIndex >= previousFirst, "Pair selection monotonic across sheet");
            previousFirst = selection.FirstIndex;
            Check(selection.Mask == (3 << selection.FirstIndex), "Exactly two contiguous physical-position bits");
            ImpactSectionSelector.Selection repeat = Select(u);
            Check(selection.Mask == repeat.Mask && selection.ImpactU == repeat.ImpactU, "Repeated selection byte-value deterministic");

            // Independent midpoint-distance oracle away from exact tie boundaries (tested separately).
            if (Math.Abs(u) > 1e-12 && Math.Abs(Math.Abs(u) - ImpactSectionSelector.SectionWidth) > 1e-12)
            {
                int closest = -1;
                double bestDistance = double.PositiveInfinity;
                for (int first = 0; first < 4; first++)
                {
                    double midpoint = -ImpactSectionSelector.Width / 2 + (first + 1) * ImpactSectionSelector.SectionWidth;
                    double distance = Math.Abs(u - midpoint);
                    if (distance < bestDistance) { closest = first; bestDistance = distance; }
                }
                Check(selection.FirstIndex == closest, "Nearest adjacent-pair midpoint oracle");
            }
        }
    }

    static void TranslatedFace()
    {
        ImpactSectionSelector.Selection selection;
        Check(Predict(new double[] { -0.65, 98, 1, 13, 20, -2, 100, 0.1 }, out selection), "Translated local T origin accepted");
        Near(selection.ImpactU, 0.65, "T-origin translation leaves U selection unchanged");
        Check(selection.FirstIndex == 3, "Translated prediction picks same physical pair");
    }

    static ProjectileAdmissionPolicy.Point3 P(double x, double y, double z)
    {
        return new ProjectileAdmissionPolicy.Point3(x, y, z);
    }

    static void BaselineHandleReuse()
    {
        // A pre-fire handle can be recycled. The original position is not itself flight proof;
        // a plausible sample AND forward movement one frame later may make it eligible.
        var origin = P(0, 0, 0); var target = P(4, 0, 0);
        var first = P(.7, .1, .1); var next = P(.75, .1, .1);
        double along;
        Check(ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, first, P(5, 0, 0), 240, out along),
            "First frame in corridor should be considered only provisionally");
        Check(ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, next, P(6, .1, 0), 248, out along),
            "Second moving frame is flight-compatible");
        Check(ProjectileAdmissionPolicy.Corroborates(origin, target, first, next, 1),
            "Post-fire movement permits promotion of a recycled baseline handle");
        Check(!ProjectileAdmissionPolicy.Corroborates(origin, target, first, first, 1),
            "Single repeated stationary sample is not corroboration");
    }

    static void BaselineRejectUnrelated()
    {
        var origin = P(0, 0, 0); var target = P(4, 0, 0);
        double along;
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(6, 0, 0), P(5, 0, 0), 200, out along),
            "Projectile too far beyond target");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 2, 0), P(5, 0, 0), 200, out along),
            "Lateral unrelated projectile");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 0, 0), P(0, 0, 0), 200, out along),
            "Stationary baseline object");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 0, 0), P(-5, 0, 0), 200, out along),
            "Reverse flight");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 0, 0), P(5, 5, 0), 200, out along),
            "Unrelated oblique flight");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 0, 0), P(1, 0, 0), 200, out along),
            "Too slow to establish provenance");
    }

    static void BaselineRejectInvalid()
    {
        var origin = P(0, 0, 0); var target = P(4, 0, 0);
        double along;
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 0, 0), P(5, 0, 0), 1201, out along),
            "Object first moving after rocket-flight window stays excluded");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 0, 0), P(5, 0, 0), -1, out along),
            "Pre-shot observation excluded");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(double.NaN, 0, 0), P(5, 0, 0), 100, out along),
            "Nonfinite position excluded");
        Check(!ProjectileAdmissionPolicy.TryLaunchFlight(origin, target, P(1, 0, 0), P(double.PositiveInfinity, 0, 0), 100, out along),
            "Nonfinite velocity excluded");
        Check(!ProjectileAdmissionPolicy.Corroborates(origin, target, P(.7, 0, 0), P(.71, 0, 0), 1),
            "Sub-threshold displacement not enough");
        Check(!ProjectileAdmissionPolicy.Corroborates(origin, target, P(.7, 0, 0), P(.75, 0, 0), 9),
            "Non-consecutive stale samples not enough");
        Check(!ProjectileAdmissionPolicy.Corroborates(origin, target, P(.7, 0, 0), P(.75, 0, 0), 0),
            "Same-frame artifact not enough");
    }
}
