using System.Collections.Generic;

namespace LSA.Activities
{
    public sealed class CallbackRecord
    {
        // PedReference is deliberately opaque here so the ACT transport/core layer
        // has no Rage dependency. The promoted-character owner resolves it only
        // when draining the ring on Essential's update fiber.
        public object PedReference;
        public string ActorKey, IncarnationId, Name, Phase, Source;
        public bool? Succeeded;
        public uint GameMs;
    }

    // Callback producers may run outside the update fiber. They only append a
    // bounded record; the update fiber resolves Ped/incarnation state later.
    public sealed class SupersessionMonitor
    {
        readonly object gate = new object();
        readonly Queue<CallbackRecord> ring = new Queue<CallbackRecord>();
        int dropped;
        bool overflowing;

        public int Dropped { get { lock (gate) return dropped; } }
        public bool Overflowing { get { lock (gate) return overflowing; } }
        public int Count { get { lock (gate) return ring.Count; } }

        public bool Push(CallbackRecord record)
        {
            if (record == null) return false;
            lock (gate) {
                if (ring.Count >= ActivityContracts.CallbackRing) { dropped++; overflowing = true; return false; }
                ring.Enqueue(record);
                return true;
            }
        }

        public CallbackRecord Drain()
        {
            lock (gate) {
                if (ring.Count == 0) return null;
                var record = ring.Dequeue();
                if (ring.Count == 0) overflowing = false;
                return record;
            }
        }
    }
}
