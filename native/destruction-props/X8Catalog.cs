using System;
using System.Collections.Generic;

namespace Astra.X8
{
    // X8/v1: no GTA dependency, no persistence or global discovery. A second catalog
    // entry is NOT a second loaded native twin: host deliberately leases one at a time.
    public enum FencePhase { Registered, Preparing, Armed, Active, RestorePending }

    public sealed class Placement
    {
        public readonly string Id;
        public readonly int Revision, ModelHash;
        public readonly double X, Y, Z, HeadingDegrees, Scale, UpDot;
        public Placement(string id, int revision, int modelHash, double x, double y,
            double z, double headingDegrees, double scale, double upDot)
        {
            Id = id; Revision = revision; ModelHash = modelHash; X = x; Y = y;
            Z = z; HeadingDegrees = headingDegrees; Scale = scale; UpDot = upDot;
        }
        static bool Finite(double n) { return !double.IsNaN(n) && !double.IsInfinity(n); }
        public void Validate()
        {
            if (string.IsNullOrEmpty(Id) || Id.Length > 32) throw new ArgumentException("x8_bad_id");
            foreach (char c in Id)
                if (!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z') &&
                    !(c >= '0' && c <= '9') && c != '_' && c != '-')
                    throw new ArgumentException("x8_bad_id");
            if (Revision != 1 || ModelHash != 1185366416)
                throw new ArgumentException("x8_unknown_family_or_revision");
            if (!Finite(X) || !Finite(Y) || !Finite(Z) || !Finite(HeadingDegrees) ||
                !Finite(Scale) || !Finite(UpDot)) throw new ArgumentException("x8_nonfinite");
            if (Scale != 1.0 || UpDot < 0.985 || UpDot > 1.000001)
                throw new ArgumentException("x8_not_upright_unit_scale");
            if (HeadingDegrees < 0 || HeadingDegrees >= 360)
                throw new ArgumentException("x8_bad_heading");
        }
        public double DistanceTo(Placement other)
        {
            double dx = X - other.X, dy = Y - other.Y, dz = Z - other.Z;
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }
        public bool Matches(double x, double y, double z, double heading)
        {
            if (!Finite(x) || !Finite(y) || !Finite(z) || !Finite(heading)) return false;
            double dx = x - X, dy = y - Y, dz = z - Z;
            double d = Math.Abs(((heading - HeadingDegrees + 540) % 360) - 180);
            return dx * dx + dy * dy + dz * dz <= 0.05 * 0.05 && d <= 2.0;
        }
        // Synthetic pure fixture. Runtime native RightVector controls actual section origins.
        public double[] SyntheticSectionOrigin(int physicalIndex, double width)
        {
            if (physicalIndex < 0 || physicalIndex > 4 || !Finite(width) || width <= 0)
                throw new ArgumentException("x8_bad_section");
            double angle = HeadingDegrees * Math.PI / 180;
            double offset = (physicalIndex - 2) * width;
            return new double[] { X + Math.Cos(angle) * offset,
                Y + Math.Sin(angle) * offset, Z };
        }
    }

    public sealed class Slot
    {
        public readonly Placement Site;
        public FencePhase Phase { get; internal set; }
        public int CandidateHandle { get; internal set; }
        public int OwnedRootCount { get; internal set; }
        public int OwnedAnchorCount { get; internal set; }
        public bool HideIntent { get; internal set; }
        public Slot(Placement site) { Site = site; Phase = FencePhase.Registered; }
    }

    public sealed class Registry
    {
        readonly Dictionary<string, Slot> slots = new Dictionary<string, Slot>(StringComparer.Ordinal);
        public string LeaseId { get; private set; }
        public int Count { get { return slots.Count; } }
        public IEnumerable<Slot> Slots { get { return slots.Values; } }
        public Slot Get(string id)
        {
            Slot s;
            if (!slots.TryGetValue(id ?? "", out s)) throw new InvalidOperationException("x8_unknown_placement");
            return s;
        }
        public void Register(Placement site)
        {
            if (site == null) throw new ArgumentNullException("site");
            site.Validate();
            if (slots.ContainsKey(site.Id)) throw new InvalidOperationException("x8_duplicate_id");
            if (slots.Count >= 2) throw new InvalidOperationException("x8_capacity_two");
            foreach (Slot other in slots.Values)
                if (site.DistanceTo(other.Site) < 6.0)
                    throw new InvalidOperationException("x8_placements_too_close");
            slots.Add(site.Id, new Slot(site));
        }
        public Slot Begin(string id)
        {
            Slot s = Get(id);
            if (LeaseId != null || s.Phase != FencePhase.Registered)
                throw new InvalidOperationException("x8_one_live_instance_only");
            LeaseId = id; s.Phase = FencePhase.Preparing; return s;
        }
        void RequireOwner(string id, FencePhase expected)
        {
            if (LeaseId != id || Get(id).Phase != expected)
                throw new InvalidOperationException("x8_wrong_owner_or_phase");
        }
        public void Armed(string id, int candidateHandle, int roots, int anchors)
        {
            RequireOwner(id, FencePhase.Preparing);
            if (candidateHandle <= 0 || roots != 5 || anchors != 5)
                throw new InvalidOperationException("x8_invalid_staged_ownership");
            Slot s = Get(id); s.CandidateHandle = candidateHandle;
            s.OwnedRootCount = roots; s.OwnedAnchorCount = anchors;
            s.Phase = FencePhase.Armed;
        }
        public void Active(string id)
        {
            RequireOwner(id, FencePhase.Armed);
            Get(id).Phase = FencePhase.Active;
        }
        public void Restore(string id, bool hideIntent)
        {
            if (LeaseId != id) throw new InvalidOperationException("x8_wrong_restore_owner");
            Slot s = Get(id); s.Phase = FencePhase.RestorePending;
            s.HideIntent = hideIntent;
        }
        public void Restored(string id, bool nineOfNineAndVisible, bool ownedRemoved)
        {
            RequireOwner(id, FencePhase.RestorePending);
            if (!nineOfNineAndVisible || !ownedRemoved)
                throw new InvalidOperationException("x8_restore_unverified");
            Slot s = Get(id); s.Phase = FencePhase.Registered;
            s.CandidateHandle = 0; s.OwnedRootCount = 0; s.OwnedAnchorCount = 0;
            s.HideIntent = false; LeaseId = null;
        }
        // Failed staging may only release its lease if no native ownership/hide remains
        // AND the original world collision was actually verified. Never infer this from files.
        public void FailedPreparation(string id, bool originalVerified, bool noOwnedOrHide)
        {
            RequireOwner(id, FencePhase.Preparing);
            Restore(id, false);
            Restored(id, originalVerified, noOwnedOrHide);
        }
    }
}
