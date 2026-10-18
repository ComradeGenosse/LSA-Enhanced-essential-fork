using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Intelligence.M9
{
    // One owner-fiber read of the local player's state. A null field is UNKNOWN
    // (the native read was unavailable or failed); it is never defaulted to a
    // negative. Produced by IntelligenceIntegration only after real GTA reads.
    public sealed class M9StateRead
    {
        public string PlayerCaptureRef, VehicleCaptureRef;
        public int? WantedLevel;
        public bool? Airborne, Grounded, InWater, Submerged;
        public double? RollDegrees, SpeedKph;
        // null = unknown. Edges are only formed from a prior KNOWN false.
        public bool? PlayerDead, PlayerBeingArrested;
        // Staged by M9OriginalVehicleCollisionProducer.TryTake on this tick.
        public M9CollisionEvidence Collision;
        // The glue sets these only when the matching native reads succeeded in
        // THIS owner-fiber pass (consumed by the unchanged M9NativeFrameAdapter).
        public bool BaseVerified, MotionVerified, WantedVerified;
    }

    // Pure, GTA-free state sampler: validates a read through the unchanged
    // M9NativeFrameAdapter, mints exactly-once Wasted/Busted receipts at the
    // first KNOWN edge, decides when source-time witness geometry is worth
    // spending and shapes the strict `m9_sample` wire payload. It performs no
    // native call, creates no event/memory/PS2 claim and never sends anything.
    public sealed class M9StateSampler
    {
        public const int MaxWitnesses = 8;
        // Superset of the JS classifier's 140 degree rollover edge: witness
        // geometry is only spent when a classifiable change may be present.
        public const double RollWitnessDegrees = 120;
        readonly M9NativeFrameAdapter adapter;
        readonly Func<string> nativeRun, hostRun;
        readonly Func<long> worldEpoch;
        readonly HashSet<string> issuedTerminal = new HashSet<string>();
        readonly HashSet<string> issuedCollisions = new HashSet<string>();
        // A receipt id is spendable once per run, even if a caller re-presents it.
        readonly Queue<string> consumedOrder = new Queue<string>();
        readonly HashSet<string> consumed = new HashSet<string>();
        const int MaxConsumed = 512;
        bool curBase, curMotion, curWanted;
        bool? prevDead, prevArrested, prevAirborne, prevGrounded, prevWater, prevSubmerged;
        int? prevWanted;
        double? prevRoll;
        bool prevInterest, havePrev;
        // Send a bounded verified quiet-state sample when on foot so callbacks
        // can check fresh native wanted/combat evidence. No witness LOS work.
        // The sampler is still absent from default builds and remains opt-in.
        const long IdleHeartbeatMs = 1000;
        long lastIdleSampleAtMs = -1;
        public long Built, Rejected, Terminals, Candidates, Skipped, CollisionsRefused;

        public M9StateSampler(EntityAnchors anchors, Func<string> nativeRun, Func<string> hostRun, Func<long> worldEpoch)
        {
            if (anchors == null || nativeRun == null || hostRun == null || worldEpoch == null)
                throw new ArgumentNullException();
            this.nativeRun = nativeRun; this.hostRun = hostRun; this.worldEpoch = worldEpoch;
            adapter = new M9NativeFrameAdapter(anchors,
                r => curBase,
                (r, field) => field == "vehicle_motion" ? curMotion : field == "wanted_level" && curWanted,
                // Single use: only a receipt this sampler was handed this pass.
                c => issuedCollisions.Remove(c.nativeReceiptId),
                t => issuedTerminal.Remove(t.nativeReceiptId),
                nativeRun, hostRun, worldEpoch);
        }

        // World/epoch/connection change: baselines and unspent receipts are
        // discarded so a new world never forms an edge from an old sample.
        public void Reset()
        {
            issuedTerminal.Clear(); issuedCollisions.Clear();
            prevDead = prevArrested = prevAirborne = prevGrounded = prevWater = prevSubmerged = null;
            prevWanted = null; prevRoll = null; prevInterest = false; havePrev = false;
            lastIdleSampleAtMs = -1;
        }

        static bool Uuid(string value)
        {
            Guid id;
            return value != null && Guid.TryParseExact(value, "D", out id) && id != Guid.Empty;
        }

        static bool Changed<T>(T? before, T? now) where T : struct => before.HasValue && now.HasValue && !before.Value.Equals(now.Value);

        static string Terminal(bool? previous, bool? now) => previous == false && now == true ? "edge" : null;

        // Returns the m9_sample payload, or null when nothing is worth sending
        // (idle on foot, rejected read, or a read that failed adapter proof).
        public Dictionary<string, object> Build(M9StateRead s, uint tick, long nowMs,
            Func<List<WitnessReceipt>> witnessesAtTick, bool force = false)
        {
            if (s == null) { Skipped++; return null; }
            string kind = null;
            if (Terminal(prevDead, s.PlayerDead) != null) kind = "wasted";
            else if (Terminal(prevArrested, s.PlayerBeingArrested) != null) kind = "busted";
            bool interest = s.VehicleCaptureRef != null || (s.WantedLevel ?? 0) > 0 ||
                s.PlayerDead == true || s.PlayerBeingArrested == true;
            // Only a change between two KNOWN values is an edge; unknown->known is not.
            bool wantedChanged = Changed(prevWanted, s.WantedLevel);
            bool motionChanged = Changed(prevAirborne, s.Airborne) || Changed(prevGrounded, s.Grounded) ||
                Changed(prevWater, s.InWater) || Changed(prevSubmerged, s.Submerged);
            bool rollNear = (s.RollDegrees ?? 0) >= RollWitnessDegrees || (prevRoll ?? 0) >= RollWitnessDegrees;
            bool candidate = kind != null || s.Collision != null || wantedChanged || motionChanged || rollNear;
            bool trailing = prevInterest && !interest;
            prevDead = s.PlayerDead; prevArrested = s.PlayerBeingArrested; prevWanted = s.WantedLevel;
            prevAirborne = s.Airborne; prevGrounded = s.Grounded; prevWater = s.InWater;
            prevSubmerged = s.Submerged; prevRoll = s.RollDegrees; prevInterest = interest; havePrev = true;
            bool idleHeartbeat = !interest && !trailing && !force && kind == null && s.Collision == null;
            if (idleHeartbeat && lastIdleSampleAtMs >= 0 &&
                nowMs >= lastIdleSampleAtMs && nowMs - lastIdleSampleAtMs < IdleHeartbeatMs)
            { Skipped++; return null; }
            if (!Uuid(s.PlayerCaptureRef)) { Rejected++; return null; }

            M9CollisionEvidence collision = null;
            if (s.Collision != null)
            {
                collision = s.Collision;
                // The wire contract carries one receipt per sample; the adapter
                // verifies it against the live player/vehicle anchors.
                if (consumed.Contains(collision.nativeReceiptId)) { collision = null; CollisionsRefused++; }
                else
                {
                    issuedCollisions.Add(collision.nativeReceiptId);
                    consumed.Add(collision.nativeReceiptId); consumedOrder.Enqueue(collision.nativeReceiptId);
                    while (consumedOrder.Count > MaxConsumed) consumed.Remove(consumedOrder.Dequeue());
                }
            }
            M9TerminalReceipt terminal = null;
            if (kind != null)
            {
                terminal = new M9TerminalReceipt
                {
                    kind = kind,
                    nativeReceiptId = Guid.NewGuid().ToString("D"),
                    playerCaptureRef = s.PlayerCaptureRef,
                    gameTick = tick,
                    sampledAtMs = nowMs
                };
                issuedTerminal.Add(terminal.nativeReceiptId);
                Terminals++;
            }
            curBase = s.BaseVerified; curMotion = s.MotionVerified; curWanted = s.WantedVerified;
            M9NativeFrame frame;
            bool ok = adapter.TryBuild(new M9RawNativeRead
            {
                nativeRun = nativeRun(), hostRunId = hostRun(), worldEpoch = worldEpoch(),
                playerCaptureRef = s.PlayerCaptureRef, vehicleCaptureRef = s.VehicleCaptureRef,
                sampledAtMs = nowMs, gameTick = tick, wantedLevel = s.WantedLevel,
                airborne = s.Airborne, grounded = s.Grounded, inWater = s.InWater, submerged = s.Submerged,
                rollDegrees = s.RollDegrees, speedKph = s.SpeedKph, collision = collision, terminal = terminal
            }, nowMs, out frame);
            curBase = curMotion = curWanted = false;
            // Whatever the adapter did not consume stays unspendable.
            if (collision != null) issuedCollisions.Remove(collision.nativeReceiptId);
            if (terminal != null) issuedTerminal.Remove(terminal.nativeReceiptId);
            if (!ok || frame == null || frame.worldEpoch <= 0 || frame.worldEpoch > int.MaxValue) { Rejected++; return null; }
            if (idleHeartbeat) lastIdleSampleAtMs = nowMs;

            var witnesses = new List<object>();
            var seen = new HashSet<string>();
            if (candidate && witnessesAtTick != null)
            {
                Candidates++;
                List<WitnessReceipt> receipts = null;
                try { receipts = witnessesAtTick(); } catch { }
                if (receipts != null)
                    foreach (var w in receipts)
                    {
                        // Only same-tick, positive, channel-proven receipts. Absence of a
                        // receipt is unknown; this class never emits a negative.
                        if (w == null || w.Status != "witnessed" || w.SampledGameTick != tick ||
                            !Uuid(w.Observer) || w.Observer == frame.playerCaptureRef ||
                            w.Channel == null || w.Basis == null) continue;
                        if (witnesses.Count >= MaxWitnesses) break;
                        if (!seen.Add(w.Observer)) continue;
                        witnesses.Add(new Dictionary<string, object>
                        {
                            { "observer", new Dictionary<string, object> { { "captureRef", w.Observer }, { "kind", "ped" } } },
                            { "sampledGameTick", w.SampledGameTick },
                            { "status", w.Status },
                            { "reason", w.Reason },
                            { "knowsSource", w.KnowsSource },
                            { "knowsTarget", w.KnowsTarget },
                            { "evidence", new Dictionary<string, object> {
                                { "channel", w.Channel }, { "basis", w.Basis }, { "sampledGameTick", w.SampledGameTick } } }
                        });
                    }
            }
            Built++;
            var v = frame.vehicle;
            object vehicle = null;
            if (v != null)
            {
                object col = null;
                if (v.collision != null)
                    col = new Dictionary<string, object>
                    {
                        { "nativeReceiptId", v.collision.nativeReceiptId },
                        { "sourceType", "damage_tracker_vehicle_collision" },
                        { "damage", v.collision.damage }
                    };
                else if (collision != null) CollisionsRefused++; // adapter refused: stays unknown
                vehicle = new Dictionary<string, object>
                {
                    { "airborne", v.airborne }, { "inWater", v.inWater }, { "submerged", v.submerged },
                    { "grounded", v.grounded }, { "rollDegrees", v.rollDegrees }, { "speedKph", v.speedKph },
                    { "collision", col }
                };
            }
            object outcome = null;
            if (frame.outcome != null)
                outcome = new Dictionary<string, object>
                {
                    { "kind", frame.outcome.kind }, { "nativeReceiptId", frame.outcome.nativeReceiptId }
                };
            return new Dictionary<string, object>
            {
                { "m9SampleVersion", 1 },
                { "hostRunId", frame.hostRunId },
                { "worldEpoch", (int)frame.worldEpoch },
                { "sampledGameTick", frame.gameTick },
                { "ageMs", 0 },
                { "playerCaptureRef", frame.playerCaptureRef },
                { "vehicleCaptureRef", frame.vehicleCaptureRef },
                { "wantedLevel", frame.wantedLevel },
                { "vehicle", vehicle },
                { "outcome", outcome },
                { "witnessReceipts", witnesses }
            };
        }
    }
}
