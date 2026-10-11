using System;
using System.Collections.Generic;
using LSA.Standalone;

namespace LSA.Standalone.Tests
{
    internal sealed class SimulatedGame : IGameClock, IGameWorld, IActorResolver, IOwnerContext
    {
        private readonly Dictionary<int, ActorObservation> observations = new Dictionary<int, ActorObservation>();
        public long MonotonicMilliseconds { get; private set; }
        public bool AllowsNpcControl { get; set; } = true;
        public bool IsOwner { get; set; } = true;

        public void Advance(long duration) { MonotonicMilliseconds += duration; }
        public void Regress(long elapsed) { MonotonicMilliseconds = elapsed; }

        public void Spawn(int handle, ulong address, bool scripted = false)
        {
            observations[handle] = new ActorObservation(handle, address, true, scripted);
        }

        public void Kill(int handle)
        {
            ActorObservation value;
            if (observations.TryGetValue(handle, out value))
                observations[handle] = new ActorObservation(handle, value.Address, false, value.IsScriptControlled);
        }

        public void Despawn(int handle) { observations.Remove(handle); }

        public void ScriptControl(int handle, bool controlled)
        {
            ActorObservation value;
            if (observations.TryGetValue(handle, out value))
                observations[handle] = new ActorObservation(handle, value.Address, value.IsAlive, controlled);
        }

        public bool TryObserve(int handle, out ActorObservation observation)
        {
            return observations.TryGetValue(handle, out observation);
        }
    }
}
