using System;
using System.Diagnostics;
using System.Threading;
using LSA.Standalone;
using LSA.Standalone.RageHost;

internal sealed class FakeGame : IOwnerContext, IGameClock, IGameWorld, IActorResolver
{
    private readonly int thread = Thread.CurrentThread.ManagedThreadId;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    public bool IsOwner => Thread.CurrentThread.ManagedThreadId == thread;
    public long MonotonicMilliseconds => clock.ElapsedMilliseconds;
    public bool AllowsNpcControl => false;
    public bool TryObserve(int handle, out ActorObservation observation)
    {
        observation = null;
        return false;
    }
}

internal static class Program
{
    public static int Main(string[] args)
    {
        var game = new FakeGame();
        var authority = new NativeAuthority(game, game, game, game);
        using (var server = new StandalonePipeServer(authority.HostRunId, () => authority.WorldEpoch))
        {
            server.Start();
            Console.WriteLine("S2_PIPE_READY");
            var elapsed = Stopwatch.StartNew();
            while (elapsed.ElapsedMilliseconds < 30000)
            {
                authority.Reconcile();
                server.DrainOwnerRequests(authority, 8);
                Thread.Sleep(10);
            }
            authority.Stop();
        }
        return 0;
    }
}
