using System;
using System.Threading;
using Rage;
using Rage.Native;

namespace LSA.Standalone.RageHost
{
    // Owned exclusively by StandaloneTypedCommands.Pump on the RAGE game fiber.
    // No background native calls, no borrowed Essential keyboard state.
    // GTA supplies a 256-character editor; output still goes through the same
    // source-time validation and native-target authority path as console Ask.
    internal sealed class StandaloneOnscreenInput
    {
        private const ulong Display = 0x00DC833F2568DBF6UL;
        private const ulong Update = 0x0CF2B696BBF945AEUL;
        private const ulong Result = 0x8362B09B91893647UL;
        private const ulong CancelKeyboard = 0x58A39BE597CE99CDUL;
        private const int MaxLength = 256;
        private bool active;
        private int pendingOpen;

        // Console callback: ONLY sets an atomic request flag.
        public void RequestOpen() { Interlocked.Exchange(ref pendingOpen, 1); }

        // Input is resolved by the physical RAGE owner scope. A late result
        // cannot be published after the plugin begins shutdown.
        public void Tick(OwnerScope scope, Action<string> submit)
        {
            if (scope == null || !scope.IsOwner ||
                submit == null) throw new InvalidOperationException("owner_required");
            if (!active && Interlocked.Exchange(ref pendingOpen, 0) == 1)
            {
                try
                {
                    // Plain GTA text prompt, no web/editor or Essential dependencies.
                    NativeFunction.CallByHash<int>(Display, 6, "FMMC_KEY_TIP8",
                        "", "", "", "", "", MaxLength);
                    active = true;
                }
                catch { Game.Console.Print("LSA standalone: keyboard_unavailable."); }
            }
            if (!active) return;
            int state;
            try { state = NativeFunction.CallByHash<int>(Update); }
            catch { state = 3; }
            if (state == 0) return;
            active = false;
            if (state != 1) return;
            string value;
            try { value = NativeFunction.CallByHash(Result, typeof(string)) as string; }
            catch { return; }
            if (!string.IsNullOrEmpty(value)) submit(value);
        }

        // Called from the game owner scope before teardown. This does not
        // pretend a keyboard result is a completed NPC turn.
        public void StopOnOwner(OwnerScope scope)
        {
            if (scope == null || !scope.IsOwner) throw new InvalidOperationException("owner_required");
            Interlocked.Exchange(ref pendingOpen, 0);
            if (!active) return;
            active = false;
            try { NativeFunction.CallByHash<int>(CancelKeyboard); }
            catch {}
        }

        public void ClearAdmission()
        {
            Interlocked.Exchange(ref pendingOpen, 0);
            // Never invoke GTA natives or touch active state off owner fiber.
        }
    }
}
