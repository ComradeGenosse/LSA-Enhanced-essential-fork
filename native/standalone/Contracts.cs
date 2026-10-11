using System;

namespace LSA.Standalone
{
    // None of these interfaces references RAGE, Essential, a game-thread type, or a network library.
    // Phase 2 supplies a real host adapter; Phase 1 tests run the same production state machine.
    // The production host will check RAGE game-fiber ownership here; OS thread
    // affinity alone is not sufficient when multiple fibers share a thread.
    public interface IOwnerContext
    {
        bool IsOwner { get; }
    }

    public interface IGameClock
    {
        long MonotonicMilliseconds { get; }
    }

    public interface IGameWorld
    {
        bool AllowsNpcControl { get; }
    }

    public interface IActorResolver
    {
        // Must be sampled on the game owner fiber by the real adapter.
        bool TryObserve(int handle, out ActorObservation observation);
    }

    public sealed class ActorObservation
    {
        public readonly int Handle;
        public readonly ulong Address;
        public readonly bool IsAlive;
        public readonly bool IsScriptControlled;
        // Native proof of physical incarnation. Zero is unverified legacy/simulation.
        public readonly ulong LifetimeTag;

        public ActorObservation(int handle, ulong address, bool isAlive, bool isScriptControlled)
            : this(handle, address, isAlive, isScriptControlled, 0UL) {}

        public ActorObservation(int handle, ulong address, bool isAlive, bool isScriptControlled, ulong lifetimeTag)
        {
            Handle = handle;
            Address = address;
            IsAlive = isAlive;
            IsScriptControlled = isScriptControlled;
            LifetimeTag = lifetimeTag;
        }
    }

    public sealed class PlayerInput
    {
        public readonly string Text;
        public readonly string Source;
        public PlayerInput(string text, string source)
        {
            Text = text ?? string.Empty;
            Source = source ?? string.Empty;
        }
    }

    public interface IInputSource
    {
        bool TryRead(out PlayerInput input);
    }

    // A native output backend may accept a request but must not report actual audibility
    // or physical completion until its own device and playback callbacks prove it.
    public interface IAudioOutput
    {
        // Before *every* effect, the native adapter must revalidate audioLease
        // via NativeAuthority.IsLeaseCurrent and require Kind == Audio.
        bool TryBegin(OwnershipLease audioLease, Guid playbackId, int sampleRate, out string rejection);
        bool TryPush(OwnershipLease audioLease, Guid playbackId, byte[] pcm16Mono, out string rejection);
        // Stopping a precisely identified retired stream is permitted for cleanup.
        bool TryStop(Guid playbackId, string reason);
    }

    public enum ActionDispatchState
    {
        Rejected,
        Dispatched,
        PhysicalCompletionConfirmed
    }

    public interface IActionExecutor
    {
        // A dispatched request is not a claim that the game effect completed.
        // The adapter must require a current PhysicalAction lease on the owner fiber.
        ActionDispatchState Dispatch(OwnershipLease physicalActionLease, string action, out string reason);
    }
}
