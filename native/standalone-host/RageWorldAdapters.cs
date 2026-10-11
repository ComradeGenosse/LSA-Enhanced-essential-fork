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
        private readonly RandomNumberGenerator entropy = RandomNumberGenerator.Create();
        private bool decoratorsAvailable;
        public bool IsPhysicalActorProofEnabled
        {
            get { DemandOwner(); return enabled && decoratorsAvailable; }
        }

        public RageActorResolver(IOwnerContext owner, bool allowExperimentalAdoption)
        {
            this.owner = owner ?? throw new ArgumentNullException(nameof(owner));
            enabled = allowExperimentalAdoption;
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

        // Must be called ONLY on a native-chosen, source-validated ped, never
        // directly from a Node-supplied handle. This first-registration path
        // is gated off until actual GTA Enhanced cookie behavior is accepted.
        public bool TryAdoptVerifiedPed(int handle)
        {
            DemandOwner();
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
