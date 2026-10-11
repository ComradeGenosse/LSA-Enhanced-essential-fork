using System;
using System.Diagnostics;
using System.Threading;
using LSA.Standalone;
using Rage;
using Rage.Native;

namespace LSA.Standalone.RageHost
{
    // A thread check alone would accept other GameFibers on the same OS thread.
    // Enter/Exit is synchronous around an operation and MUST NOT span a Yield/Sleep.
    internal sealed class OwnerScope : IOwnerContext
    {
        private readonly int thread = Thread.CurrentThread.ManagedThreadId;
        private int inOperation;
        public bool IsOwner => Thread.CurrentThread.ManagedThreadId == thread &&
            Volatile.Read(ref inOperation) == 1 && GameFiber.CanSleepNow;
        public void Enter()
        {
            if (Thread.CurrentThread.ManagedThreadId != thread || !GameFiber.CanSleepNow ||
                Interlocked.CompareExchange(ref inOperation, 1, 0) != 0)
                throw new InvalidOperationException("owner_scope_required");
        }
        public void Exit()
        {
            if (Thread.CurrentThread.ManagedThreadId != thread ||
                Interlocked.CompareExchange(ref inOperation, 0, 1) != 1)
                throw new InvalidOperationException("owner_scope_mismatch");
        }
    }

    internal sealed class MonotonicClock : IGameClock
    {
        private readonly Stopwatch timer = Stopwatch.StartNew();
        public long MonotonicMilliseconds => timer.ElapsedMilliseconds;
    }

    internal sealed class RageWorld : IGameWorld
    {
        public bool AllowsNpcControl =>
            !NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") &&
            !NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING") &&
            !NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") &&
            !NativeFunction.CallByName<bool>("GET_MISSION_FLAG") &&
            !NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE");
    }

    // Deliberate Phase 2 safety gate. Real entity lifetime evidence is not
    // established yet. A fake successful observation would be dangerous.
    // Host can prove load/fiber/IPC, but cannot authorize ANY NPC effect.
    internal sealed class UnverifiedRageActorResolver : IActorResolver
    {
        public bool TryObserve(int handle, out ActorObservation observation)
        {
            observation = null;
            return false;
        }
    }
}
