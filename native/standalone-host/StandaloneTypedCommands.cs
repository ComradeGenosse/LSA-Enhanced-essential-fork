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
        }
        private static readonly ConcurrentQueue<QueuedText> pending =
            new ConcurrentQueue<QueuedText>();
        private static readonly StandaloneOnscreenInput keyboard = new StandaloneOnscreenInput();
        private static int queued;

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
            keyboard.RequestOpen();
            Game.Console.Print("LSA standalone: keyboard requested.");
        }

        private static void Enqueue(string phrase)
        {
            if (!Valid(phrase))
            {
                Game.Console.Print("LSA standalone: enter 1-1024 printable characters.");
                return;
            }
            if (Interlocked.Increment(ref queued) > Capacity)
            {
                Interlocked.Decrement(ref queued);
                Game.Console.Print("LSA standalone: typed input queue full.");
                return;
            }
            pending.Enqueue(new QueuedText { Text = phrase, SourceTick = Stopwatch.GetTimestamp() });
            Game.Console.Print("LSA standalone: input queued for native validation.");
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
            while (pending.TryDequeue(out _)) Interlocked.Decrement(ref queued);
        }

        public static void StopOnOwner(OwnerScope scope)
        {
            keyboard.StopOnOwner(scope);
            Clear();
        }

        // ONLY the owning game fiber calls Pump, within its synchronous scope.
        public static void Pump(OwnerScope scope, RageActorResolver resolver,
            NativeAuthority authority, NativeTurnRegistry turns, StandalonePipeServer server)
        {
            if (scope == null || !scope.IsOwner)
                throw new InvalidOperationException("owner_scope_required");
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

            Ped target = NearestPedAhead();
            if (target == null)
            {
                Game.Console.Print("LSA standalone: no_eligible_nearby_target.");
                return;
            }

            int handle = unchecked((int)target.Handle.Value);
            ActorObservation current;
            if (!resolver.TryObserve(handle, out current) &&
                !resolver.TryAdoptVerifiedPed(handle))
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
            Game.Console.Print("LSA standalone: typed turn offered; playback not available yet.");
        }

        private static Ped NearestPedAhead()
        {
            try
            {
                Ped player = Game.LocalPlayer.Character;
                if (player == null || !player.Exists() || player.IsDead) return null;
                var forward = player.GetOffsetPositionFront(2.0f);
                Ped winner = null;
                float nearest = 4.0f;
                foreach (Ped ped in player.GetNearbyPeds(16))
                {
                    if (ped == null || ped == player || !ped.Exists() || ped.IsDead)
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
