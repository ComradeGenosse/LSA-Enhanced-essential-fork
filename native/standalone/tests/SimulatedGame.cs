using System;
using System.Collections.Generic;
using LSA.Standalone;

namespace LSA.Standalone.Tests
{
    internal sealed class SimulatedGame : IGameClock, IGameWorld, IActorResolver, IOwnerContext
    {
        private readonly Dictionary<int, ActorObservation> observations = new Dictionary<int, ActorObservation>();
        private long milliseconds;
        private bool permitsControl = true;
        public bool ThrowOnClockRead { get; set; }
        public bool ThrowOnWorldRead { get; set; }
        public long MonotonicMilliseconds
        {
            get
            {
                if (ThrowOnClockRead) throw new InvalidOperationException("simulated_clock_failure");
                return milliseconds;
            }
        }
        public bool AllowsNpcControl
        {
            get
            {
                if (ThrowOnWorldRead) throw new InvalidOperationException("simulated_world_failure");
                return permitsControl;
            }
            set { permitsControl = value; }
        }
        public bool IsOwner { get; set; } = true;
        public bool ThrowOnObserve { get; set; }

        public void Advance(long duration) { milliseconds += duration; }
        public void Regress(long elapsed) { milliseconds = elapsed; }

        public void Spawn(int handle, ulong address, bool scripted = false, ulong lifetimeTag = 0)
        {
            observations[handle] = new ActorObservation(handle, address, true, scripted, lifetimeTag);
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
            if (ThrowOnObserve) throw new InvalidOperationException("simulated_game_observation_failure");
            return observations.TryGetValue(handle, out observation);
        }
    }
}
