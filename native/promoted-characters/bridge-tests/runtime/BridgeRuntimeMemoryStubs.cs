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
