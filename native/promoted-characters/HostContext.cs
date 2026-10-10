using System;
using System.Diagnostics;
using LSA.Intelligence;

namespace LSA.PromotedCharacters
{
    // RAM only. The existing Core owner calls clock observation and cleanup;
    // this service creates no fiber, sampler, endpoint, or physical executor.
    public sealed class HostContext
    {
        readonly Stopwatch clock = Stopwatch.StartNew();
        bool sampled;
        uint previousTick;
        public string HostRunId { get; } = Guid.NewGuid().ToString("D");
        public int WorldEpoch { get; private set; } = 1;
        public EntityAnchors Anchors { get; } = new EntityAnchors();
        public long MonotonicMs => clock.ElapsedMilliseconds;
        public event Action<int,string> WorldChanged;

        public bool ObserveGameTick(uint tick)
        {
            // Unsigned forward distance handles normal uint wrap. A backwards
            // step (or an ambiguous jump > half the clock range) fails closed.
            bool regression = sampled && unchecked(tick - previousTick) > int.MaxValue;
            previousTick = tick; sampled = true;
            if(regression) AdvanceWorld("clock_regression");
            return regression;
        }

        public void AdvanceWorld(string reason)
        {
            if(reason!="clock_regression" && reason!="host_reload" && reason!="timeline_change") throw new ArgumentException("invalid_world_reason");
            if(WorldEpoch==int.MaxValue) throw new InvalidOperationException("world_epoch_exhausted");
            WorldEpoch++;
            Anchors.Clear(AnchorRetirement.WorldReset);
            Exception failure=null;
            foreach(var callback in WorldChanged?.GetInvocationList() ?? new Delegate[0])
                try {((Action<int,string>)callback)(WorldEpoch,reason);} catch(Exception error) {failure=error;}
            if(failure!=null) throw new InvalidOperationException("world_consumer_failed",failure);
        }

        public void Cleanup(int limit=16,Func<bool> remaining=null) => Anchors.Cleanup(MonotonicMs,limit,remaining);
        public void Shutdown() => Anchors.Clear(AnchorRetirement.Shutdown);
    }
}
