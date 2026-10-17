using System;
using System.Collections.Generic;
using LosSantosAlive.Audio;
using LosSantosAlive.NPC;
using Rage;
using Rage.Native;

namespace LSA.Reactions
{
    // Source of already-decoded companion frames plus a way to answer them.
    // The named-pipe implementation (ReactionChannel) is net481-only; tests use
    // an in-memory one. Nothing here ever blocks the game thread.
    public interface IReactionTransport : IDisposable
    {
        bool TryTakeFrame(out IDictionary<string, object> frame, out long receivedMs);
        bool Send(IDictionary<string, object> message);
        // Close the current connection so the companion reconnects and re-reads hello.
        void Drop();
    }

    // Game-thread executor for cosmetic conversation reactions.
    //
    // What it owns: one finite, clip-scoped upper-body/secondary-slot animation on
    // the ped that is currently speaking an Essential line, and nothing else.
    // What it never does: clear tasks, change heading/position/weapons/clothing,
    // touch gaze, lip-sync or audio, create tasks, or run any loop. If anything is
    // unclear it does nothing; after repeated native faults it disables itself.
    //
    // Threading: Essential's playback events are copied into a bounded queue and
    // only Update() (Core's owner fiber) validates peds and calls natives.
    public sealed class ReactionExecutor
    {
        sealed class PlaybackSignal
        {
            public bool Started, Interrupted;
            public Ped Speaker;
            public string PedId, TurnId;
            public long GenerationId;
        }

        sealed class Actor
        {
            public Ped Ped;
            public ulong Handle;
            public IntPtr Address;
        }

        sealed class Pending
        {
            public ReactionFrame Frame;
            public long ReceivedMs;
        }

        const int MaxSignalQueue = 32, MaxPending = 4, MaxFramesPerUpdate = 4, MaxFaults = 3;
        const int LoadTimeoutMs = 800, ResolveBudgetMs = 1600, VerifyDelayMs = 120, VerifyBudgetMs = 700;

        readonly ReactionOptions options;
        readonly IReactionTransport transport;
        readonly string hostRunId;
        readonly Func<int> worldEpoch;
        readonly Func<long> nowMs;
        readonly Func<Ped, bool> ownedBehavior;
        readonly Action<string> log;
        readonly object gate = new object();
        readonly Queue<PlaybackSignal> signals = new Queue<PlaybackSignal>();
        readonly PlaybackBook book = new PlaybackBook();
        readonly ReactionCooldowns cooldowns;
        readonly List<Pending> pending = new List<Pending>();
        readonly Dictionary<string, int> rejected = new Dictionary<string, int>();
        bool attached, disabled, overflow;
        int faults;
        string lastNative = "none";

        // The single active run and its resolve/play state.
        ReactionRun run;
        ReactionFrame runFrame;
        ReactionSpec runSpec;
        bool runInterrupted;
        int candidateIndex;
        string requestedDict;
        bool weRequestedDict, dictRequested;
        long resolveStartedMs, dictRequestedAtMs;
        string playingDict, playingClip;
        long playedAtMs;
        bool verified;

        public int Played { get; private set; }
        public int ShadowPlayed { get; private set; }
        public int Rejected(string reason) => rejected.TryGetValue(reason, out var n) ? n : 0;
        public bool Disabled => disabled;
        public bool HasActiveRun => run != null;

        public ReactionExecutor(ReactionOptions options, IReactionTransport transport, string hostRunId, Func<int> worldEpoch,
            Func<long> nowMs, Func<Ped, bool> ownedBehavior = null, Action<string> log = null)
        {
            this.options = options ?? throw new ArgumentNullException(nameof(options));
            this.transport = transport ?? throw new ArgumentNullException(nameof(transport));
            this.hostRunId = hostRunId; this.worldEpoch = worldEpoch; this.nowMs = nowMs;
            this.ownedBehavior = ownedBehavior; this.log = log ?? (_ => { });
            cooldowns = new ReactionCooldowns(options);
        }

        // ------------------------------------------------------------ lifecycle

        public void Attach()
        {
            if (attached || disabled || !options.Active) return;
            NpcPlaybackCoordinator.PlaybackStarted += OnPlaybackStarted;
            NpcPlaybackCoordinator.PlaybackEnded += OnPlaybackEnded;
            attached = true;
            log("[RX] attached mode=" + options.Mode);
        }

        void Detach()
        {
            if (!attached) return;
            attached = false;
            try { NpcPlaybackCoordinator.PlaybackStarted -= OnPlaybackStarted; } catch { }
            try { NpcPlaybackCoordinator.PlaybackEnded -= OnPlaybackEnded; } catch { }
        }

        // Called on host reload / world reset: every identity captured before it is void.
        public void WorldChanged(string reason)
        {
            try { EndRun("world_reset", true); } catch { }
            lock (gate) { signals.Clear(); overflow = false; }
            book.Clear(); pending.Clear(); cooldowns.Clear();
            try { transport.Drop(); } catch { }
            log("[RX] world_reset reason=" + reason);
        }

        public void Shutdown()
        {
            Detach();
            try { EndRun("shutdown", true); } catch { }
            lock (gate) { signals.Clear(); }
            book.Clear(); pending.Clear();
            try { transport.Dispose(); } catch { }
        }

        // ---------------------------------------------------- Essential callbacks

        void OnPlaybackStarted(NpcPlaybackStartedEvent e)
        {
            if (e == null) return;
            Enqueue(new PlaybackSignal { Started = true, Speaker = e.SpeakerPed, PedId = e.PedId, TurnId = e.TurnId, GenerationId = e.GenerationId });
        }

        void OnPlaybackEnded(NpcPlaybackEndedEvent e)
        {
            if (e == null) return;
            Enqueue(new PlaybackSignal { Started = false, Interrupted = e.WasInterrupted, Speaker = e.SpeakerPed, PedId = e.PedId, TurnId = e.TurnId, GenerationId = e.GenerationId });
        }

        void Enqueue(PlaybackSignal signal)
        {
            lock (gate)
            {
                if (signals.Count >= MaxSignalQueue) { overflow = true; signals.Clear(); return; }
                if (!overflow) signals.Enqueue(signal);
            }
        }

        // ---------------------------------------------------------------- update

        public void Update()
        {
            if (disabled || !options.Active) return;
            try
            {
                long now = nowMs();
                DrainPlayback(now);
                DrainFrames(now);
                ProcessPending(now);
                TickRun(now);
            }
            catch (Exception error)
            {
                faults++;
                log("[RX] fault " + faults + " native=" + lastNative + " type=" + error.GetType().Name);
                try { EndRun("fault", true); } catch { }
                if (faults >= MaxFaults)
                {
                    disabled = true;
                    Detach();
                    log("[RX] disabled_after_faults native=" + lastNative);
                }
            }
        }

        void Reject(string reason) { rejected[reason] = (rejected.TryGetValue(reason, out var n) ? n : 0) + 1; }

        void Answer(ReactionFrame frame, string status, string reason)
        {
            try { transport.Send(ReactionFrameCodec.Ack(frame, status, reason)); } catch { }
            if (status == "rejected" || status == "skipped") Reject(reason);
        }

        // --------------------------------------------------------- playback queue

        static bool Live(Actor actor)
        {
            try
            {
                var ped = actor?.Ped;
                return ped != null && ped.Exists() && !ped.IsDead && Convert.ToUInt64(ped.Handle) == actor.Handle && ped.MemoryAddress == actor.Address;
            }
            catch { return false; }
        }

        void DrainPlayback(long now)
        {
            PlaybackSignal[] batch; bool lost;
            lock (gate) { batch = signals.ToArray(); signals.Clear(); lost = overflow; overflow = false; }
            if (lost)
            {
                // Missed callbacks: no identity can be trusted any more.
                EndRun("callback_overflow", true);
                book.Clear(); pending.Clear();
                Reject("callback_overflow");
            }
            foreach (var signal in batch)
            {
                if (string.IsNullOrWhiteSpace(signal.PedId) || string.IsNullOrWhiteSpace(signal.TurnId) || signal.GenerationId < 0) { Reject("signal_identity_missing"); continue; }
                var key = new PlaybackKey(signal.PedId, signal.TurnId, signal.GenerationId);
                if (signal.Started)
                {
                    Actor actor = null;
                    try
                    {
                        var ped = signal.Speaker;
                        // Same check the other playback consumers use: the callback's
                        // PedId must be this live ped's handle.
                        if (ped != null && ped.Exists() && string.Equals(signal.PedId, ped.Handle.ToString(), StringComparison.Ordinal))
                        {
                            var address = ped.MemoryAddress;
                            if (address != IntPtr.Zero) actor = new Actor { Ped = ped, Handle = Convert.ToUInt64(ped.Handle), Address = address };
                        }
                    }
                    catch { actor = null; }
                    if (actor == null) { Reject("playback_ped_invalid"); continue; }
                    var entry = book.Started(key, actor, now, out var superseded);
                    if (entry == null) { Reject("playback_start_unavailable"); continue; }
                    if (superseded != null && run != null && run.Key.Equals(superseded.Key)) EndRun("superseded", true);
                }
                else
                {
                    var removed = book.Ended(key, signal.Interrupted);
                    if (removed != null && run != null && run.Key.Equals(key) && signal.Interrupted) runInterrupted = true;
                }
            }
            var expired = new List<PlaybackEntry>();
            book.Expire(now, expired);
            foreach (var entry in expired) if (run != null && run.Key.Equals(entry.Key)) runInterrupted = true;
        }

        // ------------------------------------------------------------ frame queue

        void DrainFrames(long now)
        {
            for (int i = 0; i < MaxFramesPerUpdate; i++)
            {
                if (!transport.TryTakeFrame(out var raw, out var receivedMs)) return;
                if (!ReactionFrameCodec.TryParse(raw, out var frame, out var reason)) { Reject(reason ?? "frame_invalid"); continue; }
                if (pending.Count >= MaxPending) { Answer(frame, "rejected", "pending_full"); continue; }
                pending.Add(new Pending { Frame = frame, ReceivedMs = receivedMs });
            }
        }

        void ProcessPending(long now)
        {
            if (pending.Count == 0) return;
            var snapshot = pending.ToArray();
            pending.Clear();
            foreach (var item in snapshot)
            {
                var decision = ReactionAdmission.Evaluate(options, item.Frame, hostRunId, worldEpoch(), book, cooldowns, item.ReceivedMs, now, run != null);
                if (decision.Outcome == AdmissionOutcome.Defer) { pending.Add(item); continue; }
                if (decision.Outcome == AdmissionOutcome.Reject) { Answer(item.Frame, "rejected", decision.Reason); continue; }
                var spec = ReactionCatalog.Get(item.Frame.Reaction);
                long startAt = Math.Max(now, decision.Playback.StartedMs + ReactionTiming.StartDelayMs(item.Frame.Key));
                run = new ReactionRun(item.Frame.Reaction, decision.Playback, !options.Mutates, startAt);
                runFrame = item.Frame; runSpec = spec; runInterrupted = false;
                candidateIndex = 0; dictRequested = false; requestedDict = null; weRequestedDict = false; resolveStartedMs = 0;
                playingDict = playingClip = null; verified = false;
            }
        }

        // --------------------------------------------------------------- the run

        void TickRun(long now)
        {
            if (run == null) return;
            var actor = run.Actor as Actor;
            bool playbackActive = book.Active(run.Key) != null;
            var step = run.Tick(now, playbackActive, runInterrupted, Live(actor));
            switch (step)
            {
                case RunStep.Start: Resolve(now, actor); break;
                case RunStep.Stop: EndRun(run.EndReason, true); break;
                case RunStep.Finish: EndRun("completed", true); break;
                default:
                    if (run.State == RunState.Done) EndRun(run.EndReason ?? "ended", false);
                    else if (run.State == RunState.Playing)
                    {
                        // A preflight pass is not a lasting permission to task a
                        // ped. Recheck combat, scenarios, P2/ACT ownership and
                        // exact conversation target on every active Core tick.
                        var reason = ReactionPreflight.Verdict(ReadFacts(actor.Ped), options.AllowDuringOwnedBehavior);
                        if (reason != null) EndRun("preflight_" + reason, true);
                        else if (!verified) Verify(now, actor);
                    }
                    break;
            }
        }

        void Resolve(long now, Actor actor)
        {
            if (resolveStartedMs == 0) resolveStartedMs = now;
            if (now - resolveStartedMs > ResolveBudgetMs) { Skip("clip_resolve_timeout"); return; }

            // Fresh preflight at the moment of starting, not when the frame arrived.
            var facts = ReadFacts(actor.Ped);
            string verdict = ReactionPreflight.Verdict(facts, options.AllowDuringOwnedBehavior);
            if (verdict != null) { Skip("preflight_" + verdict); return; }
            string cooldown = cooldowns.Check(run.Key.PedId, run.Reaction, now);
            if (cooldown != null) { Skip(cooldown); return; }

            var candidates = runSpec.Candidates(IsMale(actor.Ped));
            while (candidateIndex < candidates.Count)
            {
                var candidate = candidates[candidateIndex];
                if (!dictRequested)
                {
                    if (!Native<bool>("DOES_ANIM_DICT_EXIST", candidate.Dict)) { candidateIndex++; continue; }
                    if (run.Shadow)
                    {
                        // Shadow mode reads only: the dictionary exists, so a real run would try this clip.
                        cooldowns.Record(run.Key.PedId, run.Reaction, now);
                        ShadowPlayed++;
                        run.MarkPlaying(now, 1); verified = true;
                        Answer(runFrame, "shadow", "would_play");
                        log("[RX] shadow_would_play reaction=" + run.Reaction);
                        return;
                    }
                    bool loaded = Native<bool>("HAS_ANIM_DICT_LOADED", candidate.Dict);
                    requestedDict = candidate.Dict; dictRequested = true; dictRequestedAtMs = now;
                    weRequestedDict = !loaded;
                    if (!loaded) { Native<uint>("REQUEST_ANIM_DICT", candidate.Dict); return; }
                }
                if (!Native<bool>("HAS_ANIM_DICT_LOADED", candidate.Dict))
                {
                    if (now - dictRequestedAtMs <= LoadTimeoutMs) return;   // keep waiting, no blocking
                    ReleaseDict(); candidateIndex++; continue;
                }
                float seconds = Native<float>("GET_ANIM_DURATION", candidate.Dict, candidate.Clip);
                if (!(seconds > 0f)) { ReleaseDict(); candidateIndex++; continue; }

                int durationMs = Math.Min(runSpec.MaxMs, (int)(seconds * 1000f));
                // Secondary-slot, upper-body, finite. TASK_PLAY_ANIM replaces nothing
                // in the primary task slot by design (flag 32); UNVERIFIED on Enhanced,
                // which is why the next ticks confirm the clip is really playing.
                Native<uint>("TASK_PLAY_ANIM", actor.Ped, candidate.Dict, candidate.Clip, runSpec.BlendIn, runSpec.BlendOut,
                    durationMs, ReactionCatalog.PlayFlags, 0f, false, false, false);
                playingDict = candidate.Dict; playingClip = candidate.Clip; playedAtMs = now;
                cooldowns.Record(run.Key.PedId, run.Reaction, now);
                run.MarkPlaying(now, durationMs + 150);
                return;
            }
            Skip("no_clip");
        }

        void Verify(long now, Actor actor)
        {
            if (now - playedAtMs < VerifyDelayMs) return;
            bool playing = Native<bool>("IS_ENTITY_PLAYING_ANIM", actor.Ped, playingDict, playingClip, 3);
            if (playing)
            {
                verified = true; Played++;
                Answer(runFrame, "played", "ok");
                log("[RX] played reaction=" + run.Reaction);
                return;
            }
            if (now - playedAtMs > VerifyBudgetMs)
            {
                // Do not claim success because a task native accepted the call.
                run.Cancel("not_playing");
                EndRun("not_playing", true);
            }
        }

        // Ends the active run. `touchGame` is false when nothing was started.
        void EndRun(string reason, bool touchGame)
        {
            if (run == null) return;
            var finished = run; var frame = runFrame; var actor = finished.Actor as Actor;
            bool wasVerified = verified;
            try
            {
                if (touchGame && playingDict != null && actor?.Ped != null && Live(actor))
                {
                    // Clip-scoped: stops only our own animation, and only if it is still the one playing.
                    if (Native<bool>("IS_ENTITY_PLAYING_ANIM", actor.Ped, playingDict, playingClip, 3))
                        Native<uint>("STOP_ANIM_TASK", actor.Ped, playingDict, playingClip, -4f);
                }
            }
            finally
            {
                try { ReleaseDict(); } catch { }
                run = null; runFrame = null; runSpec = null; runInterrupted = false;
                playingDict = playingClip = null; verified = false; candidateIndex = 0; dictRequested = false;
                finished.Cancel(reason);
                if (frame != null && !wasVerified && reason != "completed") Answer(frame, "skipped", reason);
            }
        }

        void Skip(string reason)
        {
            run?.Cancel(reason);
            EndRun(reason, false);
        }

        void ReleaseDict()
        {
            // Only a dictionary this executor itself requested is ever released.
            if (weRequestedDict && requestedDict != null) Native<uint>("REMOVE_ANIM_DICT", requestedDict);
            weRequestedDict = false; requestedDict = null; dictRequested = false;
        }

        // ------------------------------------------------------------- game reads

        T Native<T>(string name, params object[] args)
        {
            lastNative = name;
            return NativeFunction.CallByName<T>(name, args);
        }

        bool IsMale(Ped ped)
        {
            try { return ped.IsMale; } catch { return true; }
        }

        ActorFacts ReadFacts(Ped ped)
        {
            var facts = new ActorFacts();
            facts.Exists = ped != null && ped.Exists();
            if (!facts.Exists) return facts;
            facts.Dead = ped.IsDead;
            facts.Injured = Native<bool>("IS_PED_INJURED", ped);
            Ped player = null;
            try { player = Game.LocalPlayer.Character; } catch { }
            facts.IsPlayer = player != null && ped.Equals(player);
            facts.IsHuman = NpcTargeting.IsValidHumanPed(ped);
            facts.Scripted = Native<bool>("IS_CUTSCENE_ACTIVE") || Native<bool>("IS_CUTSCENE_PLAYING") || Native<bool>("IS_PLAYER_SWITCH_IN_PROGRESS")
                || Native<bool>("GET_MISSION_FLAG") || Native<bool>("NETWORK_IS_SESSION_ACTIVE");
            facts.ConversationSpeaker = IsConversationPed(ped);
            facts.Ragdoll = Native<bool>("IS_PED_RAGDOLL", ped);
            facts.InVehicle = Native<bool>("IS_PED_IN_ANY_VEHICLE", ped, false) || Native<bool>("IS_PED_GETTING_INTO_A_VEHICLE", ped);
            facts.InCombat = Native<bool>("IS_PED_IN_MELEE_COMBAT", ped) || Native<bool>("IS_PED_SHOOTING", ped)
                || (player != null && Native<bool>("IS_PED_IN_COMBAT", ped, player));
            facts.Fleeing = Native<bool>("IS_PED_FLEEING", ped);
            facts.Armed = Native<bool>("IS_PED_ARMED", ped, 7);
            facts.UsingScenario = Native<bool>("IS_PED_USING_ANY_SCENARIO", ped);
            facts.Swimming = Native<bool>("IS_PED_SWIMMING", ped);
            facts.FallingOrClimbing = Native<bool>("IS_PED_FALLING", ped) || Native<bool>("IS_PED_JUMPING", ped) || Native<bool>("IS_PED_CLIMBING", ped);
            facts.GettingUp = Native<bool>("IS_PED_GETTING_UP", ped);
            facts.MeleeAction = Native<bool>("IS_PED_PERFORMING_MELEE_ACTION", ped);
            facts.BeingStunned = Native<bool>("IS_PED_BEING_STUNNED", ped, 0);

            var state = NpcStateStore.TryGetState(ped);
            if (state != null)
            {
                facts.InDirectedInteraction = state.InDirectedInteraction;
                facts.HasActiveReflex = state.HasActiveReflex;
                facts.HandsUp = state.HandsUpMode || state.WantsHandsUp;
                facts.KneelOrSit = state.KneelMode || state.SitOnGroundMode;
                facts.HostileMode = state.AttackPlayer || state.FleePlayer || state.TakeCoverMode || state.IntimidatePlayerWithWeapon;
                facts.HoldingItem = state.HeldItem != null && state.HeldItem.IsHoldingItem;
                facts.ActivityInProgress = state.ActivityInProgress;
                facts.OwnedBehavior = state.FollowPlayerOnFoot || state.FollowPaused || state.StopAndFaceTargetMode || state.ApproachTargetMode
                    || state.ChaseTargetMode || state.WalkAway || state.HasDestination || state.DriveToDestination || state.TurnAroundMode
                    || state.WalkBackwardsToTargetMode || state.LeanAgainstVehicleMode || state.AccompliceMode;
            }
            if (!facts.OwnedBehavior && ownedBehavior != null)
            {
                try { facts.OwnedBehavior = ownedBehavior(ped); } catch { facts.OwnedBehavior = true; /* unknown ownership is never idle */ }
            }
            return facts;
        }

        // Same notion of "the conversation NPC" the conversation-gaze contract uses.
        static bool IsConversationPed(Ped ped)
        {
            try
            {
                var conversation = NpcTargeting.GetPlayerConversationPed();
                if (conversation != null && conversation.Exists() && ped.Equals(conversation)) return true;
                var speaker = NpcTargeting.GetCurrentSpeakerPed();
                return speaker != null && speaker.Exists() && ped.Equals(speaker);
            }
            catch { return false; }
        }
    }
}
