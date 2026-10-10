using System;
using System.Threading;

namespace LSA.Intelligence
{
    // Read-only monotonic observer, NOT a replacement dialogue owner or a
    // positive proof that all player/Essential asynchronous turns are idle.
    // Every observed original Core entry advances even if it immediately exits;
    // an extra veto is safe, while a missed transition is NOT safe.
    internal sealed class PlayerPriorityEpoch
    {
        long revision=1;
        int available;
        internal long Revision {
            get {
                long value=Interlocked.Read(ref revision);
                return Volatile.Read(ref available)==1 && value>0 ? value : -1;
            }
        }
        internal void Transition()
        {
            long next=Interlocked.Increment(ref revision);
            if(next<=0)Volatile.Write(ref available,0);
        }
        // Availability means the entire *enumerated, pinned hook set* was
        // installed, NOT exhaustive global Essential ownership proof.
        internal void Installed() {
            if(Interlocked.Read(ref revision)>0)Volatile.Write(ref available,1);
        }
        internal void Unavailable()=>Volatile.Write(ref available,0);
    }
}
