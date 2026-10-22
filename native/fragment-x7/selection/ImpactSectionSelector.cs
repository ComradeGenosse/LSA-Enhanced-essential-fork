using System;

namespace Astra.X7
{
    // Pure geometry policy. No GTA handles, native calls, aiming coordinates or mutable lifecycle state.
    public static class ImpactSectionSelector
    {
        // Frozen sec1/walk5 dimensions from ../spec.py. U is sheet-centred; V starts at sheet bottom.
        public const double Width = 2.536;
        public const double SheetHeight = 2.131;
        public const int SectionCount = 5;
        public const double SectionWidth = Width / SectionCount;
        public const double MinimumNormalSpeed = 3.0;
        // Policy guard against remote/stale predictions, not a measured native timing guarantee.
        public const double MaximumHorizonSeconds = 0.250;

        public struct Selection
        {
            public readonly int FirstIndex;
            public readonly int SecondIndex;
            public readonly int Mask;
            public readonly double ImpactU;
            public readonly double ImpactV;
            public readonly double TimeToFaceSeconds;

            internal Selection(int firstIndex, double u, double v, double timeToFaceSeconds)
            {
                FirstIndex = firstIndex;
                SecondIndex = firstIndex + 1;
                Mask = (1 << FirstIndex) | (1 << SecondIndex);
                ImpactU = u;
                ImpactV = v;
                TimeToFaceSeconds = timeToFaceSeconds;
            }
        }

        // Indices are physical negative-U to positive-U positions, never x7SecLabs list offsets.
        // Two adjacent sections give a nominal 1.0144m opening. Collision/traversal still need GTA proof.
        public static bool TrySelect(double impactU, double impactV, out Selection selection)
        {
            return TrySelectAtTime(impactU, impactV, 0.0, out selection);
        }

        static bool TrySelectAtTime(double u, double v, double time, out Selection selection)
        {
            selection = default(Selection);
            if (!Finite(u) || !Finite(v) || u < -Width / 2 || u > Width / 2 ||
                v < 0 || v > SheetHeight) return false;

            // Nearest adjacent-pair midpoint; exact ties go to the lower physical index.
            // Explicit boundaries avoid round-off from subtracting nearly equal midpoint distances.
            int first = u <= -SectionWidth ? 0 : u <= 0 ? 1 : u <= SectionWidth ? 2 : 3;
            selection = new Selection(first, u, v, time);
            return true;
        }

        // Caller projects world position/velocity onto the current wall's U/T/V basis first.
        // T increases toward the target face; only the existing front-side approach is supported.
        // This linear estimate is valid only for a fresh, identified projectile sample. It neither
        // identifies a projectile nor proves the path is unobstructed. Latch the successful result
        // once at commit; never use later samples to resurrect or reconfigure a damaged fence.
        public static bool TryPredictAndSelect(double u, double t, double v,
            double velocityU, double velocityT, double velocityV, double faceT,
            double horizonSeconds, out Selection selection)
        {
            selection = default(Selection);
            if (!Finite(u) || !Finite(t) || !Finite(v) || !Finite(velocityU) ||
                !Finite(velocityT) || !Finite(velocityV) || !Finite(faceT) ||
                !Finite(horizonSeconds) || horizonSeconds <= 0 ||
                horizonSeconds > MaximumHorizonSeconds || velocityT <= MinimumNormalSpeed)
                return false;

            double distance = faceT - t;
            if (!Finite(distance) || distance < 0) return false;
            double time = distance / velocityT;
            if (!Finite(time) || time > horizonSeconds) return false;
            return TrySelectAtTime(u + velocityU * time, v + velocityV * time, time, out selection);
        }

        static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}
