using System;

namespace LSA.Standalone
{
    /// <summary>
    /// A current physical game actor; NEVER a durable profile, name, or character ID.
    /// These fields are immutable and every side effect must be checked against the host.
    /// </summary>
    public sealed class ActorRef : IEquatable<ActorRef>
    {
        public readonly Guid HostRunId;
        public readonly int WorldEpoch;
        public readonly int Handle;
        public readonly ulong Address;
        public readonly Guid IncarnationId;

        internal ActorRef(Guid run, int epoch, int handle, ulong address, Guid incarnation)
        {
            HostRunId = run;
            WorldEpoch = epoch;
            Handle = handle;
            Address = address;
            IncarnationId = incarnation;
        }

        public bool Equals(ActorRef other)
        {
            return other != null &&
                HostRunId == other.HostRunId && WorldEpoch == other.WorldEpoch &&
                Handle == other.Handle && Address == other.Address &&
                IncarnationId == other.IncarnationId;
        }

        public override bool Equals(object other) { return Equals(other as ActorRef); }
        public override int GetHashCode()
        {
            unchecked
            {
                int hash = HostRunId.GetHashCode();
                hash = hash * 31 + WorldEpoch.GetHashCode();
                hash = hash * 31 + Handle.GetHashCode();
                hash = hash * 31 + Address.GetHashCode();
                return hash * 31 + IncarnationId.GetHashCode();
            }
        }
    }

    public enum LeaseKind
    {
        Conversation = 1,
        Audio = 2,
        PhysicalAction = 3,
        Input = 4
    }

    /// <summary>
    /// A one-lane ownership claim. Contains an exact actor identity and an independent
    /// generation, so stale callbacks cannot revive a new owner's work.
    /// </summary>
    public sealed class OwnershipLease
    {
        public readonly Guid LeaseId;
        public readonly ActorRef Actor;
        public readonly LeaseKind Kind;
        public readonly string OwnerId;
        public readonly long Generation;
        public readonly long ExpiresAtMs;

        internal OwnershipLease(Guid id, ActorRef actor, LeaseKind kind, string owner, long gen, long expiration)
        {
            LeaseId = id;
            Actor = actor;
            Kind = kind;
            OwnerId = owner;
            Generation = gen;
            ExpiresAtMs = expiration;
        }

        public bool SameClaim(OwnershipLease other)
        {
            return other != null && LeaseId == other.LeaseId && Kind == other.Kind &&
                Generation == other.Generation && OwnerId == other.OwnerId &&
                Actor.Equals(other.Actor);
        }
    }
}
