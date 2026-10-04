using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace LSA.Enhanced.Input
{
    public interface IInputInjector
    {
        bool Press(int vk);
        bool Release(int vk);
    }
    // Pulses one of Essential's own keys so Essential's GetAsyncKeyState poll sees
    // exactly one press. The key-up is scheduled and sent from the router fiber's
    // next frames; the game fiber never sleeps. One key is down at a time; a quick
    // second tap of the other key (Mark, then Text) waits in a one-slot queue and
    // is pressed as the first is released.
    public sealed class EssentialKeyRelay
    {
        readonly IInputInjector injector;
        int heldVk, queuedVk, queuedPulseMs;
        long releaseAt;
        public EssentialKeyRelay(IInputInjector injector) { this.injector = injector ?? throw new ArgumentNullException(nameof(injector)); }
        public bool Busy => heldVk != 0;
        public string Pulse(EssentialKey key,int pulseMs,long nowMs)
        {
            if (key == null || key.State == EssentialKeyState.Unbound) return "essential_key_unbound";
            if (key.State != EssentialKeyState.Bound || !PhysicalKeys.Relayable(key.Vk)) return "essential_key_unsupported";
            if (heldVk != 0) {
                // The same key again inside its own pulse would merge into one press.
                if (queuedVk != 0 || key.Vk == heldVk) return "relay_busy";
                queuedVk = key.Vk; queuedPulseMs = pulseMs;
                return null;
            }
            return Press(key.Vk,pulseMs,nowMs);
        }
        string Press(int vk,int pulseMs,long nowMs)
        {
            if (!injector.Press(vk)) return "native_operation_failed";
            heldVk = vk; releaseAt = nowMs + Math.Max(16,pulseMs);
            return null;
        }
        public void Update(long nowMs)
        {
            if (heldVk == 0 || nowMs < releaseAt) return;
            Release();
            if (queuedVk != 0) { int vk = queuedVk; queuedVk = 0; Press(vk,queuedPulseMs,nowMs); }
        }
        void Release()
        {
            int vk = heldVk; heldVk = 0;
            if (vk != 0) try { injector.Release(vk); } catch { }
        }
        // Called on shutdown, focus loss and settings changes so a synthesized key
        // can never stick; a queued pulse is dropped.
        public void ReleaseAll() { queuedVk = 0; Release(); }
    }
    // SendInput keyboard (KEYBDINPUT) and X-button (MOUSEINPUT) events.
    public sealed class Win32InputInjector : IInputInjector
    {
        const uint InputMouse = 0, InputKeyboard = 1, KeyUp = 0x0002, ExtendedKey = 0x0001, XDown = 0x0080, XUp = 0x0100;
        [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int Dx, Dy; public uint MouseData, Flags, Time; public IntPtr ExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort Vk, Scan; public uint Flags, Time; public IntPtr ExtraInfo; }
        [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
        [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public InputUnion Data; }
        [DllImport("user32.dll",SetLastError = true)] static extern uint SendInput(uint count,Input[] inputs,int size);
        [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code,uint mapType);
        public bool Press(int vk) => Send(vk,false);
        public bool Release(int vk) => Send(vk,true);
        static bool Send(int vk,bool up)
        {
            var input = new Input();
            if (vk == PhysicalKeys.XButton1 || vk == PhysicalKeys.XButton2) {
                input.Type = InputMouse;
                input.Data.Mouse = new MouseInput {MouseData = vk == PhysicalKeys.XButton1 ? 1u : 2u,Flags = up ? XUp : XDown};
            } else {
                input.Type = InputKeyboard;
                input.Data.Keyboard = new KeyboardInput {Vk = (ushort)vk,Scan = (ushort)MapVirtualKey((uint)vk,0),Flags = (up ? KeyUp : 0) | (PhysicalKeys.IsExtended(vk) ? ExtendedKey : 0)};
            }
            return SendInput(1,new[] {input},Marshal.SizeOf(typeof(Input))) == 1;
        }
    }
}
