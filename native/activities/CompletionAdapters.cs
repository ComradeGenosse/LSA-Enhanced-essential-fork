namespace LSA.Activities
{
    public struct ModeSample
    {
        public bool Alive, Injured, Dead, Scripted, Directed, Reflex, Suspended, InVehicle;
        public bool FollowOnFoot, FollowPaused, SitOnGround, TargetValid, TargetSame, ControlReleased, ContinuityReached, Wandering;
        public string DistanceBand;
        public float X, Y, Z;
        public int ReflexTime;
        // ACT3. Every field is a read of a named Essential state flag or a GTA native, filled by the world.
        public bool StopFaceMode, StopFaceSame, Facing;
        public bool ApproachMode, ApproachSame, WalkAwayMode, CoverMode;
        public bool IsDriver, VehicleIsAnchor, AssignedIsAnchor, AssignedSet, SeatEntryActive, SeatShuffleActive;
        public int SeatIndex;
        public float VehicleSpeed, TargetDistance;
        public bool HoldingItem, ScenarioActive;
        public string HeldItemName;
        // ACT6: sampled physical movement from one dispatched and owner-scoped native task.
        public bool NavIssued, NavTaskSeen, NavTaskLost, NavProgress, NavStuck, NavVehicleSame, NavArrived;
        public float NavDistance;
    }

    // Per-execution facts the pure adapters need. None of these come from the game.
    public struct AdapterContext
    {
        public string Capability, Seat, ItemName;
        public int ElapsedMs;
        public float StartDistance;
        public bool ApproachDone, ApproachOk;
        public string ApproachReason;
    }

    // kind: not_yet | progress | established | completed | lost | failed.
    // Only "completed" with strong evidence can become PHYSICALLY_COMPLETED, and the runner
    // refuses it for every mode capability.
    public struct Verdict
    {
        public string Kind, Reason, EvidenceKind, Strength, Detail;
        public static Verdict NotYet => new Verdict { Kind = "not_yet" };
        public static Verdict Of(string kind, string evidence, string strength, string detail = null, string reason = null) => new Verdict { Kind = kind, EvidenceKind = evidence, Strength = strength, Detail = detail, Reason = reason };
        public static Verdict Fail(string reason) => new Verdict { Kind = "failed", Reason = reason };
        public static Verdict Lost(string reason) => new Verdict { Kind = "lost", Reason = reason };
    }

    // Handler acceptance is not completion. These verdicts are the only promotion path.
    public static class CompletionAdapters
    {
        public const float ApproachArrivedMeters = 2.5f;
        public const float WalkAwayCompleteMeters = 40f;
        public const float FacingToleranceDegrees = 45f;
        public const float DrivingSpeed = 1.0f;

        public static string Hold(ModeSample sample)
        {
            if (sample.FollowOnFoot || sample.SitOnGround) return "not_yet";
            if (sample.FollowPaused) return "established";
            return "not_yet";
        }
        public static string Follow(ModeSample sample)
        {
            if (!sample.TargetValid || !sample.TargetSame) return "lost";
            if (sample.FollowOnFoot && !sample.FollowPaused) return "established";
            return "not_yet";
        }
        public static string Pose(ModeSample sample)
        {
            if (sample.InVehicle) return "not_yet";
            if (sample.SitOnGround) return "established";
            return "not_yet";
        }
        public static string Resume(ModeSample sample)
        {
            if (sample.ContinuityReached) return "completed";
            if (sample.ControlReleased && sample.ContinuityReached) return "completed";
            if (sample.Wandering && !sample.FollowOnFoot && !sample.SitOnGround) return "established";
            return "not_yet";
        }
        public static string Evaluate(string adapter, ModeSample sample)
        {
            if (adapter == "hold_mode") return Hold(sample);
            if (adapter == "follow_mode") return Follow(sample);
            if (adapter == "pose_mode") return Pose(sample);
            if (adapter == "resume_ambient") return Resume(sample);
            return "not_yet";
        }

        // Capability-aware entry point. ACT2 adapters keep their exact historical verdicts.
        public static Verdict Judge(string adapter, ModeSample sample, AdapterContext context)
        {
            if (adapter == "pose_mode" && context.Capability == "stop_and_face") return StopAndFace(sample);
            if (adapter == "pose_mode" || adapter == "hold_mode" || adapter == "follow_mode" || adapter == "resume_ambient") return Legacy(adapter, sample);
            if (adapter == "approach") return Approach(sample, context);
            if (adapter == "seat_occupancy") return SeatOccupancy(sample, context);
            if (adapter == "vehicle_exit") return VehicleExit(sample);
            if (adapter == "drive_mode") return Drive(sample);
            if (adapter == "cover_mode") return Cover(sample);
            if (adapter == "walk_away") return WalkAway(sample, context);
            if (adapter == "held_item") return HeldItem(sample, context);
            if (adapter == "scenario") return Scenario(sample);
            if (adapter == "place_arrival") return Navigation(sample, false);
            if (adapter == "drive_arrival") return Navigation(sample, true);
            return Verdict.NotYet;
        }

        static Verdict Legacy(string adapter, ModeSample sample)
        {
            var kind = Evaluate(adapter, sample);
            return new Verdict { Kind = kind };
        }

        // Mode flag plus a heading read. A flag alone is never "facing".
        static Verdict StopAndFace(ModeSample sample)
        {
            if (sample.InVehicle) return Verdict.NotYet;
            if (!sample.StopFaceMode) return Verdict.Lost("control_released");
            if (!sample.StopFaceSame) return Verdict.Lost("target_changed");
            if (!sample.Facing) return Verdict.Of("progress", "mode_flag", "medium");
            return Verdict.Of("established", "heading", "medium");
        }

        // The native ApproachFinished event is the only completion signal. Proximity alone, or a cleared
        // flag, never completes the step.
        static Verdict Approach(ModeSample sample, AdapterContext context)
        {
            if (context.ApproachDone) {
                var detail = context.ApproachOk ? "arrived" : (context.ApproachReason == "target_missing" ? "target_missing" : context.ApproachReason == "no_progress" ? "no_progress" : "other");
                if (!context.ApproachOk) return Verdict.Fail("approach_failed");
                if (sample.TargetDistance >= 0 && sample.TargetDistance <= ApproachArrivedMeters) return Verdict.Of("completed", "approach_event", "strong", detail);
                return Verdict.Fail("approach_failed");
            }
            if (sample.ApproachMode && sample.ApproachSame) return Verdict.Of("progress", "mode_flag", "medium");
            if (sample.ApproachMode && !sample.ApproachSame) return Verdict.Fail("target_changed");
            return Verdict.NotYet;
        }

        static bool SeatMatches(ModeSample sample, string seat)
        {
            if (seat == "driver") return sample.IsDriver;
            if (seat == "passenger") return sample.SeatIndex == 0;
            if (seat == "rear") return sample.SeatIndex >= 1;
            if (seat == "any_passenger") return sample.SeatIndex >= 0 && !sample.IsDriver;
            return false;
        }
        static string SeatName(ModeSample sample) => sample.IsDriver ? "driver" : sample.SeatIndex == 0 ? "passenger" : sample.SeatIndex >= 1 ? "rear" : "none";

        // Intent flags are not occupancy. Completion is the actor sitting in the anchored vehicle and seat.
        static Verdict SeatOccupancy(ModeSample sample, AdapterContext context)
        {
            if (sample.InVehicle && !sample.VehicleIsAnchor) return Verdict.Fail("vehicle_mismatch");
            if (sample.AssignedSet && !sample.AssignedIsAnchor && !sample.VehicleIsAnchor) return Verdict.Fail("vehicle_mismatch");
            if (sample.InVehicle && sample.VehicleIsAnchor) {
                if (SeatMatches(sample, context.Seat)) return Verdict.Of("completed", "seat_occupancy", "strong", SeatName(sample));
                // The native owner-issued shuffle is a pending transition, not
                // occupancy. It may time out; never promote it to completion.
                if (context.Seat=="driver" && sample.SeatIndex==0 && sample.SeatShuffleActive)
                    return Verdict.Of("progress","queue_submitted","weak");
                return Verdict.Fail("seat_unavailable");
            }
            if (sample.AssignedIsAnchor && sample.SeatEntryActive) return Verdict.Of("progress", "mode_flag", "medium");
            return Verdict.NotYet;
        }

        static Verdict VehicleExit(ModeSample sample)
        {
            if (!sample.InVehicle) return Verdict.Of("completed", "seat_occupancy", "strong", "none");
            return Verdict.NotYet;
        }

        // StartDriving accepted is not a vehicle in motion. Establishment needs a driver and speed.
        static Verdict Drive(ModeSample sample)
        {
            if (!sample.InVehicle || !sample.IsDriver) return Verdict.Lost("driver_required");
            if (sample.VehicleSpeed >= DrivingSpeed) return Verdict.Of("established", "vehicle_motion", "medium");
            return Verdict.NotYet;
        }

        static Verdict Cover(ModeSample sample)
        {
            if (sample.CoverMode) return Verdict.Of("established", "mode_flag", "medium");
            return Verdict.Lost("control_released");
        }

        // Completion is real distance from the anchored target. The flag only shows the walk is under way.
        static Verdict WalkAway(ModeSample sample, AdapterContext context)
        {
            if (sample.TargetDistance < 0) return Verdict.NotYet;
            if (sample.TargetDistance >= WalkAwayCompleteMeters) return Verdict.Of("completed", "distance", "strong", sample.TargetDistance > 50f ? "far" : "medium");
            if (sample.WalkAwayMode || sample.TargetDistance > context.StartDistance + 2f) return Verdict.Of("progress", "mode_flag", "medium");
            return Verdict.NotYet;
        }

        static Verdict HeldItem(ModeSample sample, AdapterContext context)
        {
            if (context.Capability == "clear_held_item") return sample.HoldingItem ? Verdict.NotYet : Verdict.Of("completed", "held_item", "strong");
            if (sample.HoldingItem && context.ItemName != null && sample.HeldItemName == context.ItemName) return Verdict.Of("completed", "held_item", "strong");
            return Verdict.NotYet;
        }

        // Mode health only. A scenario is never PHYSICALLY_COMPLETED.
        static Verdict Navigation(ModeSample sample, bool driving)
        {
            if (!sample.NavIssued || sample.NavTaskLost) return Verdict.Fail("navigation_failed");
            if (driving && (!sample.InVehicle || !sample.IsDriver)) return Verdict.Fail("driver_required");
            if (driving && !sample.NavVehicleSame) return Verdict.Fail("vehicle_mismatch");
            if (!driving && sample.InVehicle) return Verdict.Fail("on_foot_required");
            if (sample.NavArrived && sample.NavProgress && sample.NavTaskSeen) return Verdict.Of("completed", driving ? "vehicle_motion" : "distance", "strong", "at");
            if (sample.NavStuck) return Verdict.Fail("no_progress");
            if (sample.NavProgress && sample.NavTaskSeen) return Verdict.Of("progress", driving ? "vehicle_motion" : "distance", "medium");
            return Verdict.NotYet;
        }

        static Verdict Scenario(ModeSample sample)
        {
            if (sample.InVehicle) return Verdict.Lost("on_foot_required");
            if (sample.ScenarioActive) return Verdict.Of("established", "scenario_active", "medium");
            return Verdict.Lost("control_released");
        }
    }
}
