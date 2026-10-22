using System;

namespace Astra.X7
{
    // Pure admission guard for a handle already present in the pre-fire projectile pool.
    // Handle membership alone is not provenance: SHVDN/native pools may recycle identities.
    // The GTA adapter must corroborate TWO post-fire samples before allowing the handle
    // into the unchanged impact selector. This is not a substitute for a weapon/owner ID.
    public static class ProjectileAdmissionPolicy
    {
        public struct Point3
        {
            public readonly double X, Y, Z;
            public Point3(double x, double y, double z) { X = x; Y = y; Z = z; }
            public static Point3 operator -(Point3 a, Point3 b)
            {
                return new Point3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
            }
        }

        const double MaximumProvenanceAgeMs = 1200.0; // ~2x observed RPG flight; not selector TTC
        const double MaximumCorridorErrorM = 0.65;
        const double MinimumForwardSpeed = 2.5;
        const double MinimumDirectionCosine = 0.70;
        const double MinimumObservedProgressM = 0.018;
        const int MaximumCorroborationFrames = 8;

        static bool Finite(double x)
        {
            return !double.IsNaN(x) && !double.IsInfinity(x);
        }
        static bool Finite(Point3 p) { return Finite(p.X) && Finite(p.Y) && Finite(p.Z); }
        static double Dot(Point3 a, Point3 b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
        static double Norm(Point3 a) { return Math.Sqrt(Dot(a, a)); }

        // Only launch-path evidence, NEVER aim-derived impact coordinates or section indices.
        public static bool TryLaunchFlight(Point3 source, Point3 target, Point3 position,
            Point3 velocity, double elapsedMs, out double progressM)
        {
            progressM = -1;
            if (!Finite(source) || !Finite(target) || !Finite(position) || !Finite(velocity) ||
                !Finite(elapsedMs) || elapsedMs < 0 || elapsedMs > MaximumProvenanceAgeMs)
                return false;
            Point3 route = target - source;
            double routeLength = Norm(route);
            if (!Finite(routeLength) || routeLength < 1.0 || routeLength > 30.0) return false;
            Point3 axis = new Point3(route.X / routeLength, route.Y / routeLength, route.Z / routeLength);
            Point3 displacement = position - source;
            double along = Dot(displacement, axis);
            if (!Finite(along) || along < -0.5 || along > routeLength + 0.5) return false;
            double sideSq = Dot(displacement, displacement) - along * along;
            if (!Finite(sideSq) || sideSq > MaximumCorridorErrorM * MaximumCorridorErrorM) return false;
            double speed = Norm(velocity), forward = Dot(velocity, axis);
            if (!Finite(speed) || !Finite(forward) || speed < MinimumForwardSpeed ||
                forward < MinimumForwardSpeed || forward / speed < MinimumDirectionCosine) return false;
            progressM = along;
            return true;
        }

        // Two distinct frames prove post-fire motion along the launcher axis, not
        // a single stationary baseline prop or a one-frame velocity artifact.
        public static bool Corroborates(Point3 source, Point3 target, Point3 first,
            Point3 next, int frameDelta)
        {
            if (!Finite(source) || !Finite(target) || !Finite(first) || !Finite(next) ||
                frameDelta < 1 || frameDelta > MaximumCorroborationFrames) return false;
            Point3 route = target - source;
            double length = Norm(route);
            if (!Finite(length) || length < 1.0 || length > 30.0) return false;
            Point3 delta = next - first;
            return Dot(delta, route) / length >= MinimumObservedProgressM;
        }
    }
}
