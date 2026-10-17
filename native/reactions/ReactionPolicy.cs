using System;
using System.Collections.Generic;

namespace LSA.Reactions
{
    // ---------------------------------------------------------------------
    // Everything below is pure (no RAGE, no Essential, no clock of its own):
    // times are monotonic milliseconds supplied by the caller, so the same code
    // runs in the offline tests and in the game.
    // ---------------------------------------------------------------------

    public sealed class PlaybackEntry
    {
        public PlaybackKey Key;
        public object Actor;          // retained RAGE ped (opaque here)
        public long StartedMs;
        public bool Interrupted;      // set only by an interrupted END for this exact key
    }

    // Essential playbacks that really started and have not ended, keyed by ped.
    // A start for a new tuple supersedes the old one for that ped; an end only
    // ever removes the exact tuple it names (a late end from turn A can never
    // end turn B).
    public sealed class PlaybackBook
    {
        public const int Capacity = 8;
        public const long MaxAgeMs = 180000; // missing-terminal safety net
        readonly Dictionary<string, PlaybackEntry> byPed = new Dictionary<string, PlaybackEntry>();
        // Keep a bounded high-watermark even after playback ends. Otherwise a
        // delayed old START can resurrect a spent turn after the newer END.
        readonly Dictionary<string, PlaybackKey> latestByPed = new Dictionary<string, PlaybackKey>();
        readonly Queue<PlaybackKey> latestOrder = new Queue<PlaybackKey>();
        const int MaxHistory = 512;
        public int Count => byPed.Count;

        public PlaybackEntry Started(PlaybackKey key, object actor, long nowMs, out PlaybackEntry superseded)
        {
            superseded = null;
            if (key == null || key.PedId == null) return null;
            if (byPed.TryGetValue(key.PedId, out var existing))
            {
                if (existing.Key.Equals(key)) return existing; // duplicate start is idempotent
            }
            // Equal-generation, different-turn claims are ambiguous; older
            // generations can never displace a newer speaker, even after END.
            if (latestByPed.TryGetValue(key.PedId, out var latest) &&
                key.GenerationId <= latest.GenerationId) return null;
            if (existing != null) superseded = existing;
            else if (byPed.Count >= Capacity) return null;      // fail closed
            var entry = new PlaybackEntry { Key = key, Actor = actor, StartedMs = nowMs };
            byPed[key.PedId] = entry;
            latestByPed[key.PedId] = key;
            latestOrder.Enqueue(key);
            while (latestOrder.Count > MaxHistory)
            {
                var old = latestOrder.Dequeue();
                if (latestByPed.TryGetValue(old.PedId, out var kept) && kept.Equals(old))
                    latestByPed.Remove(old.PedId);
            }
            return entry;
        }

        // Returns the removed entry only when `key` is exactly the active tuple.
        public PlaybackEntry Ended(PlaybackKey key, bool interrupted)
        {
            if (key == null || key.PedId == null) return null;
            if (!byPed.TryGetValue(key.PedId, out var entry) || !entry.Key.Equals(key)) return null;
            byPed.Remove(key.PedId);
            entry.Interrupted = interrupted;
            return entry;
        }

        public PlaybackEntry Active(PlaybackKey key) =>
            key != null && key.PedId != null && byPed.TryGetValue(key.PedId, out var entry) && entry.Key.Equals(key) ? entry : null;

        public void Expire(long nowMs, List<PlaybackEntry> expired)
        {
            List<string> stale = null;
            foreach (var pair in byPed)
                if (nowMs - pair.Value.StartedMs > MaxAgeMs) (stale ?? (stale = new List<string>())).Add(pair.Key);
            if (stale == null) return;
            foreach (var id in stale) { expired?.Add(byPed[id]); byPed.Remove(id); }
        }

        public void Clear() { byPed.Clear(); latestByPed.Clear(); latestOrder.Clear(); }
    }

    public sealed class ReactionOptions
    {
        public string Mode = "off";                    // off | shadow | on
        public int GlobalCooldownMs = 12000;           // any reaction, any ped
        public int PedCooldownMs = 20000;              // any reaction, same ped
        public int SameReactionMs = 60000;             // same reaction, same ped
        public int FrameFreshMs = 3000;                // frame must be processed this soon after receipt
        public int PendingMs = 1500;                   // wait this long for native's own playback record
        public int MaxLateStartMs = 4000;              // never start a gesture this far into a line
        public bool AllowDuringOwnedBehavior = false;  // follow/wait/sit/activity owners
        public bool Diagnostics = false;               // literal true: read-only [RX] probe/clip lines
        public readonly HashSet<string> Disabled = new HashSet<string>();
        // Opt-in reactions (ReactionSpec.OptIn) run only when listed here.
        public readonly HashSet<string> Enabled = new HashSet<string>();
        public bool Active => Mode == "shadow" || Mode == "on";
        public bool Mutates => Mode == "on";
    }

    public sealed class ReactionCooldowns
    {
        const int MaxEntries = 64;
        readonly ReactionOptions options;
        readonly Dictionary<string, long> lastByPed = new Dictionary<string, long>();
        readonly Dictionary<string, long> lastByPedReaction = new Dictionary<string, long>();
        long lastGlobal; bool hasGlobal;
        public ReactionCooldowns(ReactionOptions options) { this.options = options; }

        public string Check(string pedId, string reaction, long nowMs)
        {
            if (hasGlobal && nowMs - lastGlobal < options.GlobalCooldownMs) return "global_cooldown";
            if (lastByPed.TryGetValue(pedId, out var ped) && nowMs - ped < options.PedCooldownMs) return "ped_cooldown";
            if (lastByPedReaction.TryGetValue(pedId + "|" + reaction, out var same) && nowMs - same < options.SameReactionMs) return "reaction_cooldown";
            return null;
        }

        public void Record(string pedId, string reaction, long nowMs)
        {
            hasGlobal = true; lastGlobal = nowMs;
            lastByPed[pedId] = nowMs;
            lastByPedReaction[pedId + "|" + reaction] = nowMs;
            Prune(nowMs);
        }

        void Prune(long nowMs)
        {
            Trim(lastByPed, nowMs, options.PedCooldownMs);
            Trim(lastByPedReaction, nowMs, options.SameReactionMs);
        }

        static void Trim(Dictionary<string, long> map, long nowMs, int windowMs)
        {
            if (map.Count <= MaxEntries) return;
            var drop = new List<string>();
            foreach (var pair in map) if (nowMs - pair.Value >= windowMs) drop.Add(pair.Key);
            foreach (var key in drop) map.Remove(key);
            // Still over the bound: forget the oldest. A forgotten cooldown only
            // allows a reaction slightly sooner, never a stale ped to act.
            while (map.Count > MaxEntries)
            {
                string oldest = null; long at = long.MaxValue;
                foreach (var pair in map) if (pair.Value < at) { at = pair.Value; oldest = pair.Key; }
                map.Remove(oldest);
            }
        }

        public void Clear() { lastByPed.Clear(); lastByPedReaction.Clear(); hasGlobal = false; }
    }

    public enum AdmissionOutcome { Admit, Defer, Reject }

    public sealed class AdmissionDecision
    {
        public AdmissionOutcome Outcome;
        public string Reason;
        public PlaybackEntry Playback;
    }

    // Frame-level admission. A frame is only a request: it is honored solely if
    // native itself observed this exact playback start, the host run and world
    // epoch still match, nothing else is animating, and cooldowns allow it.
    public static class ReactionAdmission
    {
        public static AdmissionDecision Evaluate(ReactionOptions options, ReactionFrame frame, string hostRunId, int worldEpoch,
            PlaybackBook book, ReactionCooldowns cooldowns, long receivedMs, long nowMs, bool reactionActive)
        {
            Func<string, AdmissionDecision> reject = reason => new AdmissionDecision { Outcome = AdmissionOutcome.Reject, Reason = reason };
            if (options == null || !options.Active) return reject("mode_off");
            if (frame == null) return reject("frame_invalid");
            if (frame.HostRunId != hostRunId || frame.WorldEpoch != worldEpoch) return reject("host_mismatch");
            if (!ReactionCatalog.IsKnown(frame.Reaction)) return reject("unknown_reaction");
            if (options.Disabled.Contains(frame.Reaction)) return reject("reaction_disabled");
            if (ReactionCatalog.Get(frame.Reaction).OptIn && !options.Enabled.Contains(frame.Reaction)) return reject("reaction_not_enabled");
            long age = nowMs - receivedMs;
            if (age > options.FrameFreshMs) return reject("stale_frame");
            var playback = book.Active(frame.Key);
            if (playback == null)
                return age <= options.PendingMs ? new AdmissionDecision { Outcome = AdmissionOutcome.Defer, Reason = "awaiting_playback" } : reject("no_active_playback");
            if (nowMs - playback.StartedMs > options.MaxLateStartMs) return reject("playback_too_far_along");
            if (reactionActive) return reject("busy");
            string cooldown = cooldowns.Check(frame.Key.PedId, frame.Reaction, nowMs);
            if (cooldown != null) return reject(cooldown);
            return new AdmissionDecision { Outcome = AdmissionOutcome.Admit, Reason = "admitted", Playback = playback };
        }
    }

    public static class ReactionTiming
    {
        // Deterministic 500..1199 ms offset into the line, derived from the turn
        // identity (FNV-1a). No randomness, so a replay behaves identically.
        public static int StartDelayMs(PlaybackKey key) => StartDelayMs(key, 500, 700);

        // Per-reaction window (ReactionSpec.StartMinMs/StartSpanMs); same hash.
        public static int StartDelayMs(PlaybackKey key, ReactionSpec spec) =>
            spec == null ? StartDelayMs(key) : StartDelayMs(key, spec.StartMinMs, spec.StartSpanMs);

        static int StartDelayMs(PlaybackKey key, int minMs, int spanMs)
        {
            unchecked
            {
                uint hash = 2166136261;
                foreach (char c in key.TurnId + ":" + key.GenerationId) { hash ^= c; hash *= 16777619; }
                return minMs + (int)(hash % (uint)spanMs);
            }
        }
    }

    public enum RunState { Waiting, Playing, Done }
    public enum RunStep { None, Start, Stop, Finish }

    // Lifecycle of the single reaction that may be active at a time. The
    // executor performs the effects; this class only decides what is due.
    public sealed class ReactionRun
    {
        public readonly string Reaction;
        public readonly PlaybackKey Key;
        public readonly object Actor;
        public readonly bool Shadow;
        public readonly long StartAtMs;
        public RunState State { get; private set; }
        public long ExpiresAtMs { get; private set; }
        public string EndReason { get; private set; }

        public ReactionRun(string reaction, PlaybackEntry playback, bool shadow, long startAtMs)
        {
            Reaction = reaction; Key = playback.Key; Actor = playback.Actor; Shadow = shadow; StartAtMs = startAtMs; State = RunState.Waiting;
        }

        public void MarkPlaying(long nowMs, int durationMs) { State = RunState.Playing; ExpiresAtMs = nowMs + Math.Max(1, durationMs); }
        public void Cancel(string reason) { if (State != RunState.Done) { State = RunState.Done; EndReason = reason; } }

        // `playbackActive`: native still considers this exact playback live.
        // `interrupted`: its END arrived with WasInterrupted. A normal end during
        // a gesture lets the short finite clip finish; an interruption stops it.
        public RunStep Tick(long nowMs, bool playbackActive, bool interrupted, bool actorValid)
        {
            if (State == RunState.Done) return RunStep.None;
            bool playing = State == RunState.Playing;
            if (!actorValid) { State = RunState.Done; EndReason = "actor_invalid"; return playing ? RunStep.Stop : RunStep.None; }
            if (interrupted) { State = RunState.Done; EndReason = "interrupted"; return playing ? RunStep.Stop : RunStep.None; }
            if (!playing)
            {
                if (!playbackActive) { State = RunState.Done; EndReason = "playback_ended"; return RunStep.None; }
                return nowMs >= StartAtMs ? RunStep.Start : RunStep.None;
            }
            if (nowMs >= ExpiresAtMs) { State = RunState.Done; EndReason = "completed"; return RunStep.Finish; }
            return RunStep.None;
        }
    }

    // Read-only facts about the speaking ped, gathered by the executor on the
    // game thread. The verdict is pure so the table is testable.
    public sealed class ActorFacts
    {
        public bool Exists = true, Dead, Injured, IsPlayer, IsHuman = true, Ragdoll, InVehicle, InCombat, Fleeing, Armed,
            UsingScenario, Swimming, FallingOrClimbing, GettingUp, MeleeAction, BeingStunned, Scripted,
            InDirectedInteraction, HasActiveReflex, HandsUp, KneelOrSit, HostileMode, HoldingItem, ActivityInProgress,
            ConversationSpeaker = true, OwnedBehavior;
    }

    public static class ReactionPreflight
    {
        // null = clear to react. Any reason means "do nothing and stay out of the way".
        public static string Verdict(ActorFacts f, bool allowOwnedBehavior)
        {
            if (f == null || !f.Exists) return "actor_missing";
            if (f.Dead) return "dead";
            if (f.Injured) return "injured";
            if (f.IsPlayer) return "player";
            if (!f.IsHuman) return "not_human";
            if (f.Scripted) return "scripted";
            if (!f.ConversationSpeaker) return "not_conversation_speaker";
            if (f.Ragdoll) return "ragdoll";
            if (f.InVehicle) return "in_vehicle";
            if (f.InCombat) return "in_combat";
            if (f.Fleeing) return "fleeing";
            if (f.Armed) return "armed";
            if (f.UsingScenario) return "scenario";
            if (f.Swimming) return "swimming";
            if (f.FallingOrClimbing) return "falling_or_climbing";
            if (f.GettingUp) return "getting_up";
            if (f.MeleeAction) return "melee";
            if (f.BeingStunned) return "stunned";
            if (f.InDirectedInteraction) return "directed_interaction";
            if (f.HasActiveReflex) return "reflex";
            if (f.HandsUp) return "hands_up";
            if (f.KneelOrSit) return "kneel_or_sit";
            if (f.HostileMode) return "hostile_mode";
            if (f.HoldingItem) return "holding_item";
            if (f.ActivityInProgress) return "activity";
            if (f.OwnedBehavior && !allowOwnedBehavior) return "owned_behavior";
            return null;
        }
    }
}
