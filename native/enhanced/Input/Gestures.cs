using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Enhanced.Input
{
    public enum GestureKind { Tap, Chord, Hold, ChordHold, DoubleTap }
    // Logical keys are indexes into the configured key list (L4 = 0, R4 = 1, ...).
    public sealed class GestureBinding
    {
        public GestureBinding(string id,GestureKind kind,int[] keys,string command)
        {
            Id = id; Kind = kind; Keys = keys.OrderBy(key => key).ToArray(); Command = command;
            foreach (var key in Keys) Mask |= 1 << key;
        }
        public string Id {get;}
        public GestureKind Kind {get;}
        public IReadOnlyList<int> Keys {get;}
        public int Mask {get;}
        public string Command {get;}
        public static bool TryParseKind(string text,out GestureKind kind)
        {
            switch (text) {
                case "tap": kind = GestureKind.Tap; return true;
                case "chord": kind = GestureKind.Chord; return true;
                case "hold": kind = GestureKind.Hold; return true;
                case "chordHold": kind = GestureKind.ChordHold; return true;
                case "doubleTap": kind = GestureKind.DoubleTap; return true;
                default: kind = GestureKind.Tap; return false;
            }
        }
        public static int KeyCount(GestureKind kind) => kind == GestureKind.Chord || kind == GestureKind.ChordHold ? 2 : 1;
    }
    public sealed class GestureTiming
    {
        public GestureTiming(int chordWindowMs,int holdMs,int doubleTapMs) { ChordWindowMs = chordWindowMs; HoldMs = holdMs; DoubleTapMs = doubleTapMs; }
        public int ChordWindowMs {get;}
        public int HoldMs {get;}
        public int DoubleTapMs {get;}
        public static readonly GestureTiming Default = new GestureTiming(120,600,250);
    }
    public readonly struct GestureEvent
    {
        public GestureEvent(GestureBinding binding,long atMs) { Binding = binding; AtMs = atMs; }
        public GestureBinding Binding {get;}
        public long AtMs {get;}
        public string BindingId => Binding.Id;
        public string Command => Binding.Command;
        public GestureKind Kind => Binding.Kind;
    }
}
