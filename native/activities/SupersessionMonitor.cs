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
        public long CaptureSequence;
    }

    // Callback producers may run outside the update fiber. They only append a
    // bounded record; the update fiber resolves Ped/incarnation state later.
    public sealed class SupersessionMonitor
    {
        readonly object gate = new object();
        readonly Queue<CallbackRecord> ring = new Queue<CallbackRecord>();
        int dropped;
        bool overflowing;
        long captureSequence;

        public int Dropped { get { lock (gate) return dropped; } }
        public bool Overflowing { get { lock (gate) return overflowing; } }
        public int Count { get { lock (gate) return ring.Count; } }
        // Sample this fence on the owner fiber when accepting a C-05 annotation.
        // A callback captured at/before it cannot belong to that publication.
        public long CaptureSequence { get { lock (gate) return captureSequence; } }

        public bool Push(CallbackRecord record)
        {
            if (record == null) return false;
            lock (gate) {
                if(captureSequence==long.MaxValue){dropped++;overflowing=true;return false;}
                var sequence=++captureSequence;
                if (ring.Count >= ActivityContracts.CallbackRing) { dropped++; overflowing = true; return false; }
                // Keep source-time fields stable even if a producer reuses its
                // record object. Ped remains opaque; no native/state reads here.
                ring.Enqueue(new CallbackRecord{PedReference=record.PedReference,ActorKey=record.ActorKey,IncarnationId=record.IncarnationId,Name=record.Name,Phase=record.Phase,Source=record.Source,Succeeded=record.Succeeded,GameMs=record.GameMs,CaptureSequence=sequence});
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
