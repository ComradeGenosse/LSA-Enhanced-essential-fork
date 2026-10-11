using System;
using System.Collections.Generic;
using LSA.Standalone;
using Rage;
using Rage.Native;

namespace LSA.Standalone.RageHost
{
    /// <summary>
    /// Experimental GTA facial speech gesture. Uses the documented
    /// PLAY_FACIAL_ANIM "mic_chatter"/"mp_facial" pair; this is NOT
    /// phoneme-accurate viseme animation. PCM volume/timing gates each cue.
    ///
    /// Never installs a long-lived facial-idle override, clears a third-party
    /// facial controller, uses Essential, or calls natives from IPC threads.
    /// Combat/unsafe actors cause a no-op. This is intentionally opt-in.
    /// </summary>
    internal sealed class RageLipSyncPresenter : ILipSyncPresenter
    {
        private const int MinLevel = 12;
        private const long ReTriggerMs = 240;
        private readonly NativeAuthority authority;
        private readonly IOwnerContext owner;
        private readonly RageActorResolver resolver;
        private readonly IGameClock clock;
        private readonly Dictionary<Guid, long> nextCue = new Dictionary<Guid, long>();

        internal RageLipSyncPresenter(NativeAuthority authority,
            IOwnerContext owner, RageActorResolver resolver, IGameClock clock)
        {
            this.authority = authority ?? throw new ArgumentNullException(nameof(authority));
            this.owner = owner ?? throw new ArgumentNullException(nameof(owner));
            this.resolver = resolver ?? throw new ArgumentNullException(nameof(resolver));
            this.clock = clock ?? throw new ArgumentNullException(nameof(clock));
            if (!owner.IsOwner) throw new InvalidOperationException("lip_owner_required");
            // Preload the fixed facial clip while the host has an owner fiber,
            // never on an IPC/worker thread and never from a model-supplied path.
            try { NativeFunction.CallByName<int>("REQUEST_ANIM_DICT", "mp_facial"); }
            catch { } // TryPulse will fail closed until the dictionary exists
        }

        public bool TryPulse(OwnershipLease lease, Guid streamId, int level)
        {
            if (!owner.IsOwner || streamId == Guid.Empty ||
                lease == null || lease.Kind != LeaseKind.Audio ||
                level < MinLevel || level > 100 ||
                !authority.IsLeaseCurrent(lease)) return false;

            long now = clock.MonotonicMilliseconds;
            if (now < 0 || now > long.MaxValue - ReTriggerMs) return false;
            long allowed;
            if (nextCue.TryGetValue(streamId, out allowed))
            {
                if (now < allowed) return false;
            }
            else if (nextCue.Count >= NativeAudioRegistry.MaxStreams)
                return false;

            // Revalidate right before every single facial native. A matching
            // handle alone is not proof: NativeAuthority checks physical
            // address, DECOR lifetime tag, actor incarnation and lease.
            ActorRef actor = lease.Actor;
            ActorObservation observed;
            try
            {
                if (!resolver.TryObserve(actor.Handle, out observed) ||
                    observed == null || !observed.IsAlive ||
                    observed.Handle != actor.Handle ||
                    observed.Address != actor.Address ||
                    observed.LifetimeTag == 0) return false;

                Ped ped = World.GetEntityByHandle<Ped>(
                    new PoolHandle(unchecked((uint)actor.Handle)));
                if (ped == null || !ped.Exists() || ped.IsDead ||
                    ped == Game.LocalPlayer.Character) return false;

                // Yield rather than competing with combat, knockdown or
                // player/scripted behavior. Do not suppress existing visemes.
                if (NativeFunction.CallByName<bool>("IS_PED_RAGDOLL", actor.Handle) ||
                    NativeFunction.CallByName<bool>("IS_PED_FALLING", actor.Handle) ||
                    NativeFunction.CallByName<bool>("IS_PED_SHOOTING", actor.Handle) ||
                    NativeFunction.CallByName<bool>("IS_PED_IN_COMBAT", actor.Handle, 0))
                    return false;

                // Asynchronous GTA streaming: do not attempt the clip before
                // its fixed dictionary is available. Never wait/yield here.
                if (!NativeFunction.CallByName<bool>("HAS_ANIM_DICT_LOADED",
                    "mp_facial"))
                {
                    NativeFunction.CallByName<int>("REQUEST_ANIM_DICT", "mp_facial");
                    return false;
                }

                // No untrusted animation names and no arbitrary target from
                // Node. Source-only visual gesture; no tasks or session reset.
                NativeFunction.CallByName<int>("PLAY_FACIAL_ANIM",
                    actor.Handle, "mic_chatter", "mp_facial");
                nextCue[streamId] = now + ReTriggerMs;
                return true;
            }
            catch
            {
                // A missing/unsupported native has no fallback that could
                // affect an unrelated actor, task, or facial controller.
                return false;
            }
        }

        public void Forget(Guid playbackId)
        {
            // Safe even when a ped has died or the handle has been recycled.
            // No game-world cleanup is performed; a short one-shot facial cue
            // naturally ends. Never reset/clear another mod's face override.
            nextCue.Remove(playbackId);
        }
    }
}
