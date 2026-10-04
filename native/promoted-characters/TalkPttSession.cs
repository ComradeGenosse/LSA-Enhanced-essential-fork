using System.Collections.Generic;

namespace LSA.PromotedCharacters
{
    // One UX4 microphone generation. SendMicStop is allowed only after this
    // session has committed that generation; a stop that wins the race fences
    // the generation so a late start cannot leave the microphone open, and a
    // stop for any other generation does not touch a stock or MarkedTalk turn.
    internal sealed class TalkPttSession
    {
        readonly Queue<int> order = new Queue<int>();
        readonly HashSet<int> fenced = new HashSet<int>();
        int live;
        public int LiveGeneration => live;
        public bool IsLive => live != 0;
        public string Admit(int generation)
        {
            if (generation <= 0) return "rejected";
            if (fenced.Remove(generation)) return "cancelled";
            if (live != 0) return live == generation ? "already" : "busy";
            return "start";
        }
        // False means a stop was already recorded and the caller must not leave
        // a microphone it just started.
        public bool Commit(int generation)
        {
            if (generation <= 0) return false;
            if (fenced.Remove(generation)) { live = 0; return false; }
            live = generation;
            return true;
        }
        public bool ShouldStop(int generation)
        {
            if (generation > 0 && live == generation) { live = 0; return true; }
            Fence(generation);
            return false;
        }
        public void Fence(int generation)
        {
            if (generation <= 0 || !fenced.Add(generation)) return;
            order.Enqueue(generation);
            while (order.Count > 32) fenced.Remove(order.Dequeue());
        }
        public void Reset() { live = 0; fenced.Clear(); order.Clear(); }
    }
}
