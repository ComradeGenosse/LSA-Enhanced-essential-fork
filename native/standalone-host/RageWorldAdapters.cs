using System;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Threading;
using LSA.Standalone;
using Rage;
using Rage.Native;

namespace LSA.Standalone.RageHost
{
    // Synchronous no-yield owner scope. Only the entry fiber may open it.
    // This check cannot identify a fiber if arbitrary other code yields inside
    // the scope; callers MUST never yield inside an owner transaction.
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

    // No game/entity calls are allowed from the IPC worker. Registration is
    // explicit: merely observing an arbitrary handle cannot mint ownership.
    internal sealed class RageActorResolver : IActorResolver
    {
        private const string CookieLow = "LSAS2_actor_a";
        private const string CookieHigh = "LSAS2_actor_b";
        private const int DecorInt = 3;
        private readonly IOwnerContext owner;
        private readonly bool enabled;
        private readonly bool experimentalRequested;
        private bool armed;
        private int probedHandle;
        private ulong probedAddress, probedCookie;
        private long startedAt, lastSampleAt;
        private int stableSamples;
        private bool probePassed;
        private string lastProbeReason = "not_started";
        private readonly RandomNumberGenerator entropy = RandomNumberGenerator.Create();
        private bool decoratorsAvailable;
        public bool IsPhysicalActorProofEnabled
        {
            get { DemandOwner(); return experimentalRequested && armed &&
                probePassed && enabled && decoratorsAvailable && ProbeStillCurrent(); }
        }

        public RageActorResolver(IOwnerContext owner, bool allowExperimentalAdoption,
            bool allowDiagnostics = false)
        {
            this.owner = owner ?? throw new ArgumentNullException(nameof(owner));
            experimentalRequested = allowExperimentalAdoption;
            enabled = allowDiagnostics || allowExperimentalAdoption;
            if (!owner.IsOwner) throw new InvalidOperationException("native_owner_required");
            if (!enabled) return;
            try
            {
                NativeFunction.CallByName<int>("DECOR_REGISTER", CookieLow, DecorInt);
                NativeFunction.CallByName<int>("DECOR_REGISTER", CookieHigh, DecorInt);
                decoratorsAvailable =
                    NativeFunction.CallByName<bool>("DECOR_IS_REGISTERED_AS_TYPE", CookieLow, DecorInt) &&
                    NativeFunction.CallByName<bool>("DECOR_IS_REGISTERED_AS_TYPE", CookieHigh, DecorInt);
            }
            catch { decoratorsAvailable = false; }
        }

        private void DemandOwner()
        {
            if (!owner.IsOwner) throw new InvalidOperationException("native_owner_required");
        }

        private static Ped PedFor(int handle)
        {
            if (handle <= 0 || !NativeFunction.CallByName<bool>("DOES_ENTITY_EXIST", handle) ||
                !NativeFunction.CallByName<bool>("IS_ENTITY_A_PED", handle))
                return null;
            Ped ped = World.GetEntityByHandle<Ped>(new PoolHandle(unchecked((uint)handle)));
            return ped != null && ped.Exists() && !ped.IsDead ? ped : null;
        }

        // Native-only diagnostic proof. It writes an ephemeral two-part
        // decorator to a nearby, non-mission NPC, then requires repeated
        // matching full handle + address + cookie observations over real
        // game-fiber ticks. It does NOT grant physical control. Live entity
        // recycling remains a separate GTA acceptance scenario.
        public bool TryBeginProbe(int handle, out string reason)
        {
            DemandOwner();
            Disarm();
            reason = "decorators_unavailable";
            if (!enabled || !decoratorsAvailable) return false;
            reason = "probe_target_unsafe";
            try
            {
                Ped p = PedFor(handle);
                if (p == null || p == Game.LocalPlayer.Character ||
                    NativeFunction.CallByName<bool>("IS_ENTITY_A_MISSION_ENTITY", handle) ||
                    NativeFunction.CallByName<bool>("DECOR_EXIST_ON", handle, CookieLow) ||
                    NativeFunction.CallByName<bool>("DECOR_EXIST_ON", handle, CookieHigh))
                    return false;
                ulong address = unchecked((ulong)p.MemoryAddress.ToInt64());
                if (address == 0) { reason = "probe_no_address"; return false; }
                if (!StampCookie(handle)) { reason = "decorator_roundtrip_failed"; return false; }
                ulong cookie = ReadCookie(handle);
                if (cookie == 0) { reason = "decorator_roundtrip_failed"; return false; }
                probedHandle = handle;
                probedAddress = address;
                probedCookie = cookie;
                startedAt = Stopwatch.GetTimestamp();
                lastSampleAt = 0;
                stableSamples = 0;
                lastProbeReason = "sampling";
                reason = "probe_started";
                return true;
            }
            catch { reason = "probe_native_exception"; return false; }
        }

        public string TickProbe()
        {
            DemandOwner();
            if (probedHandle == 0) return null;
            string change;
            if (!ProbeStillCurrent(out change))
            {
                int staleHandle = probedHandle;
                Disarm();
                lastProbeReason = change;
                return change + " handle=" + staleHandle;
            }
            long now = Stopwatch.GetTimestamp();
            if (now < startedAt || now - startedAt >
                (long)Stopwatch.Frequency * 10)
            {
                if (!probePassed)
                {
                    Disarm();
                    lastProbeReason = "probe_timed_out";
                    return lastProbeReason;
                }
                return null;
            }
            // At least eight separately sampled game frames across >=750 ms.
            if (!probePassed && (lastSampleAt == 0 ||
                now - lastSampleAt >= Stopwatch.Frequency / 20))
            {
                lastSampleAt = now;
                stableSamples++;
                if (stableSamples >= 8 &&
                    now - startedAt >= Stopwatch.Frequency * 3 / 4)
                {
                    probePassed = true;
                    lastProbeReason = "probe_ready_stable";
                    return lastProbeReason;
                }
            }
            return null;
        }

        public bool TryArmProbe(out string reason)
        {
            DemandOwner();
            reason = "experimental_mode_not_enabled";
            if (!experimentalRequested) return false;
            reason = "probe_not_ready";
            if (!enabled || !decoratorsAvailable || !probePassed ||
                !ProbeStillCurrent()) return false;
            armed = true;
            reason = "armed_exact_actor_only";
            return true;
        }

        public string DiagnosticState
        {
            get
            {
                DemandOwner();
                return "decorators=" + (decoratorsAvailable ? "registered" : "unavailable") +
                    " probe=" + lastProbeReason +
                    " frames=" + stableSamples +
                    " actor_handle=" + probedHandle +
                    " address=0x" + probedAddress.ToString("x") +
                    " cookie=0x" + probedCookie.ToString("x") +
                    " cookie_readback=" + (probedCookie != 0 ? "ok" : "none") +
                    " adoption=" + (armed ? "armed_exact_actor" : "closed");
            }
        }

        public void Disarm()
        {
            DemandOwner();
            armed = false;
            probePassed = false;
            probedHandle = 0;
            probedAddress = probedCookie = 0;
            stableSamples = 0;
            startedAt = lastSampleAt = 0;
            lastProbeReason = "not_started";
        }

        private bool ProbeStillCurrent()
        {
            string ignored;
            return ProbeStillCurrent(out ignored);
        }

        private bool ProbeStillCurrent(out string reason)
        {
            reason = "actor_despawned";
            if (probedHandle <= 0 || probedCookie == 0) return false;
            try
            {
                Ped p = PedFor(probedHandle);
                if (p == null || p == Game.LocalPlayer.Character) return false;
                reason = "actor_became_mission_entity";
                if (NativeFunction.CallByName<bool>("IS_ENTITY_A_MISSION_ENTITY", probedHandle))
                    return false;
                reason = "actor_address_changed";
                if (unchecked((ulong)p.MemoryAddress.ToInt64()) != probedAddress)
                    return false;
                reason = "actor_cookie_changed_or_reused";
                if (ReadCookie(probedHandle) != probedCookie) return false;
                reason = "current";
                return true;
            }
            catch { reason = "actor_observation_exception"; return false; }
        }

        // Control is restricted to the SINGLE probed ped for the first GTA
        // typed conversation smoke test. A different nearby ped cannot be
        // silently adopted after the player moves the targeting reticle.
        public bool TryAdoptVerifiedPed(int handle)
        {
            DemandOwner();
            if (!experimentalRequested || !armed || !probePassed ||
                handle != probedHandle || !ProbeStillCurrent()) return false;
            return true;
        }

        private bool StampCookie(int handle)
        {
            if (!enabled || !decoratorsAvailable) return false;
            try
            {
                Ped ped = PedFor(handle);
                if (ped == null || ped == Game.LocalPlayer.Character ||
                    NativeFunction.CallByName<bool>("IS_ENTITY_A_MISSION_ENTITY", handle) ||
                    NativeFunction.CallByName<bool>("DECOR_EXIST_ON", handle, CookieLow) ||
                    NativeFunction.CallByName<bool>("DECOR_EXIST_ON", handle, CookieHigh))
                    return false;
                var bytes = new byte[8];
                entropy.GetBytes(bytes);
                int low = BitConverter.ToInt32(bytes, 0), high = BitConverter.ToInt32(bytes, 4);
                if (low == 0 || high == 0) return false;
                bool first = NativeFunction.CallByName<bool>("DECOR_SET_INT", handle, CookieLow, low);
                bool second = first && NativeFunction.CallByName<bool>("DECOR_SET_INT", handle, CookieHigh, high);
                return second && ReadCookie(handle) == ((ulong)(uint)high << 32 | (uint)low);
            }
            catch { return false; }
        }

        private static ulong ReadCookie(int handle)
        {
            if (!NativeFunction.CallByName<bool>("DECOR_EXIST_ON", handle, CookieLow) ||
                !NativeFunction.CallByName<bool>("DECOR_EXIST_ON", handle, CookieHigh)) return 0;
            uint low = unchecked((uint)NativeFunction.CallByName<int>("DECOR_GET_INT", handle, CookieLow));
            uint high = unchecked((uint)NativeFunction.CallByName<int>("DECOR_GET_INT", handle, CookieHigh));
            return low == 0 || high == 0 ? 0 : ((ulong)high << 32) | low;
        }

        public bool TryObserve(int handle, out ActorObservation observation)
        {
            DemandOwner();
            observation = null;
            if (!enabled || !decoratorsAvailable) return false;
            try
            {
                Ped ped = PedFor(handle);
                if (ped == null || ped == Game.LocalPlayer.Character) return false;
                ulong cookie = ReadCookie(handle);
                ulong address = unchecked((ulong)ped.MemoryAddress.ToInt64());
                if (cookie == 0 || address == 0) return false;
                bool scriptControlled = NativeFunction.CallByName<bool>("IS_ENTITY_A_MISSION_ENTITY", handle);
                observation = new ActorObservation(handle, address, true, scriptControlled, cookie);
                return true;
            }
            catch { return false; }
        }

        public void Dispose() { entropy.Dispose(); }
    }
}
