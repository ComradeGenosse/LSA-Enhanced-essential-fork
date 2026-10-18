using System;
using LosSantosAlive.Context;
using LosSantosAlive.Integrations;
using Rage;

namespace LSA.Reactions
{
    // Thin Essential integration that gives ReactionExecutor an Update() tick on
    // Core's own update path. It creates no fiber of its own, owns no ped task,
    // and does nothing at all unless native config sets reactions.mode to
    // "shadow" or "on".
    public sealed class ReactionIntegration : IIntegration
    {
        readonly ReactionOptions options;
        readonly string pipeName, hostRunId;
        readonly Func<int> worldEpoch;
        readonly Func<long> nowMs;
        readonly Func<Ped, bool> ownedBehavior;
        ReactionChannel channel;
        ReactionExecutor executor;
        readonly object requestsGate = new object();
        string pendingWorldReason;
        volatile bool shutdownRequested;
        bool started, stopped;

        public ReactionIntegration(ReactionOptions options, string pipeName, string hostRunId, Func<int> worldEpoch, Func<long> nowMs, Func<Ped, bool> ownedBehavior = null)
        {
            this.options = options ?? throw new ArgumentNullException(nameof(options));
            this.pipeName = pipeName; this.hostRunId = hostRunId; this.worldEpoch = worldEpoch; this.nowMs = nowMs; this.ownedBehavior = ownedBehavior;
        }

        public string Id => "conversationReactions";
        public bool IsAvailable => started && !stopped;

        public void Initialize()
        {
            if (started || stopped || !options.Active) return;
            try
            {
                channel = new ReactionChannel(pipeName, options.Mode, hostRunId, worldEpoch, nowMs);
                executor = new ReactionExecutor(options, channel, hostRunId, worldEpoch, nowMs, ownedBehavior, Log);
                executor.Attach();
                channel.Start();
                started = true;
                Log("[RX] reactions_loaded mode=" + options.Mode);
            }
            catch
            {
                Shutdown();
                Log("[RX] optional_initialization_failed");
            }
        }

        // The host lifetime fiber and WorldChanged callbacks never invoke animation
        // natives. Core's Update is the sole owner of clip stop, release and state.
        public void Update()
        {
            if (!started || stopped) return;
            if (shutdownRequested) { Shutdown(); return; }
            string reason;
            lock (requestsGate) { reason = pendingWorldReason; pendingWorldReason = null; }
            if (reason != null) executor.WorldChanged(reason);
            if (shutdownRequested) { Shutdown(); return; }
            executor.Update();
        }

        // May be called from HostContext's producer callback, including outside
        // Core. Fence incoming frames now, defer all ped/native work to Update().
        public void WorldChanged(string reason)
        {
            if (!started || stopped) return;
            lock (requestsGate) pendingWorldReason = reason ?? "unspecified";
            try { channel?.Drop(); } catch { }
        }

        // Requested from RuntimeEntry's lifetime fiber; do not call Shutdown()
        // here, because its EndRun can execute STOP_ANIM_TASK/REMOVE_ANIM_DICT.
        public void RequestShutdown()
        {
            shutdownRequested = true;
            try { channel?.Drop(); } catch { }
        }

        public void Shutdown()
        {
            if (stopped) return;
            stopped = true;
            shutdownRequested = true;
            try { executor?.Shutdown(); } catch { }
            try { channel?.Dispose(); } catch { }
        }

        public void EnrichActor(Ped ped, ActorContext context) { }
        public void OnPedControlChanged(Ped ped, bool controlledByLsa) { }
        public void OnNpcActionExecuted(Ped ped, string actionName, bool succeeded) { }

        static void Log(string message) { try { Game.LogTrivial(message); } catch { } }
    }
}
