using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;
using System.IO;
using System.Threading;
using LSA.Standalone;
using Rage;
using Rage.Attributes;

[assembly: Plugin("LSA Standalone", Description="Independent NPC host (Phase 2 safe bootstrap)", Author="ComradeGenosse",
    EntryPoint="LSA.Standalone.RageHost.EntryPoint.Main",
    ExitPoint="LSA.Standalone.RageHost.EntryPoint.Shutdown",
    AssemblyProbingPaths="Plugins;Plugins/LSA.Standalone",
    PrefersSingleInstance=true)]

namespace LSA.Standalone.RageHost
{
    public static class EntryPoint
    {
        private static volatile bool stopping;
        private static int running;
        private static StandalonePipeServer server;
        // Native stage is sourced from the install-owned, short-lived file in
        // GTA itself. RPH child processes are not guaranteed to inherit env.
        private static Dictionary<string, string> nativeSettings;
        private static string activeStage = "unconfigured";
        private static bool autoSmokeEnabled;
        private static bool autoSmokeActorAuthorized;
        private static int autoSmokeDelay = 30;
        internal static string ActivationSummary { get; private set; } = "native_runtime_not_started";

        // RPH's documented ExitPoint contract is static void Method(bool isTerminating).
        // Preserve the existing fail-closed, game-thread-independent cleanup.
        public static void Shutdown(bool isTerminating)
        {
            // ExitPoint may run on a different fiber: never touch the game here.
            stopping = true;
            try { server?.StopAdmission(); } catch {}
            StandaloneTypedCommands.CloseAdmission();
        }

        public static void Main()
        {
            if (Interlocked.CompareExchange(ref running, 1, 0) != 0) return;
            FileStream exclusive = null;
            RageActorResolver resolver = null;
            OwnerScope scope = null;
            NativeAuthority authority = null;
            NativeTurnRegistry turns = null;
            NativeAudioRegistry audio = null;
            StandaloneAutoSmoke autoSmoke = null;
            WaveOutSpatialOutput physicalAudio = null;
            bool facialEnabled = false;
            try
            {
                stopping = false;
                string reason;
                if (!StandaloneOnlyProfile(out reason))
                {
                    Game.LogTrivial("[LSA-S2] refused " + reason);
                    return;
                }
                if (!LoadNativeActivation(out reason) || !ValidateNativeActivation(out reason))
                {
                    Game.LogTrivial("[LSA-S2] refused " + reason);
                    return;
                }
                // Exclusive OS file handle works across independent RPH AppDomains and
                // survives fiber/thread migration; it is released on process crash.
                try
                {
                    exclusive = new FileStream(Path.Combine(Path.GetTempPath(),
                        "LSA.Standalone.controller.lock"), FileMode.OpenOrCreate,
                        FileAccess.ReadWrite, FileShare.None);
                }
                catch (IOException) { Game.LogTrivial("[LSA-S2] refused duplicate_controller"); return; }

                scope = new OwnerScope();
                scope.Enter();
                try
                {
                    // A process-level opt-in alone never grants adoption.
                    // RPH owner-fiber probe + stable decorator readback +
                    // separate deliberate in-game Arm are all required.
                    string actorMode = GetSetting("LSA_STANDALONE_ACTOR_MODE");
                    resolver = new RageActorResolver(scope,
                        actorMode == "experimental", actorMode == "diagnostic");
                    var clock = new MonotonicClock();
                    authority = new NativeAuthority(clock, new RageWorld(),
                        resolver, scope);
                    turns = new NativeTurnRegistry(authority);
                    // Explicitly opt in to an independent Windows output device;
                    // default remains null/safe, with zero audio side effects.
                    if (string.Equals(GetSetting("LSA_STANDALONE_AUDIO_OUTPUT"), "waveout_experimental",
                        StringComparison.Ordinal))
                    {
                        var spatial = new RageSpatialAudioSource(scope, resolver);
                        physicalAudio = new WaveOutSpatialOutput(authority, scope, spatial.Sample);
                    }
                    // Facial animation is separately opt-in and requires a
                    // real physical output presenter (not provider PCM arrival).
                    ILipSyncPresenter face = null;
                    if (physicalAudio != null && string.Equals(
                        GetSetting("LSA_STANDALONE_LIPSYNC"),
                        "facial_experimental", StringComparison.Ordinal))
                    {
                        face = new RageLipSyncPresenter(authority, scope, resolver, clock);
                        facialEnabled = true;
                    }
                    // The TTS-only/early-streaming stages need bounded PCM validation
                    // without a waveOut device. This validator consumes admitted
                    // bytes on the owner fiber and can NEVER certify playback.
                    IAudioOutput output = physicalAudio;
                    if (output == null && GetSetting("LSA_STANDALONE_TTS_MODE") == "enabled")
                        output = new DiagnosticPcmOutput(authority);
                    audio = new NativeAudioRegistry(authority, turns, output, face);
                }
                finally { scope.Exit(); }

                server = new StandalonePipeServer(authority.HostRunId, () => authority.WorldEpoch);
                server.Start();
                bool typedEnabled = GetSetting("LSA_STANDALONE_TYPED_MODE") == "enabled";
                StandaloneTypedCommands.OpenAdmission(typedEnabled);
                if (autoSmokeEnabled)
                    autoSmoke = new StandaloneAutoSmoke(autoSmokeDelay, typedEnabled,
                        autoSmokeActorAuthorized);
                ActivationSummary = "config=native_file_verified stage=" + activeStage +
                    " native_ipc=started probe=" +
                    (GetSetting("LSA_STANDALONE_ACTOR_MODE") == "off" ? "off" : "enabled_unproven") +
                    " typed_admission=" + (typedEnabled ? "enabled_unarmed" : "off") +
                    " physical_audio=" + (physicalAudio == null ? "off" : "adapter_initialized_unverified") +
                    " pcm_validation=" + (GetSetting("LSA_STANDALONE_TTS_MODE") == "enabled" &&
                        physicalAudio == null ? "native_non_audible_escrow" : "not_separate") +
                    " lip_sync=" + (facialEnabled ? "presenter_initialized_unverified" : "off") +
                    " auto_smoke=" + (autoSmokeEnabled ? "armed_after_safe_spawn" : "off") +
                    " gta_validated=false";
                Game.LogTrivial("[LSA-ACTIVATION] " + ActivationSummary);
                Game.LogTrivial("[LSA-S3] started actor_adoption=locked_until_live_probe" +
                    " actor_mode=" + GetSetting("LSA_STANDALONE_ACTOR_MODE") +
                    " transport=phase2 waveout=" + (physicalAudio == null ? "off" : "experimental") +
                    " facial=" + (facialEnabled ? "experimental" : "off"));
                uint previousGameTick = unchecked((uint)Game.GameTime);
                while (!stopping)
                {
                    scope.Enter();
                    try
                    {
                        uint currentGameTick = unchecked((uint)Game.GameTime);
                        if (unchecked(currentGameTick - previousGameTick) > int.MaxValue)
                        {
                            resolver.Disarm();
                            authority.WorldChanged();
                        }
                        previousGameTick = currentGameTick;
                        authority.Reconcile();
                        server.DrainOwnerRequests(authority, turns, audio, 8);
                        audio.DrainOnOwner(4); // only opt-in WaveOut can accept device bytes
                        audio.PumpLipSyncOnOwner(4); // game-fiber only, actual-playback gated
                        StandaloneTypedCommands.Pump(scope, resolver, authority, turns, server);
                        autoSmoke?.Tick(scope, resolver);
                    }
                    finally { scope.Exit(); }
                    // No owner scope survives this yield.
                    GameFiber.Sleep(50);
                }
            }
            catch (Exception error)
            {
                // G2: report the missing CLR symbol, never raw exception messages
                // (which may contain local paths, credentials or configuration).
                Game.LogTrivial("[LSA-S2] host_failed " +
                    BindingFailureDiagnostics.Summary(error));
            }
            finally
            {
                stopping = true;
                StandaloneTypedCommands.CloseAdmission();
                try { server?.StopAdmission(); } catch {}
                if (scope != null && authority != null)
                {
                    try
                    {
                        scope.Enter();
                        try
                        {
                            StandaloneTypedCommands.StopOnOwner(scope);
                            audio?.RetireAll();
                            physicalAudio?.Dispose();
                            turns?.RetireAll();
                            authority.Stop();
                        }
                        finally { scope.Exit(); }
                    }
                    catch { Game.LogTrivial("[LSA-S2] host_stop_owner_unavailable"); }
                }
                try { server?.Dispose(); } catch {}
                server = null;
                nativeSettings = null;
                activeStage = "unconfigured";
                autoSmokeEnabled = autoSmokeActorAuthorized = false;
                try { resolver?.Dispose(); } catch {}
                try { exclusive?.Dispose(); } catch {}
                Interlocked.Exchange(ref running, 0);
                Game.LogTrivial("[LSA-S2] stopped");
            }
        }

        private static string GetSetting(string name)
        {
            string value;
            return nativeSettings != null && nativeSettings.TryGetValue(name, out value)
                ? value : "off";
        }

        private static bool LoadNativeActivation(out string reason)
        {
            reason = "native_activation_file_required";
            try
            {
                var game = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
                var path = Path.Combine(game, ".LSAStandaloneSmoke", "native-activation.json");
                if (!File.Exists(path) || new FileInfo(path).Length > 4096 ||
                    new FileInfo(path).Length < 32) return false;
                // No credentials, prompts or model names are read from the GTA file.
                // It contains only seven native effect switches, a stage, a
                // timestamp and the still-running PowerShell launcher PID.
                var document = new JavaScriptSerializer()
                    .Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                if (document == null || document.Count != 7 ||
                    !document.TryGetValue("kind", out var kind) ||
                    !string.Equals(kind as string, "lsa-standalone-native-activation", StringComparison.Ordinal) ||
                    !document.TryGetValue("version", out var version) ||
                    !(version is int) || (int)version != 1 ||
                    !document.TryGetValue("stage", out var stageValue) ||
                    !(stageValue is string) ||
                    Array.IndexOf(new[] { "host", "probe", "typed", "tts",
                        "audio", "lipsync", "streaming" }, (string)stageValue) < 0 ||
                    !document.TryGetValue("createdAtUtc", out var when) ||
                    !(when is string) ||
                    !DateTime.TryParseExact((string)when, "o",
                        CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind,
                        out var created) ||
                    created.ToUniversalTime() > DateTime.UtcNow.AddMinutes(1) ||
                    created.ToUniversalTime() < DateTime.UtcNow.AddMinutes(-20) ||
                    !document.TryGetValue("ownerPid", out var ownerPid) ||
                    !(ownerPid is int) || (int)ownerPid <= 0 ||
                    !document.TryGetValue("settings", out var rawSettings) ||
                    !(rawSettings is Dictionary<string, object>) ||
                    !document.TryGetValue("autoSmoke", out var rawAuto) ||
                    !(rawAuto is Dictionary<string, object>))
                {
                    reason = "invalid_native_activation_file";
                    return false;
                }
                using (var owner = Process.GetProcessById((int)ownerPid))
                {
                    if (owner.HasExited ||
                        !(string.Equals(owner.ProcessName, "powershell",
                              StringComparison.OrdinalIgnoreCase) ||
                          string.Equals(owner.ProcessName, "pwsh",
                              StringComparison.OrdinalIgnoreCase)))
                    {
                        reason = "native_activation_launcher_not_running";
                        return false;
                    }
                }
                var supplied = (Dictionary<string, object>)rawSettings;
                var required = new[] {
                    "LSA_STANDALONE_ACTOR_MODE", "LSA_STANDALONE_TYPED_MODE",
                    "LSA_STANDALONE_TTS_MODE", "LSA_STANDALONE_AUDIO_OUTPUT",
                    "LSA_STANDALONE_PLAYBACK_CONFIRM", "LSA_STANDALONE_LIPSYNC",
                    "LSA_STANDALONE_EARLY_SPEECH"
                };
                if (supplied.Count != required.Length)
                {
                    reason = "invalid_native_activation_file";
                    return false;
                }
                var next = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (string key in required)
                {
                    if (!supplied.TryGetValue(key, out var value) ||
                        !(value is string) || ((string)value).Length > 40)
                    {
                        reason = "invalid_native_activation_file";
                        return false;
                    }
                    next.Add(key, (string)value);
                }
                var smoke = (Dictionary<string, object>)rawAuto;
                if (smoke.Count != 3 ||
                    !smoke.TryGetValue("enabled", out var enabledRaw) ||
                    !(enabledRaw is bool) ||
                    !smoke.TryGetValue("afterSpawnSeconds", out var delayRaw) ||
                    !(delayRaw is int) || (int)delayRaw < 5 || (int)delayRaw > 120 ||
                    !smoke.TryGetValue("actorAdoptionAuthorized", out var actorRaw) ||
                    !(actorRaw is bool))
                {
                    reason = "invalid_automated_smoke_configuration";
                    return false;
                }
                bool automatic = (bool)enabledRaw;
                bool actorConsent = (bool)actorRaw;
                if (automatic && next["LSA_STANDALONE_TYPED_MODE"] == "enabled" &&
                    !actorConsent)
                {
                    reason = "automated_actor_adoption_authorization_required";
                    return false;
                }
                nativeSettings = next;
                autoSmokeEnabled = automatic;
                autoSmokeActorAuthorized = actorConsent;
                autoSmokeDelay = (int)delayRaw;
                activeStage = (string)stageValue;
                reason = "accepted";
                return true;
            }
            catch
            {
                reason = "invalid_or_expired_native_activation_file";
                return false;
            }
        }

        private static bool ValidateNativeActivation(out string reason)
        {
            // A direct RPH launch is independently fail-closed even if the
            // PowerShell/Node preflight was bypassed. No actor, device or IPC
            // object is created until this static config contract is valid.
            string actor = GetSetting("LSA_STANDALONE_ACTOR_MODE");
            string typed = GetSetting("LSA_STANDALONE_TYPED_MODE");
            string tts = GetSetting("LSA_STANDALONE_TTS_MODE");
            string audio = GetSetting("LSA_STANDALONE_AUDIO_OUTPUT");
            string confirm = GetSetting("LSA_STANDALONE_PLAYBACK_CONFIRM");
            string face = GetSetting("LSA_STANDALONE_LIPSYNC");
            string stream = GetSetting("LSA_STANDALONE_EARLY_SPEECH");
            reason = "invalid_native_activation_configuration";
            if (actor != "off" && actor != "diagnostic" && actor != "experimental" ||
                typed != "off" && typed != "enabled" ||
                tts != "off" && tts != "enabled" ||
                audio != "off" && audio != "waveout_experimental" ||
                confirm != "off" && confirm != "enabled" ||
                face != "off" && face != "facial_experimental" ||
                stream != "off" && stream != "enabled") return false;
            if ((typed == "enabled") != (actor == "experimental") ||
                (tts == "enabled" && typed != "enabled") ||
                (audio == "waveout_experimental" && tts != "enabled") ||
                ((audio == "waveout_experimental") != (confirm == "enabled")) ||
                (face == "facial_experimental" && audio != "waveout_experimental") ||
                (stream == "enabled" && tts != "enabled"))
            {
                reason = "native_activation_prerequisite_missing";
                return false;
            }
            reason = "accepted";
            return true;
        }

        private static bool StandaloneOnlyProfile(out string reason)
        {
            reason = "unsafe_profile";
            string exe = Process.GetCurrentProcess().MainModule.FileName;
            if (!string.Equals(Path.GetFileName(exe), "GTA5_Enhanced.exe", StringComparison.OrdinalIgnoreCase))
            { reason = "wrong_game_executable"; return false; }
            string game = Path.GetDirectoryName(exe);
            string plugins = Path.Combine(game, "Plugins");
            // An explicit operator-controlled isolated profile is required.
            if (!File.Exists(Path.Combine(plugins, "LSA.Standalone.enabled")))
            { reason = "standalone_profile_not_enabled"; return false; }
            foreach (string legacy in new[] {
                Path.Combine(plugins,"LosSantosAlive.dll"),
                Path.Combine(plugins,"LSA.PromotedCharacters.dll"),
                Path.Combine(plugins,"LSA.PromotedCharacters"),
                Path.Combine(plugins,"LSA.PromotedCharacters.json"),
                Path.Combine(plugins,"LSA.SessionIdentity.dll"),
                Path.Combine(plugins,"LSA.Intelligence.dll"),
                Path.Combine(plugins,"LSA.PromotedCharacters.Runtime.dll"),
                Path.Combine(plugins,"LSA.PromotedCharacters.Bootstrap.dll"),
                Path.Combine(plugins,"LSPDFR","LosSantosAlive.Interop.dll"),
                Path.Combine(plugins,"LSPDFR","LosSantosAlive.PRBridge.dll"),
                Path.Combine(game,"LosSantosAlive.dll"),
                Path.Combine(plugins,"Los Santos Alive.dll")
            })
            {
                if (File.Exists(legacy) || Directory.Exists(legacy))
                { reason = "essential_profile_present"; return false; }
            }
            // This list is not a universal detector for renamed third-party plugins.
            // Physical acceptance additionally requires verifying the complete loader profile.
            reason = "accepted";
            return true;
        }
    }
}
