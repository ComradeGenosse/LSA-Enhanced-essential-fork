using System;
using System.Text.RegularExpressions;

namespace LSA.Intelligence.MemoryC01
{
    // The pinned Essential/Core native ABI does NOT provide a normal typed/STT
    // C-01 accepted-turn callback with generation + sessionNonce + active
    // speaker. This intentionally does not subscribe to any Director, PS3,
    // JS transcript or model source. There is no producer to register.
    public static class OriginalC01SourceGate
    {
        public const string MissingAbi =
            "pinned_original_core_normal_c01_accepted_typed_stt_callback_unavailable";

        public static bool PinnedSourceExposed { get { return false; } }

        // A source-independent *structure* check, not source authentication.
        // It is safe to run in native policy tests; never treat true as proof
        // of an original accepted line or as permission to write P2 memory.
        public static bool StructurallyBound(
            OriginalC01Tuple turn, OriginalC01Owner owner,
            OriginalC01Player player, uint nowTick)
        {
            return turn != null && owner != null && player != null &&
                HasText(turn.PedId, 128) && HasText(turn.TurnId, 128) &&
                turn.GenerationId >= 0 && turn.SessionNonce > 0 &&
                turn.GenerationId <= 9007199254740991L &&
                turn.SessionNonce <= 9007199254740991L &&
                IsUuid(owner.HostRunId) && owner.WorldEpoch > 0 &&
                IsUuid(owner.ObserverCaptureRef) &&
                IsUuid(owner.IncarnationId) && IsUuid(owner.EncounterId) &&
                ValidAlias(owner.OwnerAlias) &&
                IsUuid(player.PlayerCaptureRef) &&
                (player.Key == "franklin" || player.Key == "michael" ||
                 player.Key == "trevor" || player.Key == "unknown") &&
                turn.PedId == owner.NativePedId &&
                turn.AcceptedGameTick >= owner.SampledGameTick &&
                turn.AcceptedGameTick <= nowTick &&
                turn.ExpiresGameTick >= nowTick &&
                turn.ExpiresGameTick >= turn.AcceptedGameTick &&
                (ulong)turn.ExpiresGameTick -
                    (ulong)turn.AcceptedGameTick <= 1000UL &&
                turn.AcceptedGameTick - owner.SampledGameTick <= 1000U &&
                player.SampledGameTick == turn.AcceptedGameTick;
        }

        // An unauthenticated tuple, even a structurally valid one, can NEVER
        // become a native acceptance receipt at this pinned ABI.
        // Only a later independently proven Core callback may implement an
        // attestation producer in an explicit K-controlled contract revision.
        public static OriginalC01Tuple TryReadPinnedAcceptedTurn()
        {
            return null;
        }

        private static readonly Regex Uuid = new Regex(
            @"\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z",
            RegexOptions.CultureInvariant);
        private static readonly Regex Alias = new Regex(
            @"\Apromoted\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z",
            RegexOptions.CultureInvariant);

        static bool IsUuid(string value) { return value != null && Uuid.IsMatch(value); }
        static bool ValidAlias(string value) { return value != null && Alias.IsMatch(value); }
        static bool HasText(string value, int max)
        {
            return !String.IsNullOrWhiteSpace(value) && value.Length <= max;
        }
    }

    // Strictly immutable shape definitions for a future genuine source only.
    // No serializer, event emitter or reader is provided by this pin.
    public sealed class OriginalC01Tuple
    {
        public readonly string PedId, TurnId;
        public readonly long GenerationId, SessionNonce;
        public readonly uint AcceptedGameTick, ExpiresGameTick;
        public OriginalC01Tuple(string pedId, string turnId, long generationId,
            long sessionNonce, uint acceptedGameTick, uint expiresGameTick)
        {
            PedId = pedId; TurnId = turnId;
            GenerationId = generationId; SessionNonce = sessionNonce;
            AcceptedGameTick = acceptedGameTick; ExpiresGameTick = expiresGameTick;
        }
    }

    public sealed class OriginalC01Owner
    {
        public readonly string HostRunId, ObserverCaptureRef, IncarnationId,
            EncounterId, OwnerAlias, NativePedId;
        public readonly int WorldEpoch;
        public readonly uint SampledGameTick;
        public OriginalC01Owner(string hostRunId, int worldEpoch,
            string observerCaptureRef, string incarnationId,
            string encounterId, string ownerAlias, string nativePedId,
            uint sampledGameTick)
        {
            HostRunId = hostRunId; WorldEpoch = worldEpoch;
            ObserverCaptureRef = observerCaptureRef;
            IncarnationId = incarnationId; EncounterId = encounterId;
            OwnerAlias = ownerAlias; NativePedId = nativePedId;
            SampledGameTick = sampledGameTick;
        }
    }

    public sealed class OriginalC01Player
    {
        public readonly string PlayerCaptureRef, Key;
        public readonly uint SampledGameTick;
        public OriginalC01Player(string captureRef, string key, uint sampledGameTick)
        {
            PlayerCaptureRef = captureRef; Key = key;
            SampledGameTick = sampledGameTick;
        }
    }
}
