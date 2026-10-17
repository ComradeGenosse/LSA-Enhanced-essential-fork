using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Script.Serialization;
using LSA.Activities;

// ACT3 native tests. They drive the real StepRunner through the real frame validators with a fake world, so they
// prove ownership, cancellation, stale-target and completion-verification rules without Essential or GTA.
sealed class Rig
{
    public const string Player = "55555555-5555-4555-8555-555555555555", Vehicle = "66666666-6666-4666-8666-666666666666";
    public static readonly string[] Implemented = { "stop_and_face", "approach_person", "walk_away_from", "exit_vehicle", "begin_driving", "take_cover", "enter_vehicle_seat", "scenario_here", "grab_item", "clear_held_item" };
    public readonly FakeWorld World = new FakeWorld();
    public readonly StepRunner Runner;
    public readonly ActivitySession Session;
    public readonly CapabilityTable Table;
    public int Seq = 1, Executions;
    public long Wall = 1000000;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    public static string Id(char n) => n + "1111111-1111-4111-8111-111111111111";
    public Rig(CapabilityTable table, params string[] supported)
    {
        Table = table;
        foreach (var capability in supported) World.Supported.Add(capability);
        Runner = new StepRunner(table); Runner.Bind(World);
        Session = new ActivitySession(table, Runner); Runner.Session = Session;
        Session.OpenTransport();
        Send(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = Id('a') }, true);
        Send(new { version = 1, type = "lease", sequence = Seq++, leaseTtlMs = 5000 });
        Send(new { version = 1, type = "actor.acquire", sequence = Seq++, requestId = Id('b'), characterId = Id('c'), ownerAlias = "promoted." + Id('c'), ownershipToken = Id('d'), leaseId = Id('e') });
    }
    // Frames produced by the most recent Send. A begin publishes receipts before its ack, so the reply is the
    // first frame that is not a receipt.
    readonly List<Dictionary<string, object>> outbox = new List<Dictionary<string, object>>();
    public Dictionary<string, object> Send(object frame, bool hello = false)
    {
        while (Session.TakeOutbound() != null) { }
        outbox.Clear();
        var text = json.Serialize(frame);
        if (!Session.AcceptClient(text)) throw new Exception("frame rejected: " + text);
        string next;
        while ((next = Session.TakeOutbound()) != null) outbox.Add(json.DeserializeObject(next) as Dictionary<string, object>);
        return outbox.FirstOrDefault(item => item["type"] as string != "receipt");
    }
    public Dictionary<string, object> Args(string capability, string seat = "driver", string scenario = "smoke", string item = "coffee")
    {
        if (capability == "stop_and_face" || capability == "approach_person" || capability == "walk_away_from") return new Dictionary<string, object> { { "target", new Dictionary<string, object> { { "kind", "player" }, { "captureRef", Player } } } };
        if (capability == "enter_vehicle_seat") return new Dictionary<string, object> { { "vehicle", new Dictionary<string, object> { { "kind", "capture" }, { "captureRef", Vehicle } } }, { "seat", seat } };
        if (capability == "scenario_here") return new Dictionary<string, object> { { "scenario", scenario } };
        if (capability == "grab_item") return new Dictionary<string, object> { { "item", item } };
        return new Dictionary<string, object>();
    }
    public Dictionary<string, object> BeginFrame(string capability, string execution, Dictionary<string, object> args = null, string adapter = null, string lossMode = "cancel_if_current", int epoch = 1)
    {
        var row = Table.Get(capability);
        return new Dictionary<string, object> {
            { "version", 1 }, { "type", "step.begin" }, { "sequence", Seq++ }, { "requestId", Id('5') }, { "executionId", execution }, { "activityId", Id('3') }, { "stepId", Id('4') }, { "attempt", 1 },
            { "encounterId", World.Encounter }, { "leaseId", Id('e') }, { "leaseEpoch", epoch }, { "capability", capability }, { "args", args ?? Args(capability) },
            { "timeouts", new Dictionary<string, object> { { "acceptMs", row.AcceptMs }, { "establishMs", row.EstablishMs == 0 ? null : (object)row.EstablishMs }, { "completeMs", row.CompleteMs == 0 ? null : (object)row.CompleteMs }, { "holdMaxMs", row.HoldMaxMs == 0 ? null : (object)row.HoldMaxMs } } },
            { "completion", new Dictionary<string, object> { { "adapter", adapter ?? row.Adapter }, { "until", null } } }, { "violated", new object[0] }, { "onLeaseLoss", lossMode }
        };
    }
    public Dictionary<string, object> Begin(string capability, string execution = null, Dictionary<string, object> args = null, string adapter = null, string lossMode = "cancel_if_current")
    {
        execution = execution ?? Id((char)('0' + (++Executions % 10)));
        return Send(BeginFrame(capability, execution, args, adapter, lossMode));
    }
    public Dictionary<string, object> Preflight(string capability, Dictionary<string, object> args = null)
        => Send(new Dictionary<string, object> { { "version", 1 }, { "type", "step.preflight" }, { "sequence", Seq++ }, { "requestId", Id('1') }, { "encounterId", World.Encounter }, { "leaseId", Id('e') }, { "capability", capability }, { "args", args ?? Args(capability) }, { "preconditions", new object[] { "actor_owned" } } });
    public Dictionary<string, object> Cancel(string execution, string mode)
        => Send(new Dictionary<string, object> { { "version", 1 }, { "type", "step.cancel" }, { "sequence", Seq++ }, { "requestId", Id('6') }, { "executionId", execution }, { "mode", mode } });
    public LiveExecution Live => Runner.Active(World.Encounter);
    public string State => Live?.State;
    public void Tick(int totalMs, int stepMs = 250)
    {
        for (var elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
            World.Now += (uint)stepMs; Wall += stepMs;
            Runner.Lease(Wall, 5000);
            Runner.Tick(World.Now, Wall);
        }
    }
    public void Executed(string name, bool ok = true) => Runner.OnCallback(World.Encounter, World.Incarnation, name, "executed", ok, World.Now, Wall);
    // The most recent receipt published for this session, drained from the outbound queue.
    public Dictionary<string, object> LastReceipt()
    {
        Dictionary<string, object> last = null;
        string text;
        while ((text = Session.TakeOutbound()) != null) outbox.Add(json.DeserializeObject(text) as Dictionary<string, object>);
        foreach (var frame in outbox) if (frame != null && frame["type"] as string == "receipt") last = frame["receipt"] as Dictionary<string, object>;
        outbox.Clear();
        return last;
    }
    public ActivityView Last => Runner.History.Count == 0 ? null : Runner.History[Runner.History.Count - 1];
}

partial class Program
{
    static string Reason(Dictionary<string, object> frame) => frame != null && frame.ContainsKey("reason") ? frame["reason"] as string : null;
    static bool Ack(Dictionary<string, object> frame) => frame != null && frame["type"] as string == "ack";
    static bool Strong(Dictionary<string, object> receipt) => receipt["evidence"] is object[] items && items.Any(item => (item as Dictionary<string, object>)["strength"] as string == "strong");

    static void Act3(CapabilityTable table)
    {
        Act3Contract(table);
        Act3Adapters();
        Act3StopAndFace(table);
        Act3Approach(table);
        Act3WalkAway(table);
        Act3ExitVehicle(table);
        Act3Driving(table);
        Act3Cover(table);
        Act3Seat(table);
        Act3Scenario(table);
        Act3Items(table);
        Act3Ownership(table);
    }

    // The contract stays disabled-by-default: nothing is advertised without native support, and the capabilities
    // this fork does not implement are never advertised even when a world claims them.
    static void Act3Contract(CapabilityTable table)
    {
        var json = new JavaScriptSerializer();
        var off = new Rig(table);
        var caps = (Dictionary<string, object>)((Dictionary<string, object>)json.DeserializeObject(off.Session.ServerHello()))["capabilities"];
        foreach (var id in ActivityContracts.Act3Capabilities) Check(!(bool)caps[id], "ACT3 " + id + " is not advertised without native support");
        var on = new Rig(table, Rig.Implemented);
        caps = (Dictionary<string, object>)((Dictionary<string, object>)json.DeserializeObject(on.Session.ServerHello()))["capabilities"];
        foreach (var id in Rig.Implemented) Check((bool)caps[id], "ACT3 " + id + " is advertised when natively supported");
        foreach (var id in new[] { "follow_vehicle", "give_item", "take_item", "scenario_at", "walk_to", "drive_to", "chase_person", "directed_interaction", "perform_activity" }) Check(!(bool)caps[id], "blocked capability " + id + " is not advertised");
        Check((bool)caps["hold_position"] && (bool)caps["follow_person"], "ACT2 stays advertised");

        var baseSeq = on.Seq;
        Check(ActivityContracts.ExecutionFrame(on.BeginFrame("stop_and_face", Rig.Id('2')), on.Seq - 1), "stop_and_face frame validates");
        Check(ActivityContracts.ExecutionFrame(on.BeginFrame("scenario_here", Rig.Id('2'), on.Args("scenario_here", scenario: "phone")), on.Seq - 1), "scenario frame validates");
        Check(!ActivityContracts.ExecutionFrame(on.BeginFrame("scenario_here", Rig.Id('2'), on.Args("scenario_here", scenario: "juggle")), on.Seq - 1), "unknown scenario is not a frame");
        Check(!ActivityContracts.ExecutionFrame(on.BeginFrame("grab_item", Rig.Id('2'), on.Args("grab_item", item: "cigarette")), on.Seq - 1), "there is no cigarette item");
        Check(!ActivityContracts.ExecutionFrame(on.BeginFrame("enter_vehicle_seat", Rig.Id('2'), on.Args("enter_vehicle_seat", seat: "roof")), on.Seq - 1), "unknown seat is not a frame");
        var extra = on.Args("stop_and_face"); extra["coordinates"] = 1;
        Check(!ActivityContracts.ExecutionFrame(on.BeginFrame("stop_and_face", Rig.Id('2'), extra), on.Seq - 1), "extra argument is not a frame");
        var captured = on.Args("approach_person"); ((Dictionary<string, object>)captured["target"])["kind"] = "capture";
        Check(!ActivityContracts.ExecutionFrame(on.BeginFrame("approach_person", Rig.Id('2'), captured), on.Seq - 1), "ACT3 targets are the player only");
        Check(!ActivityContracts.ExecutionFrame(on.BeginFrame("exit_vehicle", Rig.Id('2'), on.Args("stop_and_face")), on.Seq - 1), "exit_vehicle takes no arguments");
        Check(table.ScenarioName("smoke") == "WORLD_HUMAN_SMOKING" && table.ScenarioName("drink_coffee") == "WORLD_HUMAN_AA_COFFEE" && table.ScenarioName("evil") == null, "scenario names come only from the pinned contract");
        Check(table.ItemName("coffee") == "Coffee" && table.ItemName("cigarette") == null, "item names come only from the pinned contract");
        Check(table.NamesForToken("entertargetvehicle").SequenceEqual(new[] { "entertargetvehicle", "EnterTargetVehicle" }), "seat commands are matched per exact command");

        on.Seq = baseSeq;
        var ghost = on.Send(new Dictionary<string, object> { { "version", 1 }, { "type", "step.preflight" }, { "sequence", on.Seq++ }, { "requestId", Rig.Id('1') }, { "encounterId", on.World.Encounter }, { "leaseId", Rig.Id('e') }, { "capability", "follow_vehicle" }, { "args", new Dictionary<string, object>() }, { "preconditions", new object[0] } });
        Check(ghost["type"] as string == "nack" && Reason(ghost) == "capability_unavailable", "unsupported capability gets a typed nack, not a closed channel");
        var item = on.Send(on.BeginFrame("enter_vehicle_seat", Rig.Id('2'), on.Args("enter_vehicle_seat", seat: "driver"), "pose_mode"));
        Check(item["type"] as string == "nack" && Reason(item) == "unsupported_combination" && !on.World.Dispatched, "a mismatched completion adapter never dispatches");
    }

    // Pure adapter rules. Command acceptance can never complete anything, and modes never complete at all.
    static void Act3Adapters()
    {
        var empty = new ModeSample { Alive = true, SeatIndex = -1, TargetDistance = -1f };
        var modeAdapters = new[] { new[] { "pose_mode", "stop_and_face" }, new[] { "cover_mode", "take_cover" }, new[] { "drive_mode", "begin_driving" }, new[] { "scenario", "scenario_here" }, new[] { "hold_mode", "hold_position" }, new[] { "follow_mode", "follow_person" } };
        var everything = new ModeSample { Alive = true, FollowOnFoot = true, SitOnGround = true, TargetValid = true, TargetSame = true, StopFaceMode = true, StopFaceSame = true, Facing = true, ApproachMode = true, ApproachSame = true, WalkAwayMode = true, CoverMode = true, IsDriver = true, InVehicle = true, VehicleIsAnchor = true, VehicleSpeed = 30f, ScenarioActive = true, HoldingItem = true, SeatIndex = -1, TargetDistance = 80f, ContinuityReached = false };
        foreach (var pair in modeAdapters)
            foreach (var sample in new[] { empty, everything })
                Check(CompletionAdapters.Judge(pair[0], sample, new AdapterContext { Capability = pair[1] }).Kind != "completed", pair[1] + " never reports completion");
        Check(CompletionAdapters.Judge("stop_and_face_unknown", everything, new AdapterContext()).Kind == "not_yet", "unknown adapter completes nothing");

        // stop_and_face needs the flag, the right target and a heading read.
        var face = new AdapterContext { Capability = "stop_and_face" };
        Check(CompletionAdapters.Judge("pose_mode", new ModeSample { StopFaceMode = true, StopFaceSame = true, Facing = false }, face).Kind == "progress", "face flag without a heading is only progress");
        Check(CompletionAdapters.Judge("pose_mode", new ModeSample { StopFaceMode = true, StopFaceSame = true, Facing = true }, face).Kind == "established", "face flag and heading establish");
        Check(CompletionAdapters.Judge("pose_mode", new ModeSample { StopFaceMode = true, StopFaceSame = false, Facing = true }, face).Reason == "target_changed", "face mode toward another ped is lost");
        Check(CompletionAdapters.Judge("pose_mode", new ModeSample { Alive = true, SitOnGround = true }, new AdapterContext { Capability = "sit_on_ground" }).Kind == "established", "sit_on_ground keeps its ACT2 rule");

        // approach: the native event plus real distance. A flag, or a cleared flag, is never completion.
        var approach = new AdapterContext { Capability = "approach_person" };
        Check(CompletionAdapters.Judge("approach", new ModeSample { ApproachMode = true, ApproachSame = true, TargetDistance = 1f }, approach).Kind == "progress", "approach flag is progress, even next to the target");
        Check(CompletionAdapters.Judge("approach", new ModeSample { TargetDistance = 1f }, approach).Kind == "not_yet", "being near without the event is not an approach");
        Check(CompletionAdapters.Judge("approach", new ModeSample { TargetDistance = 2.0f }, new AdapterContext { Capability = "approach_person", ApproachDone = true, ApproachOk = true }).Kind == "completed", "event plus distance completes");
        Check(CompletionAdapters.Judge("approach", new ModeSample { TargetDistance = 2.6f }, new AdapterContext { Capability = "approach_person", ApproachDone = true, ApproachOk = true }).Reason == "approach_failed", "event without arrival fails");
        Check(CompletionAdapters.Judge("approach", new ModeSample { TargetDistance = 1f }, new AdapterContext { Capability = "approach_person", ApproachDone = true, ApproachOk = false }).Reason == "approach_failed", "a failed event fails");
        Check(CompletionAdapters.Judge("approach", new ModeSample { ApproachMode = true, ApproachSame = false, TargetDistance = 9f }, approach).Reason == "target_changed", "approach toward another ped fails");

        // seat occupancy needs the anchored vehicle and the requested seat, not an intent flag.
        var seat = new AdapterContext { Capability = "enter_vehicle_seat", Seat = "driver" };
        Check(CompletionAdapters.Judge("seat_occupancy", new ModeSample { AssignedSet = true, AssignedIsAnchor = true, SeatEntryActive = true, SeatIndex = -1 }, seat).Kind == "progress", "assigned-vehicle flags are intent, not occupancy");
        Check(CompletionAdapters.Judge("seat_occupancy", new ModeSample { InVehicle = true, VehicleIsAnchor = true, IsDriver = true, SeatIndex = -1 }, seat).Kind == "completed", "driver seat of the anchored vehicle completes");
        Check(CompletionAdapters.Judge("seat_occupancy", new ModeSample { InVehicle = true, VehicleIsAnchor = true, IsDriver = false, SeatIndex = 0 }, seat).Reason == "seat_unavailable", "the wrong seat fails");
        Check(CompletionAdapters.Judge("seat_occupancy", new ModeSample { InVehicle = true, VehicleIsAnchor = false, IsDriver = true, SeatIndex = -1 }, seat).Reason == "vehicle_mismatch", "another vehicle fails");
        Check(CompletionAdapters.Judge("seat_occupancy", new ModeSample { AssignedSet = true, AssignedIsAnchor = false, SeatIndex = -1 }, seat).Reason == "vehicle_mismatch", "Essential choosing another vehicle fails");
        foreach (var pair in new[] { new[] { "passenger", "0" }, new[] { "rear", "1" }, new[] { "rear", "2" }, new[] { "any_passenger", "0" }, new[] { "any_passenger", "2" } })
            Check(CompletionAdapters.Judge("seat_occupancy", new ModeSample { InVehicle = true, VehicleIsAnchor = true, SeatIndex = int.Parse(pair[1]) }, new AdapterContext { Capability = "enter_vehicle_seat", Seat = pair[0] }).Kind == "completed", pair[0] + " seat " + pair[1] + " matches");
        Check(CompletionAdapters.Judge("seat_occupancy", new ModeSample { InVehicle = true, VehicleIsAnchor = true, IsDriver = true, SeatIndex = -1 }, new AdapterContext { Capability = "enter_vehicle_seat", Seat = "any_passenger" }).Kind == "failed", "any_passenger is never the driver seat");

        Check(CompletionAdapters.Judge("vehicle_exit", new ModeSample { InVehicle = true }, new AdapterContext()).Kind == "not_yet" && CompletionAdapters.Judge("vehicle_exit", new ModeSample { InVehicle = false }, new AdapterContext()).Kind == "completed", "exit completes only when out of every vehicle");
        Check(CompletionAdapters.Judge("drive_mode", new ModeSample { InVehicle = true, IsDriver = true, VehicleSpeed = 0.2f }, new AdapterContext()).Kind == "not_yet", "driving needs motion");
        Check(CompletionAdapters.Judge("drive_mode", new ModeSample { InVehicle = true, IsDriver = true, VehicleSpeed = 6f }, new AdapterContext()).Kind == "established", "driving is established by motion");
        Check(CompletionAdapters.Judge("drive_mode", new ModeSample { InVehicle = true, IsDriver = false, VehicleSpeed = 6f }, new AdapterContext()).Reason == "driver_required", "a passenger is not driving");

        var away = new AdapterContext { Capability = "walk_away_from", StartDistance = 5f };
        Check(CompletionAdapters.Judge("walk_away", new ModeSample { WalkAwayMode = true, TargetDistance = 20f }, away).Kind == "progress", "walking away is progress");
        Check(CompletionAdapters.Judge("walk_away", new ModeSample { WalkAwayMode = true, TargetDistance = 39.9f }, away).Kind == "progress", "39.9 m is not far enough");
        Check(CompletionAdapters.Judge("walk_away", new ModeSample { WalkAwayMode = false, TargetDistance = 40f }, away).Kind == "completed", "40 m completes with the flag already cleared");
        Check(CompletionAdapters.Judge("walk_away", new ModeSample { WalkAwayMode = true, TargetDistance = -1f }, away).Kind == "not_yet", "an unknown target distance completes nothing");

        var item = new AdapterContext { Capability = "grab_item", ItemName = "Coffee" };
        Check(CompletionAdapters.Judge("held_item", new ModeSample { HoldingItem = true, HeldItemName = "Donut" }, item).Kind == "not_yet", "holding the wrong item is not a grab");
        Check(CompletionAdapters.Judge("held_item", new ModeSample { HoldingItem = true, HeldItemName = "Coffee" }, item).Kind == "completed", "the named held item completes a grab");
        Check(CompletionAdapters.Judge("held_item", new ModeSample { HoldingItem = true, HeldItemName = "Coffee" }, new AdapterContext { Capability = "clear_held_item" }).Kind == "not_yet", "clear needs an empty hand");
        Check(CompletionAdapters.Judge("held_item", new ModeSample { HoldingItem = false }, new AdapterContext { Capability = "clear_held_item" }).Kind == "completed", "an empty hand completes a clear");

        Check(CompletionAdapters.Judge("scenario", new ModeSample { ScenarioActive = true }, new AdapterContext()).Kind == "established" && CompletionAdapters.Judge("scenario", new ModeSample { ScenarioActive = false }, new AdapterContext()).Kind == "lost", "scenario health follows IS_PED_USING_SCENARIO");
        Check(CompletionAdapters.Judge("cover_mode", new ModeSample { CoverMode = true }, new AdapterContext()).Kind == "established" && CompletionAdapters.Judge("cover_mode", new ModeSample { CoverMode = false }, new AdapterContext()).Kind == "lost", "cover health follows TakeCoverMode");
    }

    static Rig Started(CapabilityTable table, string capability, Dictionary<string, object> args = null, string callback = null)
    {
        var rig = new Rig(table, Rig.Implemented);
        var reply = rig.Begin(capability, Rig.Id('2'), args);
        Check(Ack(reply), capability + " begin acknowledged");
        if (callback != null) rig.Executed(callback);
        return rig;
    }

    static void Act3StopAndFace(CapabilityTable table)
    {
        var rig = Started(table, "stop_and_face");
        Check(rig.World.LastCapability == "stop_and_face" && rig.World.LastArgs.Command == "stopandfacetarget" && rig.World.LastArgs.Target == Rig.Player, "stop_and_face queues Essential's own command at the retained target");
        Check(rig.World.OwnershipSeenAtDispatch && rig.State == "DISPATCHED", "ownership precedes dispatch and acceptance is pending");
        rig.Executed("StopAndFaceTarget");
        Check(rig.State == "HANDLER_ACCEPTED", "handler acceptance only");
        rig.World.SampleState.StopFaceMode = true; rig.World.SampleState.StopFaceSame = true;
        rig.Tick(1000);
        Check(rig.State == "HANDLER_ACCEPTED", "the mode flag without a heading does not establish");
        rig.World.SampleState.Facing = true;
        rig.Tick(250);
        Check(rig.State == "MODE_ESTABLISHED" && !rig.Runner.HasPhysicalCompletion, "flag plus heading establishes a mode, never completion");
        rig.World.SampleState.StopFaceMode = false;
        rig.Tick(1000);
        Check(rig.State == "MODE_ESTABLISHED", "a flickering flag is debounced");
        rig.Tick(1000);
        Check(rig.Live == null && rig.Last.Status == "failed" && rig.Last.Reason == "control_released", "a flag that stays cleared fails the step as released");

        var never = Started(table, "stop_and_face", null, "StopAndFaceTarget");
        never.World.SampleState.StopFaceMode = true; never.World.SampleState.StopFaceSame = true;
        never.Tick(4500);
        Check(never.Live == null && never.Last.Reason == "establish_timeout", "never facing times out the establish window");

        var wrong = Started(table, "stop_and_face", null, "StopAndFaceTarget");
        wrong.World.SampleState.StopFaceMode = true; wrong.World.SampleState.StopFaceSame = false; wrong.World.SampleState.Facing = true;
        wrong.Tick(4500);
        Check(wrong.Live == null && wrong.Last.Reason == "establish_timeout", "facing a different ped is never an establishment");
    }

    static void Act3Approach(CapabilityTable table)
    {
        var rig = Started(table, "approach_person", null, "ApproachTarget");
        Check(rig.World.LastArgs.Command == "approachperson" && rig.State == "HANDLER_ACCEPTED", "approach is accepted by the handler callback");
        rig.World.SampleState.TargetDistance = 30f; rig.World.SampleState.ApproachMode = true; rig.World.SampleState.ApproachSame = true;
        rig.Tick(1000);
        Check(rig.Live != null && rig.State == "HANDLER_ACCEPTED" && rig.Live.ProgressSeen && !rig.Runner.HasPhysicalCompletion, "approach in progress is not complete");
        rig.World.SampleState.TargetDistance = 1.5f; rig.World.SampleState.ApproachMode = false;
        rig.Tick(5000);
        Check(rig.Live != null && !rig.Runner.HasPhysicalCompletion, "arriving without Essential's finish event is not completion");
        rig.Runner.OnApproachFinished(rig.World.Encounter, rig.World.Incarnation, false, true, "arrived", rig.World.Now);
        Check(!rig.Live.ApproachDone, "an event about another target is ignored");
        rig.Runner.OnApproachFinished(rig.World.Encounter, Rig.Id('9'), true, true, "arrived", rig.World.Now);
        Check(!rig.Live.ApproachDone && rig.Runner.StaleReceipts == 1, "an event for another incarnation is stale");
        rig.Runner.OnApproachFinished(rig.World.Encounter, rig.World.Incarnation, true, true, "arrived", unchecked(rig.World.Now - 3000000u));
        Check(!rig.Live.ApproachDone, "an event older than the dispatch is ignored");
        rig.Runner.OnApproachFinished(rig.World.Encounter, rig.World.Incarnation, true, true, "arrived", rig.World.Now);
        rig.Tick(250);
        var receipt = rig.LastReceipt();
        Check(rig.Live == null && rig.Last.Status == "completed" && (string)receipt["state"] == "PHYSICALLY_COMPLETED" && Strong(receipt), "event plus distance completes with strong evidence");
        var targets = (object[])receipt["targets"];
        Check(targets.Length == 1 && ((Dictionary<string, object>)targets[0])["role"] as string == "target" && ((Dictionary<string, object>)targets[0])["ref"] as string == Rig.Player, "receipt names the retained target");

        var far = Started(table, "approach_person", null, "ApproachTarget");
        far.World.SampleState.TargetDistance = 12f;
        far.Runner.OnApproachFinished(far.World.Encounter, far.World.Incarnation, true, true, "arrived", far.World.Now);
        far.Tick(250);
        Check(far.Live == null && far.Last.Status == "failed" && far.Last.Reason == "approach_failed", "a finish event while still far is a failure");

        var failed = Started(table, "approach_person", null, "ApproachTarget");
        failed.World.SampleState.TargetDistance = 1f;
        failed.Runner.OnApproachFinished(failed.World.Encounter, failed.World.Incarnation, true, false, "no_progress", failed.World.Now);
        failed.Tick(250);
        Check(failed.Live == null && failed.Last.Reason == "approach_failed", "a failed finish event fails the step");

        var silent = Started(table, "approach_person", null, "ApproachTarget");
        silent.World.SampleState.TargetDistance = 20f;
        silent.Tick(4500);
        Check(silent.Live == null && silent.Last.Reason == "establish_timeout" && silent.World.Stopped, "no sign of an approach times out and stops it");

        var slow = Started(table, "approach_person", null, "ApproachTarget");
        slow.World.SampleState.TargetDistance = 20f; slow.World.SampleState.ApproachMode = true; slow.World.SampleState.ApproachSame = true;
        slow.Tick(31000);
        Check(slow.Live == null && slow.Last.Reason == "complete_timeout" && slow.World.Stopped, "an approach that never finishes times out and is stopped");

        var preflight = new Rig(table, Rig.Implemented);
        preflight.World.Already = true;
        var already = preflight.Preflight("approach_person");
        Check((bool)already["alreadySatisfied"] && !preflight.World.Dispatched, "an already satisfied approach is not dispatched");
    }

    static void Act3WalkAway(CapabilityTable table)
    {
        var rig = Started(table, "walk_away_from", null, "WalkAwayFromTarget");
        rig.World.SampleState.TargetDistance = 4f;
        rig.World.SampleState.WalkAwayMode = true;
        rig.Tick(2000);
        Check(rig.Live != null && rig.Live.ProgressSeen && !rig.Runner.HasPhysicalCompletion, "walking away is progress");
        rig.World.SampleState.TargetDistance = 39f;
        rig.Tick(500);
        Check(rig.Live != null, "39 m is not far enough");
        rig.World.SampleState.TargetDistance = 41f; rig.World.SampleState.WalkAwayMode = false;
        rig.Tick(250);
        var receipt = rig.LastReceipt();
        Check(rig.Live == null && rig.Last.Status == "completed" && Strong(receipt), "40 m of real distance completes");
        var detail = (Dictionary<string, object>)((Dictionary<string, object>)((object[])receipt["evidence"]).Last())["detail"];
        Check(detail["distanceBand"] as string == "medium", "distance evidence uses the closed band detail");

        var idle = Started(table, "walk_away_from", null, "WalkAwayFromTarget");
        idle.World.SampleState.TargetDistance = 4f;
        idle.Tick(5500);
        Check(idle.Live == null && idle.Last.Reason == "establish_timeout" && idle.World.Stopped, "not moving away times out the establish window");

        var slow = Started(table, "walk_away_from", null, "WalkAwayFromTarget");
        slow.World.SampleState.TargetDistance = 10f; slow.World.SampleState.WalkAwayMode = true;
        slow.Tick(61000);
        Check(slow.Live == null && slow.Last.Reason == "complete_timeout", "a walk that stops short times out");
    }

    static void Act3ExitVehicle(CapabilityTable table)
    {
        var rig = Started(table, "exit_vehicle", null, "ExitVehicle");
        rig.World.SampleState.InVehicle = true;
        rig.Tick(6000);
        Check(rig.Live != null && rig.State == "HANDLER_ACCEPTED" && !rig.Runner.HasPhysicalCompletion, "an accepted exit that has not happened is not complete");
        rig.World.SampleState.InVehicle = false;
        rig.Tick(250);
        Check(rig.Live == null && rig.Last.Status == "completed" && Strong(rig.LastReceipt()), "leaving the vehicle completes with strong evidence");

        var stuck = Started(table, "exit_vehicle", null, "ExitVehicle");
        stuck.World.SampleState.InVehicle = true;
        stuck.Tick(12500);
        Check(stuck.Live == null && stuck.Last.Reason == "complete_timeout" && !stuck.World.Stopped, "a stuck exit times out and has no stop API to call");

        // The contract has no cancel API for exit, so a cancel is reported as a detach instead of a fake stop.
        var cancel = Started(table, "exit_vehicle", null, "ExitVehicle");
        cancel.World.SampleState.InVehicle = true;
        cancel.Cancel(Rig.Id('2'), "cancel_if_current");
        var terminal = cancel.LastReceipt();
        Check(cancel.Live == null && (string)terminal["state"] == "DETACHED" && !cancel.World.Stopped && cancel.Last.Status == "abandoned", "exit cannot be stopped, so cancel detaches");

        var lease = Started(table, "exit_vehicle", null, "ExitVehicle");
        lease.Runner.ClientDisconnected(lease.Session, "lease_lost", lease.Wall);
        Check(lease.Live == null && !lease.World.Stopped && lease.Last.Status == "abandoned", "lease loss detaches an unstoppable step");
        var already = new Rig(table, Rig.Implemented); already.World.Already = true;
        Check((bool)already.Preflight("exit_vehicle")["alreadySatisfied"], "exit while on foot is already satisfied");
    }

    static void Act3Driving(CapabilityTable table)
    {
        var rig = Started(table, "begin_driving", null, "StartDriving");
        rig.World.SampleState.InVehicle = true; rig.World.SampleState.IsDriver = true; rig.World.SampleState.VehicleSpeed = 0f;
        rig.Tick(2000);
        Check(rig.State == "HANDLER_ACCEPTED", "a stationary driver is not driving");
        rig.World.SampleState.VehicleSpeed = 8f;
        rig.Tick(250);
        Check(rig.State == "MODE_ESTABLISHED" && !rig.Runner.HasPhysicalCompletion, "motion establishes the driving mode");
        rig.World.SampleState.IsDriver = false;
        rig.Tick(2000);
        Check(rig.Live == null && rig.Last.Reason == "driver_required" && rig.World.Stopped, "losing the driver seat fails the step and stops the driving task");

        var held = Started(table, "begin_driving", null, "StartDriving");
        held.World.SampleState.InVehicle = true; held.World.SampleState.IsDriver = true; held.World.SampleState.VehicleSpeed = 8f;
        held.Tick(250);
        held.Tick(601000, 5000);
        Check(held.Live == null && held.Last.Reason == "hold_limit" && held.World.Stopped, "the driving hold limit stops the task");

        var idle = Started(table, "begin_driving", null, "StartDriving");
        idle.World.SampleState.InVehicle = true; idle.World.SampleState.IsDriver = true;
        idle.Tick(8500);
        Check(idle.Live == null && idle.Last.Reason == "establish_timeout", "a vehicle that never moves times out");

        var nack = new Rig(table, Rig.Implemented); nack.World.PreflightReason = "driver_required";
        var reply = nack.Preflight("begin_driving");
        Check(Reason(reply) == "driver_required", "preflight reports the world's typed reason");
    }

    static void Act3Cover(CapabilityTable table)
    {
        var rig = Started(table, "take_cover");
        Check(rig.World.LastArgs.Command == "takecover" && rig.State == "DISPATCHED", "take_cover queues Essential's command and waits");
        rig.Tick(3000);
        Check(rig.Live != null && rig.State == "DISPATCHED", "a queue-special command has no accept timeout");
        rig.World.SampleState.CoverMode = true;
        rig.Tick(250);
        Check(rig.State == "MODE_ESTABLISHED" && rig.Live.AcceptedGameMs > 0, "the TakeCoverMode flag is the observed acceptance");
        var shown = rig.LastReceipt();
        Check(shown["handlerResult"] == null, "a queue-special acceptance does not claim a handler result");
        rig.World.SampleState.CoverMode = false;
        rig.Tick(2000);
        Check(rig.Live == null && rig.Last.Reason == "control_released" && rig.World.Stopped, "cover that disappears fails the step");

        var none = Started(table, "take_cover");
        none.Tick(8500);
        Check(none.Live == null && none.Last.Reason == "establish_timeout" && none.World.Stopped, "cover that never appears times out and is stopped");

        var hold = Started(table, "take_cover");
        hold.World.SampleState.CoverMode = true;
        hold.Tick(61000, 1000);
        Check(hold.Live == null && hold.Last.Reason == "hold_limit" && hold.World.Stopped && !hold.Runner.HasPhysicalCompletion, "cover is bounded by its hold limit and never completes");
    }

    static void Act3Seat(CapabilityTable table)
    {
        foreach (var pair in new[] { new[] { "driver", "enterdriverseatoftargetvehicle", "EnterDriverSeatOfTargetVehicle" }, new[] { "passenger", "entertargetvehicle", "EnterTargetVehicle" }, new[] { "rear", "enterbackoftargetvehicle", "EnterBackOfTargetVehicle" }, new[] { "any_passenger", "entertargetvehicle", "EnterTargetVehicle" } }) {
            var rig = Started(table, "enter_vehicle_seat", new Rig(table).Args("enter_vehicle_seat", seat: pair[0]));
            Check(rig.World.LastArgs.Command == pair[1] && rig.World.LastArgs.Vehicle == Rig.Vehicle && rig.Live.OwnName == pair[1], pair[0] + " maps to exactly one Essential command");
            rig.Executed(pair[2]);
            Check(rig.State == "HANDLER_ACCEPTED", pair[0] + " is accepted by its own command callback");
            var other = Started(table, "enter_vehicle_seat", new Rig(table).Args("enter_vehicle_seat", seat: pair[0]));
            other.Executed(pair[0] == "rear" ? "EnterTargetVehicle" : "EnterBackOfTargetVehicle");
            Check(other.Live == null && other.Last.Status == "superseded", pair[0] + " is superseded by a different enter command");
        }

        var seat = Started(table, "enter_vehicle_seat", null, "EnterDriverSeatOfTargetVehicle");
        seat.World.SampleState.AssignedSet = true; seat.World.SampleState.AssignedIsAnchor = true; seat.World.SampleState.SeatEntryActive = true;
        seat.Tick(2000);
        Check(seat.Live != null && seat.Live.ProgressSeen && !seat.Runner.HasPhysicalCompletion, "Essential's intent flags are not occupancy");
        seat.World.SampleState.InVehicle = true; seat.World.SampleState.VehicleIsAnchor = true; seat.World.SampleState.IsDriver = true;
        seat.Tick(250);
        var receipt = seat.LastReceipt();
        var detail = (Dictionary<string, object>)((Dictionary<string, object>)((object[])receipt["evidence"]).Last())["detail"];
        Check(seat.Live == null && seat.Last.Status == "completed" && Strong(receipt) && detail["seat"] as string == "driver", "sitting in the anchored driver seat completes");
        var essential = (Dictionary<string, object>)receipt["essential"];
        Check(essential["name"] as string == "enterdriverseatoftargetvehicle", "the receipt names the command actually used");

        var mismatch = Started(table, "enter_vehicle_seat", null, "EnterDriverSeatOfTargetVehicle");
        mismatch.World.SampleState.AssignedSet = true; mismatch.World.SampleState.AssignedIsAnchor = false;
        mismatch.Tick(250);
        Check(mismatch.Live == null && mismatch.Last.Reason == "vehicle_mismatch" && mismatch.World.Stopped, "Essential picking another vehicle cancels the entry");

        var wrongCar = Started(table, "enter_vehicle_seat", null, "EnterDriverSeatOfTargetVehicle");
        wrongCar.World.SampleState.InVehicle = true; wrongCar.World.SampleState.VehicleIsAnchor = false; wrongCar.World.SampleState.IsDriver = true;
        wrongCar.Tick(250);
        Check(wrongCar.Live == null && wrongCar.Last.Reason == "vehicle_mismatch" && !wrongCar.Runner.HasPhysicalCompletion, "sitting in a different vehicle never completes");

        var wrongSeat = Started(table, "enter_vehicle_seat", null, "EnterDriverSeatOfTargetVehicle");
        wrongSeat.World.SampleState.InVehicle = true; wrongSeat.World.SampleState.VehicleIsAnchor = true; wrongSeat.World.SampleState.SeatIndex = 0;
        wrongSeat.Tick(250);
        Check(wrongSeat.Live == null && wrongSeat.Last.Reason == "seat_unavailable", "the wrong seat fails");

        var retired = Started(table, "enter_vehicle_seat", null, "EnterDriverSeatOfTargetVehicle");
        retired.World.Retired.Add(Rig.Vehicle);
        retired.Tick(250);
        Check(retired.Live == null && retired.Last.Reason == "vehicle_invalid" && retired.World.Stopped, "a retired vehicle anchor fails and stops the entry");

        var stale = new Rig(table, Rig.Implemented);
        stale.World.Retired.Add(Rig.Vehicle);
        var begin = stale.Begin("enter_vehicle_seat", Rig.Id('2'));
        Check(begin["type"] as string == "nack" && Reason(begin) == "vehicle_invalid" && !stale.World.Dispatched && stale.World.Began == 0, "a stale vehicle anchor is refused before ownership or dispatch");
        var preflight = stale.Preflight("enter_vehicle_seat");
        Check(Reason(preflight) == "vehicle_invalid", "preflight refuses a stale vehicle anchor");

        var slow = Started(table, "enter_vehicle_seat", null, "EnterDriverSeatOfTargetVehicle");
        slow.World.SampleState.AssignedSet = true; slow.World.SampleState.AssignedIsAnchor = true; slow.World.SampleState.SeatEntryActive = true;
        slow.Tick(21000);
        Check(slow.Live == null && slow.Last.Reason == "complete_timeout" && slow.World.Stopped, "a seat entry that never lands times out and is stopped");

        var nothing = Started(table, "enter_vehicle_seat", null, "EnterDriverSeatOfTargetVehicle");
        nothing.Tick(6500);
        Check(nothing.Live == null && nothing.Last.Reason == "establish_timeout", "no sign of a seat entry times out");
    }

    static void Act3Scenario(CapabilityTable table)
    {
        var rig = Started(table, "scenario_here", rig0().Args("scenario_here", scenario: "smoke"));
        Check(rig.World.LastArgs.ScenarioName == "WORLD_HUMAN_SMOKING" && rig.World.LastArgs.Command == null, "smoke maps to its contract scenario through the wrapper");
        Check(rig.State == "HANDLER_ACCEPTED" && rig.Live.Handler, "a wrapper step is accepted by its call returning");
        var accepted = rig.LastReceipt();
        Check(((Dictionary<string, object>)accepted["essential"])["path"] as string == "wrapper", "the receipt records the wrapper path");
        rig.Tick(2000);
        Check(rig.State == "HANDLER_ACCEPTED", "an inactive scenario is not established");
        rig.World.SampleState.ScenarioActive = true;
        rig.Tick(250);
        Check(rig.State == "MODE_ESTABLISHED" && !rig.Runner.HasPhysicalCompletion, "an active scenario establishes a mode, never completion");
        rig.World.SampleState.ScenarioActive = false;
        rig.Tick(1000);
        Check(rig.State == "MODE_ESTABLISHED", "a scenario blip is debounced");
        rig.Tick(1000);
        Check(rig.Live == null && rig.Last.Reason == "control_released", "a lost scenario fails the step");

        var phone = Started(table, "scenario_here", rig0().Args("scenario_here", scenario: "phone"));
        Check(phone.World.LastArgs.ScenarioName == "WORLD_HUMAN_STAND_MOBILE", "phone maps to its contract scenario");
        phone.Tick(6500);
        Check(phone.Live == null && phone.Last.Reason == "establish_timeout", "a scenario that never starts times out");

        var foreign = Started(table, "scenario_here");
        foreign.Executed("FollowTarget");
        Check(foreign.Live == null && foreign.Last.Status == "superseded" && foreign.Last.Reason == "superseded_essential", "any Essential command ends a scenario step as superseded");

        var bench = new Rig(table, Rig.Implemented);
        var nack = bench.Send(bench.BeginFrame("scenario_here", Rig.Id('2'), bench.Args("scenario_here", scenario: "sit_bench")));
        Check(nack["type"] as string == "nack" && Reason(nack) == "unsupported_combination" && !bench.World.Dispatched, "benches need scenario_at, so scenario_here refuses them");
        var pre = bench.Preflight("scenario_here", bench.Args("scenario_here", scenario: "sit_bench"));
        Check(Reason(pre) == "unsupported_combination", "preflight refuses a bench scenario");

        var blocked = new Rig(table, Rig.Implemented); blocked.World.PreflightReason = "state_blocked";
        Check(Reason(blocked.Preflight("scenario_here")) == "state_blocked", "a scenario will not start over an Essential mode it cannot clear");
    }
    static Rig rig0() => new Rig(CapabilityTable.Parse(System.IO.File.ReadAllBytes(ContractPath())));

    static void Act3Items(CapabilityTable table)
    {
        var rig = Started(table, "grab_item", rig0().Args("grab_item", item: "coffee"), "GrabItem");
        Check(rig.World.LastArgs.ItemName == "Coffee" && rig.State == "HANDLER_ACCEPTED", "grab_item uses the contract item name");
        rig.Tick(3000);
        Check(rig.Live != null && !rig.Runner.HasPhysicalCompletion, "an accepted grab with an empty hand is not a grab");
        rig.World.SampleState.HoldingItem = true; rig.World.SampleState.HeldItemName = "Donut";
        rig.Tick(1000);
        Check(rig.Live != null, "holding a different item is not the requested grab");
        rig.World.SampleState.HeldItemName = "Coffee";
        rig.Tick(250);
        Check(rig.Live == null && rig.Last.Status == "completed" && Strong(rig.LastReceipt()), "the held item completes the grab");

        var timeout = Started(table, "grab_item", rig0().Args("grab_item", item: "water"), "GrabItem");
        timeout.Tick(10500);
        Check(timeout.Live == null && timeout.Last.Reason == "complete_timeout" && timeout.World.Stopped, "a grab that never lands times out and drops the pending item");

        var clear = Started(table, "clear_held_item", null, "ClearHeldItem");
        clear.World.SampleState.HoldingItem = true; clear.World.SampleState.HeldItemName = "Coffee";
        clear.Tick(2000);
        Check(clear.Live != null, "a held item still in hand is not cleared");
        clear.World.SampleState.HoldingItem = false;
        clear.Tick(250);
        Check(clear.Live == null && clear.Last.Status == "completed", "an empty hand completes the clear");

        var refused = new Rig(table, Rig.Implemented);
        var again = refused.Begin("clear_held_item", Rig.Id('2'));
        Check(Ack(again), "clear_held_item is accepted when the world allows it");
        var already = new Rig(table, Rig.Implemented); already.World.Already = true;
        Check((bool)already.Preflight("grab_item")["alreadySatisfied"], "holding the item already is satisfied without dispatch");
    }

    // Ownership, priority and interruption. Native ownership is single-writer: one execution per actor, no silent takeover.
    static void Act3Ownership(CapabilityTable table)
    {
        var rig = Started(table, "approach_person", null, "ApproachTarget");
        var busy = rig.Send(rig.BeginFrame("stop_and_face", Rig.Id('7')));
        Check(busy["type"] as string == "nack" && Reason(busy) == "activity_busy" && rig.World.Dispatches == 1, "a second step never preempts a running one");
        Check(rig.Live.Capability == "approach_person", "the running step keeps ownership");

        var superseded = Started(table, "scenario_here", rig0().Args("scenario_here", scenario: "lean"));
        superseded.Runner.Preempt(superseded.World.Encounter, superseded.World.Incarnation, "follow", superseded.World.Now, superseded.Wall, superseded.Session);
        Check(superseded.Live == null && superseded.Last.Status == "superseded" && superseded.Last.Reason == "superseded_player" && superseded.World.Ended >= 1, "a player command supersedes an ACT3 step and releases ownership");

        var stale = Started(table, "take_cover");
        stale.Runner.Preempt(stale.World.Encounter, Rig.Id('9'), "follow", stale.World.Now, stale.Wall, stale.Session);
        Check(stale.Live != null && stale.Runner.StaleReceipts == 1, "a preempt for another incarnation is ignored");
        stale.Runner.OnCallback(stale.World.Encounter, Rig.Id('9'), "FollowTarget", "executed", true, stale.World.Now, stale.Wall);
        Check(stale.Live != null && stale.Runner.StaleReceipts == 2, "a callback for another incarnation is ignored");

        var failed = Started(table, "stop_and_face", null, null);
        failed.Executed("StopAndFaceTarget", false);
        Check(failed.Live == null && failed.Last.Reason == "handler_false", "a false handler result fails the step");

        var retired = Started(table, "stop_and_face", null, "StopAndFaceTarget");
        retired.World.Retired.Add(Rig.Player);
        retired.Tick(250);
        Check(retired.Live == null && retired.Last.Reason == "target_retired", "a retired target fails the step on the next tick");
        var begin = new Rig(table, Rig.Implemented);
        begin.World.Retired.Add(Rig.Player);
        var refusal = begin.Begin("approach_person", Rig.Id('2'));
        Check(refusal["type"] as string == "nack" && Reason(refusal) == "target_retired" && begin.World.Began == 0 && !begin.World.Dispatched, "a stale target is refused before ownership or dispatch");
        Check(Reason(begin.Preflight("walk_away_from")) == "target_retired", "preflight refuses a stale target");

        var dead = Started(table, "approach_person", null, "ApproachTarget");
        dead.World.SampleState.Dead = true; dead.World.SampleState.Alive = false;
        dead.Tick(250);
        Check(dead.Live == null && dead.Last.Reason == "actor_dead", "actor death ends the step");
        var incarnation = Started(table, "approach_person", null, "ApproachTarget");
        incarnation.World.Same = false;
        incarnation.Tick(250);
        Check(incarnation.Live == null && incarnation.Last.Reason == "actor_retired" && incarnation.Last.Status == "abandoned", "a new incarnation detaches the step");
        var reflex = Started(table, "walk_away_from", null, "WalkAwayFromTarget");
        reflex.World.SampleState.Reflex = true;
        reflex.Tick(250);
        Check(reflex.Live == null && reflex.Last.Reason == "superseded_reflex", "a reflex outranks ACT3");
        var scripted = Started(table, "approach_person", null, "ApproachTarget");
        scripted.World.SampleState.Scripted = true;
        scripted.Tick(250);
        Check(scripted.Live == null && scripted.Last.Reason == "scripted_state" && scripted.World.Stopped, "a scripted state cancels and stops the step");

        // Cancel semantics follow the contract's cancel path.
        var cancel = Started(table, "approach_person", null, "ApproachTarget");
        cancel.Cancel(Rig.Id('2'), "cancel_if_current");
        Check(cancel.Live == null && cancel.Last.Status == "cancelled" && cancel.World.Stopped && cancel.World.Ended >= 1, "cancel_if_current stops a stop-capable step and releases ownership");
        var detach = Started(table, "approach_person", null, "ApproachTarget");
        detach.Cancel(Rig.Id('2'), "detach");
        Check(detach.Live == null && detach.Last.Status == "abandoned" && !detach.World.Stopped, "detach leaves Essential's task alone");
        var lease = Started(table, "take_cover");
        lease.Runner.ClientDisconnected(lease.Session, "lease_lost", lease.Wall);
        Check(lease.Live == null && lease.World.Stopped && lease.Last.Status == "cancelled", "lease loss cancels a stop-capable step");
        var late = new Rig(table, Rig.Implemented);
        var unknown = late.Cancel(Rig.Id('8'), "cancel_if_current");
        Check(Ack(unknown) && late.World.Cancels == 0, "cancelling an unknown execution is a no-op acknowledgement");
        var epoch = new Rig(table, Rig.Implemented);
        var wrongEpoch = epoch.Send(epoch.BeginFrame("take_cover", Rig.Id('2'), null, null, "cancel_if_current", 9));
        Check(wrongEpoch["type"] as string == "nack" && Reason(wrongEpoch) == "lease_lost" && !epoch.World.Dispatched, "a stale lease epoch is refused");

        // Closing the clock or the transport never leaves an ACT3 step alive.
        var reset = Started(table, "scenario_here");
        reset.Runner.ClockReset(reset.Session);
        Check(reset.Live == null && reset.Last.Reason == "clock_reset", "a clock reset ends the step");
        var tick = Started(table, "scenario_here");
        tick.Tick(70000, 1000);
        Check(tick.Live == null, "no ACT3 step outlives its bounded windows");
    }
}
