using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using LSA.Enhanced.Commands;

namespace LSA.Enhanced.Input
{
    public interface IKeySource
    {
        bool IsDown(int vk);
        bool GameHasFocus();
    }
    // GetAsyncKeyState, the same call Essential polls with, only while GTA's own
    // window is in the foreground.
    public sealed class Win32KeySource : IKeySource
    {
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
        readonly uint processId = (uint)Process.GetCurrentProcess().Id;
        public bool IsDown(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;
        public bool GameHasFocus()
        {
            var window = GetForegroundWindow();
            if (window == IntPtr.Zero) return false;
            GetWindowThreadProcessId(window,out uint owner);
            return owner == processId;
        }
    }
    // Loader-domain game state; the Rage-backed implementation lives with the host.
    public interface IGameState
    {
        bool ConsoleOpen {get;}
        bool Paused {get;}
    }
    public static class InputGates
    {
        public const long SnapshotMaxAgeMs = 1500;
        // Returns null when gestures may run, otherwise a bounded reason. Essential's
        // text input and F7 menu, and scripted states, come from the runtime
        // snapshot built on Essential's fiber; when that snapshot is missing or
        // stale they are unknown and do not block relays, because a relayed key is
        // exactly what the player could press directly.
        public static string Closed(bool focus,IGameState game,bool menuOpen,NativeSnapshot snapshot,long utcNow)
        {
            if (!focus) return "input_gated";
            if (game.ConsoleOpen || game.Paused || menuOpen) return "input_gated";
            if (snapshot != null && snapshot.Fresh(utcNow,SnapshotMaxAgeMs) && snapshot.Gates != null) {
                var gates = snapshot.Gates;
                if (gates.TextInputOpen || gates.ControlsMenuOpen) return "input_busy";
                if (gates.Cutscene || gates.PlayerSwitch || gates.Loading) return "scripted_state";
            }
            return null;
        }
    }
}
