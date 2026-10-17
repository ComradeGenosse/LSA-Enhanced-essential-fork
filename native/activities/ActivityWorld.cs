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

    // Validated arguments for one step. Every reference is a retained C-02 capture reference. The
    // closed scenario and item names come from the pinned contract, never from the wire.
    public sealed class StepArgs
    {
        public string Target, Vehicle, Place, Seat, Scenario, ScenarioName, Item, ItemName;
        // The one Essential command this step may queue. Null for wrapper steps.
        public string Command;
    }

    // RPH-free seam. Production binds Essential behind it; tests bind a fake.
    // Implementations may call only the Essential APIs named by the capability registry.
    public interface IActivityWorld
    {
        // True only for capabilities this binding can execute through Essential and verify from named state.
        bool Supports(string capability);
        bool TryAcquire(string ownerAlias, string ownershipToken, out string encounterId, out string incarnationId, out string reason);
        bool SameIncarnation(string encounterId, string incarnationId);
        AnchorResult Resolve(string encounterId, string role, string slotKind);
        PreflightResult Preflight(string encounterId, string capability, StepArgs args);
        bool Dispatch(string encounterId, string capability, StepArgs args);
        void NoteForeign(string encounterId);
        void Cancel(string encounterId, string capability, bool stopIfCurrent);
        ModeSample Sample(string encounterId, StepArgs args);
        void BeginOwnership(string encounterId);
        void EndOwnership(string encounterId, bool preempted);
        bool AnchorLive(string captureRef);
        uint GameTime { get; }
    }
}
