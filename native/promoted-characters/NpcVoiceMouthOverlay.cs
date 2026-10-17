using System;
using Rage;
using Rage.Native;

namespace LSA.PromotedCharacters
{
    // Experimental, explicitly opted-in facial presentation only.
    // `open` comes from Essential's playout level for the exact active turn (see
    // NpcVoicePresenceObserver), NEVER PCM queue arrival and never an estimate.
    // The facial clip is binary (talk / neutral), so smoothing is hysteresis plus
    // minimum dwell times rather than a graded jaw value.
    internal sealed class NpcVoiceMouthOverlay
    {
        const long RefreshMs = 1250;
        // Minimum time between level-driven transitions; keeps a wavering level from
        // spamming facial natives. Stopping events bypass both (Close/Forget).
        internal const long MinOpenMs = 150, MinClosedMs = 120;
        const string TalkDict = "mp_facial", TalkAnim = "mic_chatter";
        Ped owned;
        IntPtr originalAddress;
        int originalHandle;
        long lastRefresh = -1, openedAt = -1, closedAt = -1;
        bool applied, disabled;

        internal bool Applied => applied;
        internal bool Disabled => disabled;

        static bool SamePed(Ped ped, Ped original, int handle, IntPtr address)
        {
            try {
                return ped != null && ReferenceEquals(ped, original) &&
                    ped.Exists() && !ped.IsDead && ped.Handle == handle &&
                    ped.MemoryAddress == address && address != IntPtr.Zero &&
                    ped != Game.LocalPlayer.Character;
            } catch { return false; }
        }

        // Called only from Essential's Core update fiber after actor/turn checks.
        internal void Update(Ped ped, long now, bool open)
        {
            if (disabled) return;
            if (applied && !SamePed(ped, owned, originalHandle, originalAddress))
            {
                // A replaced/dead ped may belong to another script or world.
                // Never issue a native on that stale incarnation.
                Forget();
                return;
            }
            if (!open)
            {
                // Level-driven close respects the minimum open dwell so a single
                // quiet frame cannot snap the mouth shut mid-word.
                if (applied && now >= openedAt + MinOpenMs) Close(ped, now);
                return;
            }
            // Do not compete with authored cinematics, player switches,
            // or network owners. Suppress without touching their facial state.
            try {
                if (NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") ||
                    NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING") ||
                    NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS") ||
                    NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE"))
                { Forget(); return; }
            } catch { disabled=true; Forget(); return; }
            if (now < 0 || (lastRefresh >= 0 && now < lastRefresh)) { Forget(); return; }
            if (applied && now - lastRefresh < RefreshMs) return;
            if (!applied && closedAt >= 0 && now >= closedAt && now - closedAt < MinClosedMs) return;

            try
            {
                NativeFunction.CallByName("REQUEST_ANIM_DICT", TalkDict);
                // The neutral facial dictionaries must be ready before we take
                // control so an early cancel can close our own facial overlay.
                NativeFunction.CallByName("REQUEST_ANIM_DICT", "facials@gen_male@base");
                NativeFunction.CallByName("REQUEST_ANIM_DICT", "facials@gen_female@base");
                if (!NativeFunction.CallByName<bool>("HAS_ANIM_DICT_LOADED", TalkDict)) return;
                bool male = NativeFunction.CallByName<bool>("IS_PED_MALE", ped);
                string neutral = male ? "facials@gen_male@base" : "facials@gen_female@base";
                if (!NativeFunction.CallByName<bool>("HAS_ANIM_DICT_LOADED", neutral)) return;
                NativeFunction.CallByName("PLAY_FACIAL_ANIM", ped, TalkAnim, TalkDict);
                if (!applied) openedAt = now;
                applied = true; owned = ped; originalHandle = ped.Handle;
                originalAddress = ped.MemoryAddress; lastRefresh = now;
            }
            catch
            {
                // Native support / ownership is not proven for Enhanced.
                // Disable permanently for this session, never spam game calls.
                disabled = true;
                Forget();
                Game.LogTrivial("[VP] experimental_facial_disabled native_unavailable");
            }
        }

        internal void Close(Ped ped, long now = -1)
        {
            if (!applied) return;
            if (!SamePed(ped, owned, originalHandle, originalAddress)) { Forget(); return; }
            try
            {
                // Facial-only reset of an animation *this observer applied*;
                // never TASK_CLEAR, TASK_PLAY_ANIM, or override ped movement.
                var dict = NativeFunction.CallByName<bool>("IS_PED_MALE", ped)
                    ? "facials@gen_male@base" : "facials@gen_female@base";
                NativeFunction.CallByName("PLAY_FACIAL_ANIM", ped, "mood_normal_1", dict);
            }
            catch
            {
                disabled = true;
                Game.LogTrivial("[VP] experimental_facial_close_unavailable");
            }
            finally { Forget(); if (now >= 0) closedAt = now; }
        }

        // World change/retirement: never touch potentially recycled handles.
        internal void Forget()
        {
            applied = false; owned = null; originalHandle = 0;
            originalAddress = IntPtr.Zero; lastRefresh = -1; openedAt = -1; closedAt = -1;
        }
    }
}
