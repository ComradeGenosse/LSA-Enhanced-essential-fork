namespace LSA.Activities
{
    public struct AnchorResult
    {
        public bool Ok;
        public string Ref, Reason, Label, Band, SlotKind;
        public float X, Y, Z;
    }
    public struct PreflightResult
    {
        public bool Ok, Already;
        public string Reason;
    }

    // RPH-free seam. Production binds Essential behind it; tests bind a fake.
    // Implementations may call only the Essential APIs named by the capability registry.
    public interface IActivityWorld
    {
        bool TryAcquire(string ownerAlias, string ownershipToken, out string encounterId, out string incarnationId, out string reason);
        bool SameIncarnation(string encounterId, string incarnationId);
        AnchorResult Resolve(string encounterId, string role, string slotKind);
        PreflightResult Preflight(string encounterId, string capability);
        bool Dispatch(string encounterId, string capability, string targetRef);
        void NoteForeign(string encounterId);
        void Cancel(string encounterId, string capability, bool stopIfCurrent);
        ModeSample Sample(string encounterId);
        void BeginOwnership(string encounterId);
        void EndOwnership(string encounterId, bool preempted);
        bool AnchorLive(string captureRef);
        uint GameTime { get; }
    }
}
