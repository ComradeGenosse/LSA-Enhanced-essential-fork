using System;

namespace LSA.Standalone
{
    // None of these interfaces references RAGE, Essential, a game-thread type, or a network library.
    // Phase 2 supplies a real host adapter; Phase 1 tests run the same production state machine.
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

        public ActorObservation(int handle, ulong address, bool isAlive, bool isScriptControlled)
        {
            Handle = handle;
            Address = address;
            IsAlive = isAlive;
            IsScriptControlled = isScriptControlled;
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
        bool TryBegin(ActorRef speaker, Guid playbackId, int sampleRate, out string rejection);
        bool TryPush(Guid playbackId, byte[] pcm16Mono, out string rejection);
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
        ActionDispatchState Dispatch(ActorRef actor, string action, out string reason);
    }
}
