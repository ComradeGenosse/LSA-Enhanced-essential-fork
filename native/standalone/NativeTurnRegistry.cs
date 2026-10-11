using System;
using System.Collections.Generic;
using System.Globalization;

namespace LSA.Standalone
{
    /// <summary>
    /// A native-issued proposal. Node can acknowledge it, but cannot issue a
    /// new physical actor or create its lease. Use decimal text for generation:
    /// JS Number does not preserve all Int64 values.
    /// </summary>
    public sealed class NativeTurnPermit
    {
        public readonly Guid TurnId;
        public readonly Guid SessionNonce;
        public readonly Guid ActorIncarnationId;
        public readonly Guid HostRunId;
        public readonly int WorldEpoch;
        public readonly string Source;
        public readonly Guid LeaseId;
        public readonly string Generation;
        internal readonly OwnershipLease Lease;
        internal bool Confirmed;
        internal bool Retired;

        internal NativeTurnPermit(Guid id, Guid nonce, string source, OwnershipLease lease)
        {
            TurnId = id;
            SessionNonce = nonce;
            ActorIncarnationId = lease.Actor.IncarnationId;
            HostRunId = lease.Actor.HostRunId;
            WorldEpoch = lease.Actor.WorldEpoch;
            Source = source;
            LeaseId = lease.LeaseId;
            Generation = lease.Generation.ToString(CultureInfo.InvariantCulture);
            Lease = lease;
        }
    }

    /// <summary>
    /// Owner-fiber-only native turn gate. Phase 2 cannot speak or perform tasks;
    /// phase 3 sources may issue permits after physical player targeting.
    /// Every exact wire tuple is checked against Phase 1 authority before use.
    /// </summary>
    public sealed class NativeTurnRegistry
    {
        private const int MaxTurns = 16;
        private readonly NativeAuthority authority;
        private readonly Dictionary<Guid, NativeTurnPermit> live =
            new Dictionary<Guid, NativeTurnPermit>();

        public NativeTurnRegistry(NativeAuthority authority)
        {
            this.authority = authority ?? throw new ArgumentNullException(nameof(authority));
        }

        public bool TryIssue(ActorRef actor, string nativeSource, long ttlMs,
            out NativeTurnPermit permit, out string reason)
        {
            permit = null;
            reason = "invalid_native_source";
            if (nativeSource != "player_text" && nativeSource != "player_mic" &&
                nativeSource != "special_event")
                return false;
            Sweep();
            if (live.Count >= MaxTurns) { reason = "turn_capacity"; return false; }
            OwnershipLease lease;
            if (!authority.TryAcquire(actor, LeaseKind.Conversation, "standalone-native-turn",
                ttlMs, out lease, out reason)) return false;
            permit = new NativeTurnPermit(Guid.NewGuid(), Guid.NewGuid(), nativeSource, lease);
            live.Add(permit.TurnId, permit);
            reason = "offered";
            return true;
        }

        public bool IsOfferedPermitCurrent(NativeTurnPermit permit)
        {
            if (permit == null || permit.Retired || permit.Confirmed ||
                !live.TryGetValue(permit.TurnId, out var stored) ||
                !ReferenceEquals(stored, permit)) return false;
            if (!authority.IsLeaseCurrent(permit.Lease))
            {
                Retire(permit);
                return false;
            }
            return true;
        }

        public bool TryConfirm(string turnId, string sessionNonce, string actorIncarnationId,
            string leaseId, string generation, string source, out string reason)
        {
            reason = "invalid_ticket";
            NativeTurnPermit permit;
            if (!Guid.TryParseExact(turnId, "D", out var id) ||
                !live.TryGetValue(id, out permit) ||
                permit.Retired || permit.Confirmed ||
                sessionNonce != permit.SessionNonce.ToString("D") ||
                actorIncarnationId != permit.ActorIncarnationId.ToString("D") ||
                leaseId != permit.LeaseId.ToString("D") ||
                generation != permit.Generation || source != permit.Source)
                return false;
            if (!authority.IsLeaseCurrent(permit.Lease))
            {
                Retire(permit);
                reason = "expired_or_retired";
                return false;
            }
            permit.Confirmed = true;
            reason = "confirmed";
            return true;
        }

        public bool IsCurrent(string turnId, string leaseId, string generation, string actorIncarnationId)
        {
            if (!Guid.TryParseExact(turnId, "D", out var id) ||
                !live.TryGetValue(id, out var permit) ||
                !permit.Confirmed || permit.Retired ||
                leaseId != permit.LeaseId.ToString("D") ||
                generation != permit.Generation ||
                actorIncarnationId != permit.ActorIncarnationId.ToString("D"))
                return false;
            if (!authority.IsLeaseCurrent(permit.Lease))
            {
                Retire(permit);
                return false;
            }
            return true;
        }

        public bool TryCancel(string turnId, string leaseId, string generation, string actorIncarnationId)
        {
            if (!IsCurrent(turnId, leaseId, generation, actorIncarnationId))
                return false;
            var permit = live[Guid.Parse(turnId)];
            Retire(permit);
            return true;
        }

        private void Retire(NativeTurnPermit permit)
        {
            if (permit.Retired) return;
            permit.Retired = true;
            live.Remove(permit.TurnId);
            authority.TryRelease(permit.Lease);
        }

        public void Sweep()
        {
            var snapshot = new List<NativeTurnPermit>(live.Values);
            foreach (NativeTurnPermit permit in snapshot)
                if (!authority.IsLeaseCurrent(permit.Lease)) Retire(permit);
        }

        // Invalidates all outstanding conversations before a transport restart,
        // a native world reset, or shutdown. Never resumes an old permit.
        public void RetireAll()
        {
            foreach (NativeTurnPermit permit in new List<NativeTurnPermit>(live.Values))
                Retire(permit);
        }
    }
}
