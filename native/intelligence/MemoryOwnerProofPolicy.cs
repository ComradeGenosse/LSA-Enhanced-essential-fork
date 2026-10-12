using System;
using System.Text.RegularExpressions;

namespace LSA.Intelligence
{
    // Pure source-evidence checks used by native P2's read-only producer and
    // independently tested without game DLLs; NEVER an owner registry.
    public static class MemoryOwnerProofPolicy
    {
        static readonly Regex Alias=new Regex(
            @"\Apromoted\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z",
            RegexOptions.CultureInvariant);
        public static bool ExactOwner(string alias,string claimAlias,
            string incarnation,string claimIncarnation,
            string world,string claimWorld,
            bool observer,bool currentPed,bool exactAnchor,bool activeRegistration)
        {
            return observer&&currentPed&&exactAnchor&&activeRegistration&&
                !String.IsNullOrEmpty(alias)&&Alias.IsMatch(alias)&&
                alias==claimAlias&&!String.IsNullOrEmpty(incarnation)&&
                incarnation==claimIncarnation&&!String.IsNullOrEmpty(world)&&
                world==claimWorld;
        }

        // Handle equality by itself is NEVER sufficient: original Core
        // actor bindings need the retained native captureRef + P1 lifetime,
        // encounter and exact live entity/address/anchor association.
        public static bool ExactActorLifetime(
            string expectedPedId,string currentPedId,
            string expectedCaptureRef,string currentCaptureRef,
            string expectedIncarnation,string currentIncarnation,
            string expectedEncounter,string currentEncounter,
            bool sameNativeEntity,bool sameNativeAddress,
            bool liveAnchor,bool liveRegistration)
        {
            return sameNativeEntity && sameNativeAddress && liveAnchor &&
                liveRegistration && !String.IsNullOrWhiteSpace(expectedPedId) &&
                expectedPedId==currentPedId &&
                IsUuid(expectedCaptureRef) &&
                expectedCaptureRef==currentCaptureRef &&
                IsUuid(expectedIncarnation) &&
                expectedIncarnation==currentIncarnation &&
                IsUuid(expectedEncounter) &&
                expectedEncounter==currentEncounter;
        }
        static readonly Regex Uuid=new Regex(
            @"\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z",
            RegexOptions.CultureInvariant);
        static bool IsUuid(string text) => text!=null && Uuid.IsMatch(text);

        public static string ProtagonistKey(uint model)
        {
            switch(model)
            {
                case 0x9B22DBAFu:return "franklin";
                case 0x0D7114C9u:return "michael";
                case 0x9B810FA2u:return "trevor";
                default:return "unknown";
            }
        }
    }
}
