using System;
using System.Collections.Generic;

namespace LSA.Standalone
{
    /// <summary>Immutable diagnostic record: no voice text, user/profile IDs, or audio.</summary>
    public sealed class AuthorityEvent
    {
        public readonly long Sequence;
        public readonly long MonotonicMilliseconds;
        public readonly Guid HostRunId;
        public readonly int WorldEpoch;
        public readonly int Handle;
        public readonly Guid IncarnationId;
        public readonly Guid LeaseId;
        public readonly LeaseKind Kind;
        public readonly long Generation;
        public readonly string Event;
        public readonly string Reason;

        internal AuthorityEvent(long sequence, long time, Guid run, int worldEpoch,
            ActorRef actor, OwnershipLease lease, string eventName, string reason)
        {
            Sequence = sequence;
            MonotonicMilliseconds = time;
            HostRunId = run;
            WorldEpoch = worldEpoch;
            Handle = actor != null ? actor.Handle : 0;
            IncarnationId = actor != null ? actor.IncarnationId : Guid.Empty;
            LeaseId = lease != null ? lease.LeaseId : Guid.Empty;
            Kind = lease != null ? lease.Kind : 0;
            Generation = lease != null ? lease.Generation : 0;
            Event = eventName;
            Reason = reason;
        }
    }

    // Owned and accessed solely from the same approved game fiber. No callbacks to
    // user code occur during authority mutation; bounded storage cannot exhaust memory.
    internal sealed class AuthorityTrace
    {
        internal const int Capacity = 256;
        private readonly Queue<AuthorityEvent> events = new Queue<AuthorityEvent>();
        private long sequence;
        private long dropped;

        internal long Dropped { get { return dropped; } }
        internal int Count { get { return events.Count; } }

        internal void Add(long timestamp, Guid run, int worldEpoch,
            ActorRef actor, OwnershipLease lease, string eventName, string reason)
        {
            if (sequence == long.MaxValue)
            {
                if (dropped < long.MaxValue) dropped++;
                return;
            }
            if (events.Count >= Capacity)
            {
                events.Dequeue();
                if (dropped < long.MaxValue) dropped++;
            }
            events.Enqueue(new AuthorityEvent(++sequence, timestamp, run, worldEpoch,
                actor, lease, eventName, reason));
        }

        internal IReadOnlyList<AuthorityEvent> Snapshot()
        {
            return Array.AsReadOnly(events.ToArray());
        }
    }
}
