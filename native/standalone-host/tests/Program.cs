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
    public bool AllowsNpcControl => true;
    public bool TryObserve(int handle, out ActorObservation observation)
    {
        observation = handle == 17
            ? new ActorObservation(handle, 0xA100, true, false, 0xAABBCCDDEEFF1122UL)
            : null;
        return observation != null;
    }
}

internal static class Program
{
    public static int Main(string[] args)
    {
        var game = new FakeGame();
        var authority = new NativeAuthority(game, game, game, game);
        var turns = new NativeTurnRegistry(authority);
        if (!authority.TryRegister(17, out var actor, out var reason))
            throw new InvalidOperationException("fixture_actor_missing:" + reason);
        if (!turns.TryIssueTyped(actor, "Can you describe the scene?", 20000, out var permit, out reason))
            throw new InvalidOperationException("fixture_turn_missing:" + reason);
        using (var server = new StandalonePipeServer(authority.HostRunId, () => authority.WorldEpoch))
        {
            if (!server.Offer(permit))
                throw new InvalidOperationException("fixture_offer_missing");
            server.Start();
            Console.WriteLine("S2_PIPE_READY");
            var elapsed = Stopwatch.StartNew();
            while (elapsed.ElapsedMilliseconds < 30000)
            {
                authority.Reconcile();
                server.DrainOwnerRequests(authority, turns, 8);
                Thread.Sleep(10);
            }
            turns.RetireAll();
            authority.Stop();
        }
        return 0;
    }
}
