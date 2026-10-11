using System;
using System.Collections.Generic;
using System.Threading;

namespace LSA.Standalone
{
    public sealed class NativeAuthority
    {
        private sealed class ActorState
        {
            public ActorRef Reference;
            public long NextGeneration;
            public readonly Dictionary<LeaseKind, OwnershipLease> Leases = new Dictionary<LeaseKind, OwnershipLease>();
        }

        private readonly IGameClock clock;
        private readonly IGameWorld world;
        private readonly IActorResolver resolver;
        private readonly IOwnerContext ownerContext;
        private readonly int constructingThread;
        private readonly Dictionary<int, ActorState> actors = new Dictionary<int, ActorState>();
        private readonly AuthorityTrace trace = new AuthorityTrace();
        private bool stopped;
        private long lastObservedMs;

        public readonly Guid HostRunId;
        public int WorldEpoch { get; private set; }
        public int TrackedActors { get { DemandOwner(); return actors.Count; } }
        public long DroppedTraceEvents { get { DemandOwner(); return trace.Dropped; } }
        public IReadOnlyList<AuthorityEvent> ReadTrace()
        {
            DemandOwner();
            return trace.Snapshot();
        }

        private void Record(string name, string reason, ActorRef actor = null, OwnershipLease lease = null)
        {
            trace.Add(lastObservedMs, HostRunId, WorldEpoch, actor, lease, name, reason);
        }

        private bool TryObserve(int handle, out ActorObservation observed)
        {
            try { return resolver.TryObserve(handle, out observed); }
            catch
            {
                // Failure to read a live actor can never authorize a stale lease.
                observed = null;
                return false;
            }
        }

        private void RevokeLeases(ActorState state, string reason)
        {
            foreach (OwnershipLease lease in state.Leases.Values)
                Record("lease_revoked", reason, state.Reference, lease);
            state.Leases.Clear();
        }

        private void Forget(ActorState state, string reason)
        {
            if (state == null) return;
            RevokeLeases(state, reason);
            actors.Remove(state.Reference.Handle);
            Record("actor_retired", reason, state.Reference);
        }

        public NativeAuthority(IGameClock clock, IGameWorld world, IActorResolver resolver, IOwnerContext ownerContext)
        {
            if (clock == null || world == null || resolver == null || ownerContext == null)
                throw new ArgumentNullException("All native host boundary adapters are required.");
            this.clock = clock;
            this.world = world;
            this.resolver = resolver;
            this.ownerContext = ownerContext;
            constructingThread = Thread.CurrentThread.ManagedThreadId;
            if (!ownerContext.IsOwner) throw new InvalidOperationException("native_owner_required");
            lastObservedMs = clock.MonotonicMilliseconds;
            if (lastObservedMs < 0) throw new ArgumentOutOfRangeException("clock");
            WorldEpoch = 1;
            HostRunId = Guid.NewGuid();
        }

        private void DemandOwner()
        {
            // A real RAGE adapter must supply its own fiber predicate. Thread ID alone
            // is insufficient because several GameFibers can share one OS thread.
            if (Thread.CurrentThread.ManagedThreadId != constructingThread || !ownerContext.IsOwner)
                throw new InvalidOperationException("native_owner_required");
        }

        private void ClearWorld(string reason)
        {
            // Snapshot before clearing: no stale identity may survive a host epoch change.
            foreach (ActorState state in actors.Values)
            {
                RevokeLeases(state, reason);
                Record("actor_retired", reason, state.Reference);
            }
            actors.Clear();
            Record("world_retired", reason);
            if (WorldEpoch == int.MaxValue)
            {
                stopped = true;
                throw new InvalidOperationException("world_epoch_exhausted");
            }
            WorldEpoch++;
        }

        private bool PollClock(out long now)
        {
            now = clock.MonotonicMilliseconds;
            if (now >= 0 && now >= lastObservedMs)
            {
                lastObservedMs = now;
                return true;
            }
            // Clock regression invalidates *all* actor refs and leased effects.
            ClearWorld("clock_regressed");
            lastObservedMs = now < 0 ? 0 : now;
            return false;
        }

        public void WorldChanged()
        {
            DemandOwner();
            if (stopped) return;
            ClearWorld("world_changed");
            long now = clock.MonotonicMilliseconds;
            lastObservedMs = now >= 0 ? now : 0;
        }

        public void Stop()
        {
            DemandOwner();
            if (stopped) return;
            ClearWorld("host_stopped");
            stopped = true;
            Record("host_stopped", "stopped");
        }

        public bool TryRegister(int handle, out ActorRef reference, out string reason)
        {
            DemandOwner();
            reference = null;
            reason = "unavailable";
            long now;
            if (stopped || !PollClock(out now)) return false;
            ActorObservation sample;
            if (handle <= 0 || !TryObserve(handle, out sample) || sample == null ||
                sample.Handle != handle || sample.Address == 0 || !sample.IsAlive)
            {
                reason = "actor_invalid";
                ActorState retired;
                if (actors.TryGetValue(handle, out retired)) Forget(retired, reason);
                return false;
            }
            // Address collision is only a conflict if the *other* tracked actor
            // still physically exists at that address. Sweep stale observations.
            var stale = new List<ActorState>();
            foreach (ActorState other in actors.Values)
            {
                if (other.Reference.Handle == handle) continue;
                ActorObservation observed;
                if (!TryObserve(other.Reference.Handle, out observed) || observed == null ||
                    !observed.IsAlive || observed.Handle != other.Reference.Handle ||
                    observed.Address != other.Reference.Address)
                {
                    stale.Add(other);
                    continue;
                }
                if (other.Reference.Address == sample.Address)
                {
                    reason = "address_conflict";
                    return false;
                }
            }
            foreach (ActorState old in stale) Forget(old, "actor_invalid");
            ActorState current;
            if (actors.TryGetValue(handle, out current) && current.Reference.Address == sample.Address)
            {
                string blocked;
                if (!CanControl(sample, out blocked)) RevokeLeases(current, blocked);
                reference = current.Reference;
                reason = "current";
                return true;
            }
            // Recycled handle or address requires a fresh incarnation and no old lease.
            if (current != null) Forget(current, "actor_replaced");
            var next = new ActorState {
                Reference = new ActorRef(HostRunId, WorldEpoch, handle, sample.Address, Guid.NewGuid())
            };
            actors[handle] = next;
            reference = next.Reference;
            Record("actor_registered", "registered", reference);
            reason = "registered";
            return true;
        }

        public bool RetireActor(ActorRef reference)
        {
            DemandOwner();
            if (stopped || reference == null) return false;
            ActorState state;
            if (!actors.TryGetValue(reference.Handle, out state) || !state.Reference.Equals(reference)) return false;
            Forget(state, "explicit_retire");
            return true;
        }

        private bool TryState(ActorRef reference, out ActorState state, out ActorObservation observed, out string reason)
        {
            state = null;
            observed = null;
            reason = "actor_retired";
            if (stopped || reference == null || reference.HostRunId != HostRunId ||
                reference.WorldEpoch != WorldEpoch || !actors.TryGetValue(reference.Handle, out state) ||
                !state.Reference.Equals(reference))
                return false;

            if (!TryObserve(reference.Handle, out observed) || observed == null ||
                !observed.IsAlive || observed.Address != reference.Address || observed.Handle != reference.Handle)
            {
                // An observer mismatch revokes all claims; new actor must be re-registered.
                Forget(state, "actor_invalid");
                state = null;
                observed = null;
                return false;
            }
            reason = "current";
            return true;
        }

        public bool IsActorCurrent(ActorRef reference)
        {
            DemandOwner();
            long now;
            if (!PollClock(out now)) return false;
            ActorState state; ActorObservation observed; string reason;
            return TryState(reference, out state, out observed, out reason);
        }

        // Call once per native owner-fiber update. A transient scripting/world takeover
        // observed here permanently retires affected leases even if control later returns.
        public void Reconcile()
        {
            DemandOwner();
            long now;
            if (stopped || !PollClock(out now)) return;
            var snapshot = new List<ActorState>(actors.Values);
            foreach (ActorState state in snapshot)
            {
                ActorObservation observed;
                if (!TryObserve(state.Reference.Handle, out observed) || observed == null ||
                    !observed.IsAlive || observed.Handle != state.Reference.Handle ||
                    observed.Address != state.Reference.Address)
                {
                    Forget(state, "actor_invalid");
                    continue;
                }
                string reason;
                if (!CanControl(observed, out reason)) RevokeLeases(state, reason);
            }
        }

        private static bool KindValid(LeaseKind kind)
        {
            return kind >= LeaseKind.Conversation && kind <= LeaseKind.Input;
        }

        private bool CanControl(ActorObservation observed, out string reason)
        {
            if (!world.AllowsNpcControl) { reason = "world_unsafe"; return false; }
            if (observed.IsScriptControlled) { reason = "script_controlled"; return false; }
            reason = "accepted"; return true;
        }

        public bool TryAcquire(ActorRef actor, LeaseKind kind, string owner, long ttlMs, out OwnershipLease lease, out string reason)
        {
            DemandOwner();
            lease = null;
            reason = "unavailable";
            if (stopped) return false;
            long now;
            if (!PollClock(out now)) { reason = "clock_regressed"; return false; }
            if (!KindValid(kind) || string.IsNullOrWhiteSpace(owner) || owner.Length > 128 ||
                ttlMs < 1 || ttlMs > 60000 || now > long.MaxValue - ttlMs)
            { reason = "invalid_lease_request"; return false; }

            ActorState state; ActorObservation observed;
            if (!TryState(actor, out state, out observed, out reason)) return false;
            if (!CanControl(observed, out reason)) { state.Leases.Clear(); return false; }
            OwnershipLease current;
            if (state.Leases.TryGetValue(kind, out current))
            {
                if (current.ExpiresAtMs > now) { reason = "owner_busy"; return false; }
                state.Leases.Remove(kind);
            }
            if (state.NextGeneration == long.MaxValue) { reason = "generation_exhausted"; return false; }
            lease = new OwnershipLease(Guid.NewGuid(), actor, kind, owner, ++state.NextGeneration, now + ttlMs);
            state.Leases.Add(kind, lease);
            reason = "acquired";
            return true;
        }

        private bool FindCurrentLease(OwnershipLease lease, long now, out ActorState state, out string reason)
        {
            state = null;
            reason = "invalid_lease";
            if (lease == null || !KindValid(lease.Kind)) return false;
            ActorObservation observed;
            if (!TryState(lease.Actor, out state, out observed, out reason)) return false;
            OwnershipLease current;
            if (!state.Leases.TryGetValue(lease.Kind, out current) || !current.SameClaim(lease))
            { reason = "stale_lease"; return false; }
            if (current.ExpiresAtMs <= now)
            {
                state.Leases.Remove(lease.Kind);
                reason = "lease_expired";
                return false;
            }
            if (!CanControl(observed, out reason)) { state.Leases.Clear(); return false; }
            reason = "current";
            return true;
        }

        public bool IsLeaseCurrent(OwnershipLease lease)
        {
            DemandOwner();
            long now;
            if (stopped || !PollClock(out now)) return false;
            ActorState state; string reason;
            return FindCurrentLease(lease, now, out state, out reason);
        }

        public bool TryRelease(OwnershipLease lease)
        {
            DemandOwner();
            long now;
            if (stopped || !PollClock(out now)) return false;
            ActorState state; string reason;
            if (!FindCurrentLease(lease, now, out state, out reason)) return false;
            return state.Leases.Remove(lease.Kind);
        }

        // Supersession requires the *current full token*, never an actor name or an
        // unrestricted 'force' boolean. The old generation loses authority at once.
        public bool TrySupersede(OwnershipLease expected, string nextOwner, long ttlMs, out OwnershipLease replacement, out string reason)
        {
            DemandOwner();
            replacement = null;
            reason = "unavailable";
            if (stopped) return false;
            long now;
            if (!PollClock(out now)) { reason = "clock_regressed"; return false; }
            if (string.IsNullOrWhiteSpace(nextOwner) || nextOwner.Length > 128 ||
                ttlMs < 1 || ttlMs > 60000 || now > long.MaxValue - ttlMs)
            { reason = "invalid_lease_request"; return false; }
            ActorState state;
            if (!FindCurrentLease(expected, now, out state, out reason)) return false;
            if (state.NextGeneration == long.MaxValue) { reason = "generation_exhausted"; return false; }
            replacement = new OwnershipLease(Guid.NewGuid(), expected.Actor, expected.Kind,
                nextOwner, ++state.NextGeneration, now + ttlMs);
            state.Leases[expected.Kind] = replacement;
            reason = "superseded";
            return true;
        }
    }
}
