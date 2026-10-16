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

        public void Update() { if (started && !stopped) executor.Update(); }

        // Wired by the host to HostContext.WorldChanged.
        public void WorldChanged(string reason) { if (started && !stopped) executor.WorldChanged(reason); }

        public void Shutdown()
        {
            if (stopped) return;
            stopped = true;
            try { executor?.Shutdown(); } catch { }
            try { channel?.Dispose(); } catch { }
        }

        public void EnrichActor(Ped ped, ActorContext context) { }
        public void OnPedControlChanged(Ped ped, bool controlledByLsa) { }
        public void OnNpcActionExecuted(Ped ped, string actionName, bool succeeded) { }

        static void Log(string message) { try { Game.LogTrivial(message); } catch { } }
    }
}
