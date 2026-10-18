using System;
using LSA.Standalone.RageHost;

internal static class PinnedActorLookupTests
{
    private sealed class Actor { internal int Handle; internal bool Alive = true; }
    private static int checks;

    private static void Expect(bool expected, int handle, Func<int, bool> exists,
        Func<int, bool> isPed, Func<int, Actor> lookup, Func<Actor, bool> eligible,
        Actor expectedActor = null)
    {
        bool result = PinnedActorLookup.TryResolve(handle, exists, isPed,
            lookup, eligible, out Actor actual);
        if (result != expected || actual != expectedActor)
            throw new InvalidOperationException("pinned_actor_lookup_fixture_failed");
        checks++;
    }

    private static bool Throw(int handle)
    {
        throw new InvalidOperationException("simulated_native_stale_handle");
    }

    private static Actor ThrowLookup(int handle)
    {
        throw new InvalidOperationException("simulated_RPH_GetEntityByHandle_failure");
    }

    public static int Main()
    {
        var actor = new Actor { Handle = 17 };
        Func<int, bool> exists = h => h == 17;
        Func<int, bool> ped = h => h == 17;
        Func<int, Actor> lookup = h => h == 17 ? actor : null;
        Func<Actor, bool> eligible = a => a.Alive && a.Handle == 17;

        // Happy path: exactly the requested actor, not a new nearest NPC.
        Expect(true, 17, exists, ped, lookup, eligible, actor);
        // Invalid/stale handles must never be looked up.
        Expect(false, 0, Throw, Throw, ThrowLookup, a => throw new Exception());
        Expect(false, -1, Throw, Throw, ThrowLookup, a => throw new Exception());
        Expect(false, 18, exists, Throw, ThrowLookup, a => throw new Exception());
        // Valid entity, wrong kind. The native lookup must not run.
        Expect(false, 17, exists, _ => false, ThrowLookup, eligible);
        // Entity disappeared after preflight, or lookup itself throws.
        Expect(false, 17, exists, ped, _ => null, eligible);
        Expect(false, 17, exists, ped, ThrowLookup, eligible);
        // Native existence/type checks can themselves fail.
        Expect(false, 17, Throw, ped, lookup, eligible);
        Expect(false, 17, exists, Throw, lookup, eligible);
        // A recycled handle may resolve, but fail subsequent eligibility.
        Expect(false, 17, exists, ped, _ => new Actor { Handle = 18 }, eligible);
        Expect(false, 17, exists, ped, _ => new Actor { Handle = 17, Alive = false }, eligible);
        Expect(false, 17, exists, ped, lookup, _ => throw new Exception("despawn during validation"));
        // The output must not retain a prior actor if a later lookup fails.
        Actor output = actor;
        bool valid = PinnedActorLookup.TryResolve(19, exists, ped, lookup, eligible, out output);
        if (valid || output != null)
            throw new InvalidOperationException("stale actor leaked after rejected resolution");
        checks++;

        Console.WriteLine("PINNED_ACTOR_LOOKUP_PASS checks=" + checks);
        return 0;
    }
}
