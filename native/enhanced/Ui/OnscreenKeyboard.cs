using System;
using Rage.Native;

namespace LSA.Enhanced.Ui
{
    // GTA's own on-screen keyboard (works with keyboard and controller). Polled
    // once per frame from the loader fiber; never blocks. Natives are called by
    // hash so the RPH natives database version does not matter.
    sealed class OnscreenKeyboard
    {
        const ulong Display = 0x00DC833F2568DBF6, Update = 0x0CF2B696BBF945AE, Result = 0x8362B09B91893647, CancelKeyboard = 0x58A39BE597CE99CD;
        public const int MaxLength = 256;
        Action<string> done;
        public bool Active {get;private set;}
        // windowTitle FMMC_KEY_TIP8 is the game's plain "Enter message" prompt.
        public void Open(string initial,int maxLength,Action<string> onDone)
        {
            if (Active) return;
            NativeFunction.CallByHash<int>(Display,6,"FMMC_KEY_TIP8","",initial ?? "","","","",Math.Max(2,Math.Min(MaxLength,maxLength)));
            done = onDone; Active = true;
        }
        // Shutdown or menu close: drop the callback and close the game's keyboard.
        public void Cancel()
        {
            if (!Active) return;
            Active = false; done = null;
            try { NativeFunction.CallByHash<int>(CancelKeyboard); } catch { }
        }
        // Essential took over text input: stop polling without closing a keyboard
        // that may now be Essential's.
        public void Abandon() { Active = false; done = null; }
        // 0 = editing, 1 = confirmed, 2 = cancelled, 3 = not displayed.
        public void Tick()
        {
            if (!Active) return;
            int state = NativeFunction.CallByHash<int>(Update);
            if (state == 0) return;
            Active = false;
            var callback = done; done = null;
            string text = state == 1 ? NativeFunction.CallByHash(Result,typeof(string)) as string : null;
            callback?.Invoke(text);
        }
    }
}
