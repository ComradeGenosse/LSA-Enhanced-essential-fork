using System;
using System.Diagnostics;
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

        public static void Shutdown()
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
                    string actorMode = Environment.GetEnvironmentVariable(
                        "LSA_STANDALONE_ACTOR_MODE") ?? "off";
                    resolver = new RageActorResolver(scope,
                        actorMode == "experimental", actorMode == "diagnostic");
                    var clock = new MonotonicClock();
                    authority = new NativeAuthority(clock, new RageWorld(),
                        resolver, scope);
                    turns = new NativeTurnRegistry(authority);
                    // Explicitly opt in to an independent Windows output device;
                    // default remains null/safe, with zero audio side effects.
                    if (string.Equals(Environment.GetEnvironmentVariable(
                        "LSA_STANDALONE_AUDIO_OUTPUT"), "waveout_experimental",
                        StringComparison.Ordinal))
                    {
                        var spatial = new RageSpatialAudioSource(scope, resolver);
                        physicalAudio = new WaveOutSpatialOutput(authority, scope, spatial.Sample);
                    }
                    // Facial animation is separately opt-in and requires a
                    // real physical output presenter (not provider PCM arrival).
                    ILipSyncPresenter face = null;
                    if (physicalAudio != null && string.Equals(
                        Environment.GetEnvironmentVariable("LSA_STANDALONE_LIPSYNC"),
                        "facial_experimental", StringComparison.Ordinal))
                    {
                        face = new RageLipSyncPresenter(authority, scope, resolver, clock);
                        facialEnabled = true;
                    }
                    audio = new NativeAudioRegistry(authority, turns, physicalAudio, face);
                }
                finally { scope.Exit(); }

                server = new StandalonePipeServer(authority.HostRunId, () => authority.WorldEpoch);
                server.Start();
                StandaloneTypedCommands.OpenAdmission();
                Game.LogTrivial("[LSA-S3] started actor_adoption=locked_until_live_probe" +
                    " actor_mode=" + (Environment.GetEnvironmentVariable(
                        "LSA_STANDALONE_ACTOR_MODE") ?? "off") +
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
                    }
                    finally { scope.Exit(); }
                    // No owner scope survives this yield.
                    GameFiber.Sleep(50);
                }
            }
            catch (Exception error)
            {
                // Stable code only. Do not log private configuration or exception messages.
                Game.LogTrivial("[LSA-S2] host_failed kind=" + error.GetType().Name);
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
                try { resolver?.Dispose(); } catch {}
                try { exclusive?.Dispose(); } catch {}
                Interlocked.Exchange(ref running, 0);
                Game.LogTrivial("[LSA-S2] stopped");
            }
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
