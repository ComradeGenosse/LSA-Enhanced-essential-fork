using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Script.Serialization;
using LSA.Intelligence;
using LSA.Intelligence.M9;

// Portable (not GTA) assertions for the default-off M9 state sampler. It only
// proves the pure staging/receipt/witness/wire logic; every GTA native read in
// IntelligenceIntegration.M9.cs remains unverified until the in-game checklist.
internal static class M9SamplerTests
{
    static readonly string NativeRun = Guid.NewGuid().ToString("D");
    static readonly string HostRun = "11111111-1111-4111-8111-111111111111";

    sealed class Fixture
    {
        public EntityAnchors Anchors = new EntityAnchors();
        public EntityAnchor Player, Vehicle;
        public long Epoch = 3;
        public M9StateSampler Sampler;
        public int WitnessCalls;
        public Fixture()
        {
            Player = Anchors.Retain(new object(), 13, new IntPtr(102), "player", null, () => true, 100);
            Vehicle = Anchors.Retain(new object(), 12, new IntPtr(101), "vehicle", null, () => true, 100);
            Sampler = new M9StateSampler(Anchors, () => NativeRun, () => HostRun, () => Epoch);
        }
        public M9StateRead Drive(Action<M9StateRead> edit = null)
        {
            var read = new M9StateRead
            {
                PlayerCaptureRef = Player.CaptureRef, VehicleCaptureRef = Vehicle.CaptureRef,
                WantedLevel = 0, Airborne = false, Grounded = true, InWater = false, Submerged = false,
                RollDegrees = 0, SpeedKph = 60, PlayerDead = false, PlayerBeingArrested = false,
                BaseVerified = true, MotionVerified = true, WantedVerified = true
            };
            edit?.Invoke(read);
            return read;
        }
        public M9StateRead Foot(Action<M9StateRead> edit = null)
        {
            var read = new M9StateRead
            {
                PlayerCaptureRef = Player.CaptureRef, WantedLevel = 0, PlayerDead = false,
                PlayerBeingArrested = false, BaseVerified = true, WantedVerified = true
            };
            edit?.Invoke(read);
            return read;
        }
        public M9CollisionEvidence Collision(uint tick, long at, int damage = 60, string vehicleRef = null) =>
            new M9CollisionEvidence
            {
                nativeReceiptId = Guid.NewGuid().ToString("D"), damage = damage,
                vehicleCaptureRef = vehicleRef ?? Vehicle.CaptureRef, playerCaptureRef = Player.CaptureRef,
                gameTick = tick, sampledAtMs = at
            };
        public Func<List<WitnessReceipt>> Witnesses(uint tick, params WitnessReceipt[] extra) => () =>
        {
            WitnessCalls++;
            return new List<WitnessReceipt>(extra);
        };
        public static WitnessReceipt Seen(uint tick, string observer = null, string status = "witnessed") =>
            new WitnessReceipt
            {
                Observer = observer ?? Guid.NewGuid().ToString("D"), SampledGameTick = tick, Status = status,
                Reason = "visual_clear", Channel = "visual", Basis = "sampled_state"
            };
    }

    static object Get(Dictionary<string, object> d, params string[] path)
    {
        object cur = d;
        foreach (var key in path)
        {
            var map = cur as Dictionary<string, object>;
            if (map == null || !map.ContainsKey(key)) return null;
            cur = map[key];
        }
        return cur;
    }

    public static List<string> WireFrames = new List<string>();

    public static void Run(Action<bool, string> check)
    {
        var json = new JavaScriptSerializer { MaxJsonLength = 8192, RecursionLimit = 8 };
        // 1. Idle on foot sends nothing and spends no witness geometry.
        var f = new Fixture();
        check(f.Sampler.Build(f.Foot(), 1000, 1000, f.Witnesses(1000)) == null, "idle foot sample is skipped");
        check(f.WitnessCalls == 0, "no witness geometry spent while idle");

        // 2. Plain driving sample: strict wire shape, nothing invented.
        var payload = f.Sampler.Build(f.Drive(), 1100, 1100, f.Witnesses(1100));
        check(payload != null, "driving sample built");
        check((int)payload["m9SampleVersion"] == 1 && (string)payload["hostRunId"] == HostRun, "wire version and host run");
        check((int)payload["worldEpoch"] == 3 && (uint)payload["sampledGameTick"] == 1100, "wire epoch and tick");
        check((string)payload["playerCaptureRef"] == f.Player.CaptureRef && (string)payload["vehicleCaptureRef"] == f.Vehicle.CaptureRef, "anchored refs");
        check(Get(payload, "vehicle", "collision") == null && payload["outcome"] == null, "no collision/outcome claimed");
        check(((List<object>)payload["witnessReceipts"]).Count == 0 && f.WitnessCalls == 0, "plain driving has no witnesses");
        var keys = new HashSet<string>(payload.Keys);
        check(keys.SetEquals(new[] { "m9SampleVersion", "hostRunId", "worldEpoch", "sampledGameTick", "ageMs", "playerCaptureRef",
            "vehicleCaptureRef", "wantedLevel", "vehicle", "outcome", "witnessReceipts" }), "exact top-level keys");

        // 3. Collision: receipt travels once, witnesses only at the sample tick.
        var good = Fixture.Seen(1200);
        var late = Fixture.Seen(1199);
        var negative = Fixture.Seen(1200, null, "did_not_witness");
        var self = Fixture.Seen(1200, f.Player.CaptureRef);
        var collision = f.Collision(1200, 1190);
        payload = f.Sampler.Build(f.Drive(r => r.Collision = collision), 1200, 1200, f.Witnesses(1200, good, late, negative, self));
        check(payload != null && f.WitnessCalls == 1, "collision sample spends witness geometry once");
        check((string)Get(payload, "vehicle", "collision", "nativeReceiptId") == collision.nativeReceiptId, "collision receipt id preserved");
        check((int)Get(payload, "vehicle", "collision", "damage") == 60 &&
              (string)Get(payload, "vehicle", "collision", "sourceType") == "damage_tracker_vehicle_collision", "damage tracker source type");
        var witnesses = (List<object>)payload["witnessReceipts"];
        check(witnesses.Count == 1 && (string)Get((Dictionary<string, object>)witnesses[0], "observer", "captureRef") == good.Observer,
            "only the positive same-tick receipt survives");
        WireFrames.Add(json.Serialize(payload));

        // 4. Re-presenting the same receipt later is refused (single use).
        payload = f.Sampler.Build(f.Drive(r => r.Collision = collision), 1300, 1300, f.Witnesses(1300));
        check(payload != null && Get(payload, "vehicle", "collision") == null && f.Sampler.CollisionsRefused >= 1, "receipt cannot be spent twice");

        // 5. Collision naming a different vehicle, or an old tick, stays unknown.
        var other = f.Anchors.Retain(new object(), 99, new IntPtr(555), "vehicle", null, () => true, 100);
        payload = f.Sampler.Build(f.Drive(r => r.Collision = f.Collision(1400, 1400, 60, other.CaptureRef)), 1400, 1400, f.Witnesses(1400));
        check(payload != null && Get(payload, "vehicle", "collision") == null, "collision on another vehicle refused");
        payload = f.Sampler.Build(f.Drive(r => r.Collision = f.Collision(1390, 1400)), 1500, 1500, f.Witnesses(1500));
        check(payload != null && Get(payload, "vehicle", "collision") == null, "collision tick must equal sample tick");
        payload = f.Sampler.Build(f.Drive(r => r.Collision = f.Collision(1600, 1600, 20)), 1600, 1600, f.Witnesses(1600));
        check(payload != null && Get(payload, "vehicle", "collision") == null, "minor impact below damage floor refused");

        // 6. Unverified motion/wanted reads are unknown, never defaulted.
        payload = f.Sampler.Build(f.Drive(r => { r.MotionVerified = false; r.WantedVerified = false; }), 1700, 1700, f.Witnesses(1700));
        check(payload != null && payload["wantedLevel"] == null && Get(payload, "vehicle", "airborne") == null &&
              Get(payload, "vehicle", "rollDegrees") == null, "unverified native fields stay null");
        payload = f.Sampler.Build(f.Drive(r => { r.RollDegrees = double.NaN; }), 1800, 1800, f.Witnesses(1800));
        check(payload != null && Get(payload, "vehicle", "rollDegrees") == null, "non-finite roll never becomes a value");

        // 7. On-foot quiet-state heartbeat stays source-verified, slow, and
        // does not ask for witness geometry. Needed for M9 callback priority
        // after a remembered event when the player leaves the vehicle.
        var idle = new Fixture();
        var firstIdle = idle.Sampler.Build(idle.Foot(), 100, 100, idle.Witnesses(100));
        check(firstIdle != null && firstIdle["vehicleCaptureRef"] == null &&
              (int)firstIdle["wantedLevel"] == 0 &&
              ((List<object>)firstIdle["witnessReceipts"]).Count == 0 &&
              idle.WitnessCalls == 0, "on-foot idle heartbeat is measured and witness-free");
        check(idle.Sampler.Build(idle.Foot(), 400, 400, idle.Witnesses(400)) == null,
              "on-foot quiet-state cadence is bounded");
        var nextIdle = idle.Sampler.Build(idle.Foot(), 1200, 1200, idle.Witnesses(1200));
        check(nextIdle != null && (int)nextIdle["wantedLevel"] == 0 && idle.WitnessCalls == 0,
              "on-foot idle heartbeat stays fresh without LOS checks");
        WireFrames.Add(json.Serialize(nextIdle));

        // 8. Wasted/busted: first KNOWN false->true edge only, exactly once.
        var t = new Fixture();
        check(t.Sampler.Build(t.Foot(r => r.PlayerDead = null), 100, 100, t.Witnesses(100)) == null, "unknown death state is not an event");
        var unknownToDead = t.Sampler.Build(t.Foot(r => r.PlayerDead = true), 200, 200, t.Witnesses(200));
        check((unknownToDead == null || unknownToDead["outcome"] == null) && t.Sampler.Terminals == 0, "unknown->dead is not an edge");
        t = new Fixture();
        t.Sampler.Build(t.Foot(), 100, 100, t.Witnesses(100));
        var seen = Fixture.Seen(300);
        var wasted = t.Sampler.Build(t.Foot(r => r.PlayerDead = true), 300, 300, t.Witnesses(300, seen));
        check(wasted != null && (string)Get(wasted, "outcome", "kind") == "wasted", "wasted edge");
        check(Guid.TryParseExact((string)Get(wasted, "outcome", "nativeReceiptId"), "D", out var _), "receipt id is a native-minted guid");
        check(((List<object>)wasted["witnessReceipts"]).Count == 1, "wasted witnessed at its tick");
        WireFrames.Add(json.Serialize(wasted));
        var held = t.Sampler.Build(t.Foot(r => r.PlayerDead = true), 400, 400, t.Witnesses(400));
        check(held == null || held["outcome"] == null, "dead state held does not mint a second receipt");
        check(t.Sampler.Terminals == 1, "exactly one terminal receipt");
        var busted = new Fixture();
        busted.Sampler.Build(busted.Foot(), 100, 100, busted.Witnesses(100));
        var arrested = busted.Sampler.Build(busted.Foot(r => r.PlayerBeingArrested = true), 200, 200, busted.Witnesses(200, Fixture.Seen(200)));
        check(arrested != null && (string)Get(arrested, "outcome", "kind") == "busted", "busted edge");
        WireFrames.Add(json.Serialize(arrested));
        busted.Sampler.Reset();
        var afterReset = busted.Sampler.Build(busted.Foot(r => r.PlayerBeingArrested = true), 300, 300, busted.Witnesses(300));
        check(afterReset == null || afterReset["outcome"] == null, "reset discards baselines: no edge across a world boundary");

        // 8. Wanted edge and trailing sample after leaving interest.
        var w = new Fixture();
        w.Sampler.Build(w.Foot(), 100, 100, w.Witnesses(100));
        var up = w.Sampler.Build(w.Foot(r => r.WantedLevel = 2), 200, 200, w.Witnesses(200, Fixture.Seen(200)));
        check(up != null && (int)up["wantedLevel"] == 2 && w.WitnessCalls == 1, "wanted edge sample with witness spend");
        WireFrames.Add(json.Serialize(up));
        var down = w.Sampler.Build(w.Foot(), 300, 300, w.Witnesses(300));
        check(down != null && (int)down["wantedLevel"] == 0, "falling wanted edge is observed");
        check(w.Sampler.Build(w.Foot(), 400, 400, w.Witnesses(400)) == null, "back to idle after the trailing sample");

        // 9. Motion-edge candidates spend witness geometry; ordinary driving does not.
        var m = new Fixture();
        m.Sampler.Build(m.Drive(), 100, 100, m.Witnesses(100));
        m.Sampler.Build(m.Drive(r => { r.Airborne = true; r.Grounded = false; }), 200, 200, m.Witnesses(200, Fixture.Seen(200)));
        check(m.WitnessCalls == 1, "airborne edge is a witness candidate");
        m.Sampler.Build(m.Drive(r => { r.Airborne = true; r.Grounded = false; }), 300, 300, m.Witnesses(300));
        check(m.WitnessCalls == 1, "held airborne state is not re-spent");
        m.Sampler.Build(m.Drive(r => r.RollDegrees = 150), 400, 400, m.Witnesses(400, Fixture.Seen(400)));
        check(m.WitnessCalls == 2, "high roll is a witness candidate");

        // 10. Witness cap and dedupe.
        var many = Enumerable.Range(0, 12).Select(i => Fixture.Seen(500)).ToList();
        many.Add(many[0]);
        var cap = new Fixture();
        cap.Sampler.Build(cap.Drive(), 100, 100, cap.Witnesses(100));
        var capped = cap.Sampler.Build(cap.Drive(r => r.Collision = cap.Collision(500, 500)), 500, 500, cap.Witnesses(500, many.ToArray()));
        check(((List<object>)capped["witnessReceipts"]).Count == M9StateSampler.MaxWitnesses, "witness list is bounded");

        // 11. Epoch mismatch or unanchored player fails closed.
        var e = new Fixture();
        e.Sampler.Build(e.Drive(), 100, 100, e.Witnesses(100));
        var foreign = e.Drive(r => r.PlayerCaptureRef = Guid.NewGuid().ToString("D"));
        check(e.Sampler.Build(foreign, 200, 200, e.Witnesses(200)) == null && e.Sampler.Rejected >= 1, "unanchored player refused");
        e.Epoch = 4;
        check(e.Sampler.Build(e.Drive(), 300, 300, e.Witnesses(300)) != null, "epoch is read at build time, not cached");

        // 12. Serialized frame stays under the pipe frame limit even with 8 witnesses.
        var size = new Fixture();
        size.Sampler.Build(size.Drive(), 100, 100, size.Witnesses(100));
        var big = size.Sampler.Build(size.Drive(r => r.Collision = size.Collision(600, 600)), 600, 600,
            size.Witnesses(600, Enumerable.Range(0, 8).Select(i => Fixture.Seen(600)).ToArray()));
        var envelope = json.Serialize(new { version = 1, type = "m9_sample", adapterEpoch = Guid.NewGuid().ToString("D"),
            streamId = Guid.NewGuid().ToString("D"), sequence = 99999, payload = big });
        check(System.Text.Encoding.UTF8.GetByteCount(envelope) < 6000, "m9_sample frame fits the 8192 byte pipe limit");
    }
}
