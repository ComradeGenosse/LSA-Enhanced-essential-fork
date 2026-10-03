using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using LosSantosAlive.Context;
using LosSantosAlive.Integrations;
using Rage;

namespace LSA.SessionIdentity
{
    public interface ICharacterIdentitySource
    {
        RegistrationToken Register(Ped ped, string sourceKey, string worldProfileId);
        bool Retire(RegistrationToken token);
        bool TryResolveCurrent(Ped ped, out NativeIdentityClaim claim);
    }
    public sealed class ExplicitCharacterSource : ICharacterIdentitySource
    {
        readonly NativeIdentityEvidenceStore store;
        internal ExplicitCharacterSource(NativeIdentityEvidenceStore store) { this.store = store; }
        public RegistrationToken Register(Ped ped, string sourceKey, string worldProfileId)
        {
            if (ped == null || !ped.Exists() || ped.IsDead) throw new ArgumentException("Current owner ped required.");
            string handle = ped.Handle.ToString();
            return store.Register(handle, sourceKey, worldProfileId, () => ped.Exists() && !ped.IsDead && ped.Handle.ToString() == handle);
        }
        public bool Retire(RegistrationToken token) => store.Retire(token);
        public bool TryResolveCurrent(Ped ped, out NativeIdentityClaim claim)
        {
            claim = null;
            return ped != null && ped.Exists() && !ped.IsDead && store.TryResolveCurrent(ped.Handle.ToString(), Game.GameTime, out claim) == "active";
        }
    }
    public sealed class SessionIdentityIntegration : IIntegration
    {
        static SessionIdentityIntegration installed;
        NativeIdentityEvidenceStore store;
        OwnerFactChannel channel;
        long lastGameTime;
        readonly Stopwatch heartbeat = new Stopwatch();
        readonly Stopwatch diagnosticsClock = Stopwatch.StartNew();
        readonly string pipeName;
        long updateCalls, completedUpdates, lastUpdateMs = -1, lastCompletedMs = -1;
        int creationThreadId, lastUpdateThreadId;
        string lastShutdownReason = "none", lastUpdateFailure = "none";
        public string Id => "sessionIdentity";
        public bool IsAvailable => store != null;
        public ExplicitCharacterSource Owner { get; private set; }
        public string DiagnosticsStatus() => "identity_available=" + IsAvailable +
            " identity_update_calls=" + Interlocked.Read(ref updateCalls) +
            " identity_update_completed=" + Interlocked.Read(ref completedUpdates) +
            " identity_last_update_age_ms=" + Age(Interlocked.Read(ref lastUpdateMs)) +
            " identity_last_completed_age_ms=" + Age(Interlocked.Read(ref lastCompletedMs)) +
            " identity_last_game_tick=" + lastGameTime +
            " identity_creation_thread=" + creationThreadId +
            " identity_update_thread=" + lastUpdateThreadId +
            " identity_shutdown_reason=" + lastShutdownReason +
            " identity_update_failure=" + lastUpdateFailure;
        long Age(long stamp) => stamp < 0 ? int.MaxValue : Math.Min(int.MaxValue, diagnosticsClock.ElapsedMilliseconds - stamp);
        static void Log(string message) { try { Game.LogTrivial(message); } catch { } }
        static string ErrorText(Exception error)
        {
            string message = (error?.Message ?? "unknown").Replace('\r', ' ').Replace('\n', ' ').Replace('|', '/');
            return error?.GetType().Name + ":" + (message.Length > 160 ? message.Substring(0, 160) : message);
        }
        public SessionIdentityIntegration(string pipeName = "LSA.SessionIdentity.v1")
        {
            if (pipeName == null || !Regex.IsMatch(pipeName, "^[A-Za-z0-9_.-]{1,80}$")) throw new ArgumentException("Invalid identity pipe name.");
            this.pipeName = pipeName;
        }
        // Called explicitly by the authored owner on the game fiber, not auto-loaded.
        public static SessionIdentityIntegration Install(string pipeName = "LSA.SessionIdentity.v1")
        {
            var integration = InstallDeferred(pipeName);
            integration.Initialize();
            return integration;
        }
        // Register before Core enters its integration foreach, then let its
        // Initialize/Update callback create the store on the actual owner fiber.
        // Preparation does not read the clock, initialize IPC, or touch a ped.
        public static SessionIdentityIntegration InstallDeferred(string pipeName = "LSA.SessionIdentity.v1")
        {
            if (installed != null) return installed;
            installed = new SessionIdentityIntegration(pipeName);
            IntegrationManager.Register(installed);
            return installed;
        }
        public void Initialize()
        {
            if (store != null) return;
            creationThreadId = Thread.CurrentThread.ManagedThreadId;
            // Optional identity support fails closed on a different loaded core.
            // This read is startup-only, never in EnrichActor/Update.
            try {
                using (var hash = SHA256.Create()) {
                    string actual = BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(typeof(IIntegration).Assembly.Location))).Replace("-", "").ToLowerInvariant();
                    if (actual != "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653") {
                        lastShutdownReason = "core_pin_mismatch";
                        Log("[SessionIdentity] unavailable reason=core_pin_mismatch actual_core_sha256=" + actual);
                        return;
                    }
                }
            } catch (Exception error) {
                lastShutdownReason = "core_pin_read_failed";
                Log("[SessionIdentity] unavailable reason=core_pin_read_failed error=" + ErrorText(error));
                return;
            }
            store = new NativeIdentityEvidenceStore(() => GameFiber.CanSleepNow); Owner = new ExplicitCharacterSource(store);
            channel = new OwnerFactChannel(pipeName, store.AdapterEpoch);
            store.Revoked += channel.Revoke; lastGameTime = Game.GameTime;
            lastShutdownReason = "none"; lastUpdateFailure = "none";
            heartbeat.Restart(); channel.Start();
            Log("[SessionIdentity] initialized thread=" + creationThreadId + " game_tick=" + lastGameTime);
        }
        public void Update()
        {
            if (store == null) return;
            Interlocked.Increment(ref updateCalls);
            lastUpdateThreadId = Thread.CurrentThread.ManagedThreadId;
            Interlocked.Exchange(ref lastUpdateMs, diagnosticsClock.ElapsedMilliseconds);
            try {
                long now = Game.GameTime;
                if (now < lastGameTime) {
                    Log("[SessionIdentity] clock_regression previous_game_tick=" + lastGameTime + " current_game_tick=" + now +
                        " thread=" + lastUpdateThreadId);
                    Shutdown("clock_regression"); Initialize(); return;
                } // Regressed game clock invalidates owner roster/epoch.
                lastGameTime = now;
                store.ValidateActive();
                for (int count = 0; count < 16 && channel.TryTake(out var request); count++) {
                    var status = store.TryResolveCurrent(request.PedId, now, out var claim);
                    channel.Reply(request, status, claim);
                }
                // Proves the game-fiber validation loop is alive; the pipe worker cannot mint leases.
                if (heartbeat.ElapsedMilliseconds >= 250) { channel.Heartbeat(); heartbeat.Restart(); }
                Interlocked.Increment(ref completedUpdates);
                Interlocked.Exchange(ref lastCompletedMs, diagnosticsClock.ElapsedMilliseconds);
            } catch (Exception error) {
                lastUpdateFailure = ErrorText(error);
                int ownerThread = creationThreadId;
                Shutdown("update_failed");
                Log("[SessionIdentity] update_failed error=" + lastUpdateFailure + " owner_thread=" + ownerThread +
                    " update_thread=" + lastUpdateThreadId + " game_tick=" + lastGameTime +
                    " update_calls=" + Interlocked.Read(ref updateCalls) + " update_completed=" + Interlocked.Read(ref completedUpdates));
            } // Optional evidence cannot throw into Essential's update loop.
        }
        public void EnrichActor(Ped ped, ActorContext context)
        {
            if (store == null || context == null || context.IntegrationBlocks == null) return;
            try {
                if (context.PedId != ped?.Handle.ToString() || !Owner.TryResolveCurrent(ped, out var claim)) return;
                // CPU-only bounded roster lookup + serialization. No pipe/disk work here.
                context.IntegrationBlocks.Add(new IntegrationJsonBlock(Id, new JavaScriptSerializer { MaxJsonLength = 4096 }.Serialize(claim)));
            } catch { /* Optional evidence unavailable; Essential owns ordinary context. */ }
        }
        public void Shutdown() => Shutdown("integration_shutdown");
        void Shutdown(string reason)
        {
            lastShutdownReason = reason;
            if (store == null) return;
            Game.LogTrivial("[P1] identity_shutdown");
            try { store.Clear(); } catch { }
            channel.Dispose(); store = null; Owner = null; heartbeat.Stop();
            Log("[SessionIdentity] shutdown reason=" + reason + " thread=" + Thread.CurrentThread.ManagedThreadId +
                " update_calls=" + Interlocked.Read(ref updateCalls) + " update_completed=" + Interlocked.Read(ref completedUpdates));
        }
        public void OnPedControlChanged(Ped ped, bool controlledByLsa) { }
        public void OnNpcActionExecuted(Ped ped, string actionName, bool succeeded) { }
    }
    // A synthetic explicit owner seam for the controlled Alex checklist. The
    // caller owns spawning/deletion; this code never creates or tasks a ped.
    public static class AuthoredTestOwner
    {
        public static RegistrationToken RegisterAlex(Ped ownedPed, string worldProfileId) =>
            SessionIdentityIntegration.Install().Owner?.Register(ownedPed, "companion.alex", worldProfileId);
        public static bool Retire(RegistrationToken token) => SessionIdentityIntegration.Install().Owner?.Retire(token) ?? false;
    }
}
