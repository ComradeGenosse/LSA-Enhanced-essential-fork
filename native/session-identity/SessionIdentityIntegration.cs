using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
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
        readonly string pipeName;
        public string Id => "sessionIdentity";
        public bool IsAvailable => store != null;
        public ExplicitCharacterSource Owner { get; private set; }
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
            // Optional identity support fails closed on a different loaded core.
            // This read is startup-only, never in EnrichActor/Update.
            try {
                using (var hash = SHA256.Create()) {
                    string actual = BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(typeof(IIntegration).Assembly.Location))).Replace("-", "").ToLowerInvariant();
                    if (actual != "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653") return;
                }
            } catch { return; }
            store = new NativeIdentityEvidenceStore(); Owner = new ExplicitCharacterSource(store);
            channel = new OwnerFactChannel(pipeName, store.AdapterEpoch);
            store.Revoked += channel.Revoke; lastGameTime = Game.GameTime;
            heartbeat.Restart(); channel.Start();
        }
        public void Update()
        {
            if (store == null) return;
            string stage = "read_clock";
            try {
                long now = Game.GameTime;
                if (now < lastGameTime) {
                    stage = "reset_owner"; Shutdown();
                    stage = "initialize_owner"; Initialize();
                    Game.LogTrivial(IsAvailable ? "[P1] game_clock_reset" : "[P1] game_clock_reset_unavailable");
                    return;
                } // Regressed game clock invalidates owner roster/epoch.
                lastGameTime = now;
                stage = "validate_roster";
                store.ValidateActive();
                stage = "dequeue_verify";
                for (int count = 0; count < 16 && channel.TryTake(out var request); count++) {
                    stage = "resolve_verify";
                    var status = store.TryResolveCurrent(request.PedId, now, out var claim);
                    stage = "reply_verify";
                    channel.Reply(request, status, claim);
                    stage = "dequeue_verify";
                }
                // Proves the game-fiber validation loop is alive; the pipe worker cannot mint leases.
                stage = "heartbeat";
                if (heartbeat.ElapsedMilliseconds >= 250) { channel.Heartbeat(); heartbeat.Restart(); }
            } catch (Exception error) {
                // Fixed diagnostic vocabulary only: never log exception text,
                // ped/character identifiers, pipe contents or ownership tokens.
                string affinity = store == null ? "owner_unavailable" : store.IsOnOwnerThread ? "owner_thread_same" : "owner_thread_changed";
                Game.LogTrivial("[P1] optional_update_failed_" + stage + "_" + FailureType(error) + "_" + affinity);
                Shutdown();
            } // Optional evidence cannot throw into Essential's update loop.
        }
        static string FailureType(Exception error)
        {
            if (error is ObjectDisposedException) return "ObjectDisposedException";
            if (error is InvalidOperationException) return "InvalidOperationException";
            if (error is IOException) return "IOException";
            if (error is ArgumentException) return "ArgumentException";
            return "other_exception";
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
        public void Shutdown()
        {
            if (store == null) return;
            Game.LogTrivial("[P1] identity_shutdown");
            try { store.Clear(); } catch { }
            channel.Dispose(); store = null; Owner = null; heartbeat.Stop();
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
