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

// Explicitly synthetic separate-process test output. This adapter imitates
// terminal device callbacks to test the EXACT named-pipe receipt contract.
// It NEVER touches a speaker or proves GTA/world audibility.
internal sealed class FixtureOutput : IPhysicalAudioOutput
{
    private sealed class State
    {
        internal OwnershipLease Lease;
        internal int Bytes;
        internal bool Sealed;
    }
    private readonly System.Collections.Generic.Dictionary<Guid, State> output =
        new System.Collections.Generic.Dictionary<Guid, State>();
    public bool TryBegin(OwnershipLease lease, Guid playbackId, int rate, out string rejection)
    {
        rejection = "fixture_only";
        if (lease == null || lease.Kind != LeaseKind.Audio || rate != 24000 ||
            playbackId == Guid.Empty || output.ContainsKey(playbackId)) return false;
        output.Add(playbackId, new State { Lease = lease });
        return true;
    }
    public bool TryPush(OwnershipLease lease, Guid playbackId, byte[] pcm, out string rejection)
    {
        rejection = "fixture_only";
        State current;
        if (!output.TryGetValue(playbackId, out current) ||
            !current.Lease.SameClaim(lease) || current.Sealed ||
            pcm == null || pcm.Length < 2 || pcm.Length % 2 != 0) return false;
        current.Bytes += pcm.Length;
        return true;
    }
    public bool TrySeal(OwnershipLease lease, Guid playbackId, int exactBytes, out string rejection)
    {
        rejection = "fixture_only";
        State current;
        if (!output.TryGetValue(playbackId, out current) ||
            !current.Lease.SameClaim(lease) || current.Sealed ||
            exactBytes < 2 || current.Bytes != exactBytes) return false;
        current.Sealed = true;
        return true;
    }
    public bool TryRead(OwnershipLease lease, Guid playbackId,
        out AudioPlaybackSnapshot snapshot)
    {
        snapshot = null;
        State current;
        if (!output.TryGetValue(playbackId, out current) ||
            !current.Lease.SameClaim(lease)) return false;
        // Synthetic "played" only after exact native EOS and sink seal.
        snapshot = new AudioPlaybackSnapshot(
            current.Sealed ? "playback_completed" :
                current.Bytes > 0 ? "device_accepted" : "authorized",
            current.Sealed ? current.Bytes : 0, current.Bytes, 0);
        return true;
    }
    public bool TryStop(Guid playbackId, string reason) => output.Remove(playbackId);
}

internal static class Program
{
    public static int Main(string[] args)
    {
        var game = new FakeGame();
        var authority = new NativeAuthority(game, game, game, game);
        var turns = new NativeTurnRegistry(authority);
        var audio = new NativeAudioRegistry(authority, turns, new FixtureOutput());
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
                server.DrainOwnerRequests(authority, turns, audio, 8);
                audio.DrainOnOwner(8);
                Thread.Sleep(10);
            }
            audio.RetireAll();
            turns.RetireAll();
            authority.Stop();
        }
        return 0;
    }
}
