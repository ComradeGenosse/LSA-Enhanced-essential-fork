using System;
using System.Diagnostics;
using LSA.Standalone;
using Rage;

namespace LSA.Standalone.RageHost
{
    // Opt-in, single-shot GTA smoke. It does not mint permits, inject input
    // into other players or replace the normal owner/identity state machine.
    // All gameplay reads/commands remain on the existing RPH owner fiber.
    internal sealed class StandaloneAutoSmoke
    {
        private enum Phase { AwaitSpawn, Delay, Locate, Probe, Observe, Done }
        private Phase phase = Phase.AwaitSpawn;
        private readonly int delaySeconds;
        private readonly bool typedEnabled;
        private readonly bool adoptionAuthorized;
        private readonly Stopwatch elapsed = Stopwatch.StartNew();
        private long phaseAt;
        private int pinnedHandle;
        private const long LocateTimeoutMs = 45000;
        private const long ProbeTimeoutMs = 12000;
        private const long ObservationMs = 90000;

        internal StandaloneAutoSmoke(int afterSpawnSeconds, bool typed, bool consent)
        {
            if (afterSpawnSeconds < 5 || afterSpawnSeconds > 120 ||
                (typed && !consent))
                throw new ArgumentException("invalid_auto_smoke_configuration");
            delaySeconds = afterSpawnSeconds;
            typedEnabled = typed;
            adoptionAuthorized = consent;
            Log("awaiting_safe_player_spawn");
        }

        private static void Log(string code)
        {
            Game.LogTrivial("[LSA-AUTOSMOKE] " + code);
        }

        private static bool Ready()
        {
            try
            {
                Ped player = Game.LocalPlayer.Character;
                return player != null && RphPedValidity.Exists(player) && !player.IsDead &&
                    new RageWorld().AllowsNpcControl;
            }
            catch { return false; }
        }

        private static Ped FindNpc(Ped player)
        {
            Ped best = null;
            float bestDistance = 4.0f;
            try
            {
                foreach (Ped ped in player.GetNearbyPeds(16))
                {
                    if (ped == null || ped == player || !RphPedValidity.Exists(ped) || ped.IsDead)
                        continue;
                    float d = ped.DistanceTo(player);
                    if (d < 0.75f || d >= bestDistance) continue;
                    best = ped;
                    bestDistance = d;
                }
            }
            catch { return null; }
            return best;
        }

        internal void Tick(OwnerScope owner, RageActorResolver resolver)
        {
            if (!owner.IsOwner) throw new InvalidOperationException("owner_scope_required");
            if (phase == Phase.Done) return;
            bool ready = Ready();
            if (!ready)
            {
                if (phase == Phase.Delay)
                {
                    phase = Phase.AwaitSpawn;
                    Log("player_readiness_lost_countdown_reset");
                }
                else if (phase != Phase.AwaitSpawn)
                {
                    resolver.Disarm();
                    Log("aborted_world_no_longer_safe");
                    phase = Phase.Done;
                }
                return;
            }

            long now = elapsed.ElapsedMilliseconds;
            if (phase == Phase.AwaitSpawn)
            {
                phase = Phase.Delay;
                phaseAt = now;
                Log("player_ready countdown_started_seconds=" + delaySeconds);
                return;
            }
            if (phase == Phase.Delay)
            {
                if (now - phaseAt < delaySeconds * 1000L) return;
                Log("countdown_elapsed attempting_safe_probe");
                phase = Phase.Locate;
                phaseAt = now;
            }
            if (phase == Phase.Locate)
            {
                if (now - phaseAt >= LocateTimeoutMs)
                {
                    Log("no_eligible_target timeout_no_gta_acceptance");
                    phase = Phase.Done;
                    return;
                }
                Ped player = Game.LocalPlayer.Character;
                Ped ped = FindNpc(player);
                if (ped == null) return;
                string reason;
                int handle = unchecked((int)ped.Handle.Value);
                if (!resolver.TryBeginProbe(handle, out reason))
                {
                    // Retry another safe civilian until the fixed deadline.
                    return;
                }
                pinnedHandle = handle;
                phase = Phase.Probe;
                phaseAt = now;
                Log("probe_started_exact_actor");
                return;
            }
            if (phase == Phase.Probe)
            {
                if (resolver.IsProbeStableFor(pinnedHandle))
                {
                    Log("probe_ready_stable");
                    if (!typedEnabled)
                    {
                        resolver.Disarm();
                        Log("probe_only_completed_disarmed");
                        phase = Phase.Done;
                        return;
                    }
                    if (!adoptionAuthorized)
                    {
                        resolver.Disarm();
                        Log("actor_adoption_not_authorized");
                        phase = Phase.Done;
                        return;
                    }
                    string reason;
                    if (!resolver.TryArmProbe(out reason))
                    {
                        resolver.Disarm();
                        Log("actor_arm_failed");
                        phase = Phase.Done;
                        return;
                    }
                    Log("armed_exact_actor_only");
                    if (!StandaloneTypedCommands.QueueAuto(owner, pinnedHandle))
                    {
                        resolver.Disarm();
                        Log("auto_message_queue_refused");
                        phase = Phase.Done;
                        return;
                    }
                    phaseAt = now;
                    phase = Phase.Observe;
                    Log("canned_typed_turn_queued awaiting_native_and_companion_receipts");
                    return;
                }
                if (now - phaseAt > ProbeTimeoutMs)
                {
                    resolver.Disarm();
                    Log("probe_not_verified_timeout_disarmed");
                    phase = Phase.Done;
                }
                return;
            }
            if (phase == Phase.Observe)
            {
                if (!resolver.IsPhysicalActorProofEnabled)
                {
                    resolver.Disarm();
                    Log("actor_proof_lost_disarmed");
                    phase = Phase.Done;
                    return;
                }
                if (now - phaseAt >= ObservationMs)
                {
                    resolver.Disarm();
                    Log("observation_window_ended_disarmed_check_node_receipts_not_physical_acceptance");
                    phase = Phase.Done;
                }
            }
        }
    }
}
