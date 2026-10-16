// Bridge-only fail-closed placeholders for the K native sampling seams.
// This executable tests command routing / committed UX4 target payloads, not
// Memory K native authority. Production builds link MemoryOwnerAuthority.cs
// instead; never copy or include this file in PromotedCharacters.csproj.
namespace LSA.PromotedCharacters
{
    public sealed partial class PromotedCharactersIntegration
    {
        public object SampleMemoryNativeAuthority() => null;
        public object SampleMemoryCurrentOwnerPlayer() => null;
    }
}

// UX bridge tests compile the real RuntimeEntry but intentionally do not run
// optional reaction features. Provide inert types only for that cross-assembly
// harness; production continues linking native/reactions/*.cs.
namespace LSA.Reactions
{
    public sealed class ReactionOptions
    {
        public string Mode;
        public bool AllowDuringOwnedBehavior;
        public readonly System.Collections.Generic.HashSet<string> Disabled =
            new System.Collections.Generic.HashSet<string>();
    }
    public static class ReactionCatalog
    {
        public static bool IsKnown(string name) => name=="facepalm" || name=="middle_finger";
    }
    public sealed class ReactionIntegration
    {
        public ReactionIntegration(ReactionOptions options,string pipeName,string hostRunId,
            System.Func<int> epoch,System.Func<long> now,System.Func<Rage.Ped,bool> owns) { }
        public void Initialize() { }
        public void WorldChanged(string reason) { }
        public void RequestShutdown() { }
    }
}
