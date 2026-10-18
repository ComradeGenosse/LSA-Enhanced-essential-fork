using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using LSA.Standalone;
using Rage;
using Rage.Attributes;

namespace LSA.Standalone.RageHost
{
    // ConsoleCommand is discovered by RPH when this independent plugin loads.
    // The console callback may be on a different RPH fiber, so it ONLY queues
    // validated user text. It never touches Ped, NativeAuthority, or RAGE natives.
    internal static class StandaloneTypedCommands
    {
        private const int Capacity = 8;
        private const int MaxText = 1024;
        private sealed class QueuedText
        {
            public string Text;
            public long SourceTick;
            public int PinnedHandle;
        }
        private static readonly ConcurrentQueue<QueuedText> pending =
            new ConcurrentQueue<QueuedText>();
        private static readonly StandaloneOnscreenInput keyboard = new StandaloneOnscreenInput();
        private static int queued;
        private static int accepting;
        private static int typedAllowed;
        private static int probeRequested, armRequested, disarmRequested, diagnosticRequested;

        public static void OpenAdmission(bool typedEnabled = true)
        {
            // Probe/status remain accessible; typing is separately disabled at native admission.
            Clear();
            Volatile.Write(ref typedAllowed, typedEnabled ? 1 : 0);
            Volatile.Write(ref accepting, 1);
        }

        public static void CloseAdmission()
        {
            Volatile.Write(ref accepting, 0);
            Volatile.Write(ref typedAllowed, 0);
            Clear();
        }

        [ConsoleCommand(Name = "LSAStandaloneProbe",
            Description = "Probe nearest NPC decorator and entity identity (no conversation).")]
        public static void Probe() { Interlocked.Exchange(ref probeRequested, 1); }

        [ConsoleCommand(Name = "LSAStandaloneArm",
            Description = "Arm only the probed NPC after GTA runtime identity test passes.")]
        public static void Arm() { Interlocked.Exchange(ref armRequested, 1); }

        [ConsoleCommand(Name = "LSAStandaloneDisarm",
            Description = "Immediately disarm experimental standalone actor adoption.")]
        public static void Disarm() { Interlocked.Exchange(ref disarmRequested, 1); }

        [ConsoleCommand(Name = "LSAStandaloneStatus",
            Description = "Print the current standalone diagnostic and adoption gate state.")]
        public static void Status() { Interlocked.Exchange(ref diagnosticRequested, 1); }

        [ConsoleCommand(Name = "LSAStandaloneAsk",
            Description = "Ask the nearest pedestrian ahead (standalone; requires verified GTA actor lifecycle).")]
        public static void Ask(string phrase)
        {
            if (phrase != null && phrase.Length >= 2 &&
                phrase[0] == '"' && phrase[phrase.Length - 1] == '"')
                phrase = phrase.Substring(1, phrase.Length - 2);
            Enqueue(phrase);
        }

        [ConsoleCommand(Name = "LSAStandaloneCompose",
            Description = "Open GTA's native text keyboard for a standalone NPC conversation.")]
        public static void Compose()
        {
            if (Volatile.Read(ref accepting) == 0 ||
                Volatile.Read(ref typedAllowed) == 0)
            {
                Game.Console.Print("LSA standalone: typed_capability_disabled_or_host_not_ready.");
                return;
            }
            keyboard.RequestOpen();
            Game.Console.Print("LSA standalone: keyboard requested.");
        }

        private static void Enqueue(string phrase)
        {
            EnqueueCore(phrase, 0);
        }

        // Only the native owner fiber's explicit auto-smoke controller may
        // submit a canned phrase bound to the previously verified actor.
        // This never grants a lease or bypasses probe/arm/native checks.
        internal static bool QueueAuto(OwnerScope owner, int pinnedHandle)
        {
            if (owner == null || !owner.IsOwner || pinnedHandle <= 0)
                return false;
            return EnqueueCore("Hello! Please respond with a short friendly greeting.", pinnedHandle);
        }

        private static bool EnqueueCore(string phrase, int pinnedHandle)
        {
            if (Volatile.Read(ref accepting) == 0 ||
                Volatile.Read(ref typedAllowed) == 0)
            {
                Game.Console.Print("LSA standalone: typed_capability_disabled_or_host_not_ready.");
                return false;
            }
            if (!Valid(phrase))
            {
                Game.Console.Print("LSA standalone: enter 1-1024 printable characters.");
                return false;
            }
            if (Interlocked.Increment(ref queued) > Capacity)
            {
                Interlocked.Decrement(ref queued);
                Game.Console.Print("LSA standalone: typed input queue full.");
                return false;
            }
            pending.Enqueue(new QueuedText {
                Text = phrase, SourceTick = Stopwatch.GetTimestamp(), PinnedHandle = pinnedHandle
            });
            Game.Console.Print("LSA standalone: input queued for native validation.");
            return true;
        }

        private static bool Valid(string phrase)
        {
            if (string.IsNullOrWhiteSpace(phrase) || phrase.Length > MaxText) return false;
            for (int i = 0; i < phrase.Length; i++)
            {
                char ch = phrase[i];
                if (char.IsControl(ch) || ch == '\uFFFD') return false;
                if (char.IsHighSurrogate(ch))
                {
                    if (i + 1 >= phrase.Length || !char.IsLowSurrogate(phrase[i + 1]))
                        return false;
                    i++;
                }
                else if (char.IsLowSurrogate(ch)) return false;
            }
            return true;
        }

        public static void Clear()
        {
            keyboard.ClearAdmission();
            Interlocked.Exchange(ref probeRequested, 0);
            Interlocked.Exchange(ref armRequested, 0);
            Interlocked.Exchange(ref disarmRequested, 0);
            Interlocked.Exchange(ref diagnosticRequested, 0);
            while (pending.TryDequeue(out _)) Interlocked.Decrement(ref queued);
        }

        public static void StopOnOwner(OwnerScope scope)
        {
            keyboard.StopOnOwner(scope);
            CloseAdmission();
        }

        // ONLY the owning game fiber calls Pump, within its synchronous scope.
        public static void Pump(OwnerScope scope, RageActorResolver resolver,
            NativeAuthority authority, NativeTurnRegistry turns, StandalonePipeServer server)
        {
            if (scope == null || !scope.IsOwner)
                throw new InvalidOperationException("owner_scope_required");
            if (Volatile.Read(ref accepting) == 0) return;
            // Console callbacks only enqueue intent; every decorator/Ped
            // operation is serialized on the RPH owner game fiber.
            if (Interlocked.Exchange(ref disarmRequested, 0) == 1)
            {
                resolver.Disarm();
                Game.Console.Print("LSA standalone: adoption_disarmed.");
            }
            if (Interlocked.Exchange(ref probeRequested, 0) == 1)
            {
                bool safeWorld = false;
                try { safeWorld = new RageWorld().AllowsNpcControl; } catch {}
                Ped candidate = safeWorld ? NearestPedAhead() : null;
                string probeReason;
                if (!safeWorld)
                    Game.Console.Print("LSA standalone: world_unsafe_for_probe.");
                else if (candidate == null)
                    Game.Console.Print("LSA standalone: probe_no_eligible_target.");
                else if (!resolver.TryBeginProbe(unchecked((int)candidate.Handle.Value),
                    out probeReason))
                    Game.Console.Print("LSA standalone: " + probeReason + ".");
                else
                {
                    Game.Console.Print("LSA standalone: probe_started; keep NPC in view, then run LSAStandaloneStatus.");
                    Game.LogTrivial("[LSA-ACTOR] probe_started " + resolver.DiagnosticState);
                }
            }
            string probeEvent = resolver.TickProbe();
            if (probeEvent != null)
            {
                Game.Console.Print("LSA standalone: " + probeEvent + ".");
                Game.LogTrivial("[LSA-ACTOR] " + probeEvent + " " + resolver.DiagnosticState);
            }
            if (Interlocked.Exchange(ref armRequested, 0) == 1)
            {
                bool safeWorld = false;
                try { safeWorld = new RageWorld().AllowsNpcControl; } catch {}
                string armReason = "world_unsafe_for_arm";
                bool ok = safeWorld && resolver.TryArmProbe(out armReason);
                Game.Console.Print("LSA standalone: " + armReason + ".");
                Game.LogTrivial("[LSA-ACTOR] " + armReason + " " + resolver.DiagnosticState);
            }
            if (Interlocked.Exchange(ref diagnosticRequested, 0) == 1)
                Game.Console.Print("LSA standalone: " + resolver.DiagnosticState + " " + EntryPoint.ActivationSummary);
            if (Volatile.Read(ref typedAllowed) == 0) return;
            keyboard.Tick(scope, Enqueue);
            if (!pending.TryDequeue(out QueuedText entry)) return;
            Interlocked.Decrement(ref queued);
            // Console input is not a persistent command queue. If the player
            // moves away during a load/stall, refuse instead of targeting a
            // different ped long after their request.
            long ageTicks = Stopwatch.GetTimestamp() - entry.SourceTick;
            if (ageTicks < 0 || ageTicks > (long)Stopwatch.Frequency * 2)
            {
                Game.Console.Print("LSA standalone: typed_input_expired.");
                return;
            }
            string phrase = entry.Text;

            // Absolutely no tentative claim if the actual GTA decorator
            // adoption proof has not been approved and explicitly enabled.
            if (!resolver.IsPhysicalActorProofEnabled)
            {
                Game.Console.Print("LSA standalone: actor_lifetime_gate_closed.");
                return;
            }

            Ped target = entry.PinnedHandle != 0
                ? World.GetEntityByHandle<Ped>(new PoolHandle(unchecked((uint)entry.PinnedHandle)))
                : NearestPedAhead();
            if (entry.PinnedHandle != 0)
            {
                Ped player = Game.LocalPlayer.Character;
                // Even an automation PIN cannot follow a moving NPC or
                // resurrect a previous handle outside the local test radius.
                if (player == null || !RphPedValidity.Exists(player) || player.IsDead ||
                    target == null || !RphPedValidity.Exists(target) || target.IsDead ||
                    target == player || target.DistanceTo(player) >= 4.0f)
                {
                    Game.LogTrivial("[LSA-AUTOSMOKE] pinned_actor_no_longer_eligible");
                    return;
                }
            }
            if (target == null)
            {
                Game.Console.Print("LSA standalone: no_eligible_nearby_target.");
                return;
            }

            int handle = unchecked((int)target.Handle.Value);
            ActorObservation current;
            if (!resolver.TryAdoptVerifiedPed(handle) ||
                !resolver.TryObserve(handle, out current))
            {
                Game.Console.Print("LSA standalone: actor_identity_unverified.");
                return;
            }
            if (!authority.TryRegister(handle, out ActorRef actor, out string reason))
            {
                Game.Console.Print("LSA standalone: actor_refused.");
                return;
            }

            turns.DiscardStagedForActor(actor); // Not playback success.
            if (!turns.TryIssueTyped(actor, phrase, 45000, out NativeTurnPermit permit, out reason))
            {
                Game.Console.Print("LSA standalone: conversation_busy_or_unsafe.");
                return;
            }
            if (!server.Offer(permit))
            {
                turns.TryRetireOfferedPermit(permit);
                Game.Console.Print("LSA standalone: companion_unavailable.");
                return;
            }
            Game.Console.Print("LSA standalone: typed turn offered to Luna; see companion and listen for output.");
            Game.LogTrivial("[LSA-ACTOR] native_typed_offer actor_handle=" + handle +
                " turn_ordinal=" + permit.TurnOrdinal + " result=offered");
            if (entry.PinnedHandle != 0)
                Game.LogTrivial("[LSA-AUTOSMOKE] native_typed_offer_created awaiting_companion_receipts");
        }

        private static Ped NearestPedAhead()
        {
            try
            {
                Ped player = Game.LocalPlayer.Character;
                if (player == null || !RphPedValidity.Exists(player) || player.IsDead) return null;
                var forward = player.GetOffsetPositionFront(2.0f);
                Ped winner = null;
                float nearest = 4.0f;
                foreach (Ped ped in player.GetNearbyPeds(16))
                {
                    if (ped == null || ped == player || !RphPedValidity.Exists(ped) || ped.IsDead)
                        continue;
                    float distance = ped.DistanceTo(player);
                    if (distance < 0.75f || distance >= nearest) continue;
                    // Strict forward hemisphere, not arbitrary nearest behind.
                    if (ped.DistanceTo(forward) >= distance) continue;
                    winner = ped;
                    nearest = distance;
                }
                return winner;
            }
            catch { return null; }
        }
    }
}
