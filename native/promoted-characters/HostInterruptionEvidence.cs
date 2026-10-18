using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace LSA.PromotedCharacters
{
    // OS-only foreground sampling: never touches Rage/GTA off its owner fiber.
    // The owner fiber drains these bounded samples into the normal RPH log
    // after a pause, so timestamps reflect when focus actually changed.
    public sealed class HostInterruptionEvidence : IDisposable
    {
        public sealed class FocusTransition
        {
            public readonly DateTime Utc;
            public readonly int Foreground;
            public FocusTransition(DateTime utc, int foreground) { Utc=utc; Foreground=foreground; }
        }

        readonly Func<int> readFocus;
        readonly Queue<FocusTransition> pending=new Queue<FocusTransition>();
        readonly object gate=new object();
        readonly Timer timer;
        int previous=-2;
        bool closed;
        public int Dropped {get;private set;}

        public HostInterruptionEvidence(Func<int> readFocus, bool startTimer=true)
        {
            this.readFocus=readFocus??throw new ArgumentNullException(nameof(readFocus));
            if(startTimer)timer=new Timer(_=>Sample(),null,0,250);
        }

        // 1=GTA process has foreground window, 0=other foreground process,
        // -1=unknown. Loss of foreground alone is NOT proof GTA paused.
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint processId);
        public static int ReadProcessForeground()
        {
            try {
                var hwnd=GetForegroundWindow();
                if(hwnd==IntPtr.Zero)return -1;
                uint pid;GetWindowThreadProcessId(hwnd,out pid);
                return pid==0?-1:pid==(uint)Process.GetCurrentProcess().Id?1:0;
            } catch {return -1;}
        }

        public void Sample() { Sample(DateTime.UtcNow); }
        public void Sample(DateTime utc)
        {
            int focus;
            try {focus=readFocus();}catch{focus=-1;}
            if(focus!=0 && focus!=1)focus=-1;
            lock(gate) {
                if(closed || focus==previous)return;
                previous=focus;
                if(pending.Count<32)pending.Enqueue(new FocusTransition(utc,focus));
                else Dropped++;
            }
        }

        public bool TryRead(out FocusTransition transition)
        {
            lock(gate) {
                if(pending.Count>0){transition=pending.Dequeue();return true;}
            }
            transition=null;return false;
        }

        public static bool OwnerFiberGap(long previousWakeMs,long wakeMs)
            => previousWakeMs>=0 && wakeMs>=previousWakeMs &&
               wakeMs-previousWakeMs>=1500;

        public void Dispose()
        {
            lock(gate)closed=true;
            timer?.Dispose();
        }
    }
}
