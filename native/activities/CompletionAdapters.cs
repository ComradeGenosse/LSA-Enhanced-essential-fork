namespace LSA.Activities
{
    public struct ModeSample
    {
        public bool Alive, Injured, Dead, Scripted, Directed, Reflex, Suspended, InVehicle;
        public bool FollowOnFoot, FollowPaused, SitOnGround, TargetValid, TargetSame, ControlReleased, ContinuityReached, Wandering;
        public string DistanceBand;
        public float X, Y, Z;
        public int ReflexTime;
    }

    // Handler acceptance is not completion. These verdicts are the only promotion path.
    public static class CompletionAdapters
    {
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
    }
}
