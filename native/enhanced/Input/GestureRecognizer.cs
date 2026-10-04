using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Enhanced.Input
{
    // Pure gesture engine: no RPH, Windows or Essential types. Keys that share a
    // chord form one group, and each group runs one small state machine:
    //   Idle -> Pending (first key down) -> ChordArmed (chord-hold only) -> Consumed
    // A tap can only fire from Pending and a chord only when the second key
    // arrives inside the chord window while the first is still held, so a chord
    // never also produces taps. Every output waits in Consumed until all keys of
    // the group are released; nothing repeats while held.
    public sealed class GestureRecognizer
    {
        enum State { Idle, Pending, ChordArmed, TapReleased, Consumed }
        sealed class Group
        {
            public int Mask, Previous, First, ChordMask;
            public State State;
            public long PendingAt, ChordAt, ReleasedAt;
            public bool WindowElapsed;
        }
        readonly GestureTiming timing;
        readonly List<Group> groups = new List<Group>();
        readonly GestureBinding[] tap, hold, doubleTap;
        readonly Dictionary<int,GestureBinding> chord = new Dictionary<int,GestureBinding>(), chordHold = new Dictionary<int,GestureBinding>();
        readonly bool[] inChord;
        public GestureRecognizer(IReadOnlyList<GestureBinding> bindings,GestureTiming timing,int keyCount)
        {
            if (keyCount < 1 || keyCount > 16) throw new ArgumentOutOfRangeException(nameof(keyCount));
            this.timing = timing ?? throw new ArgumentNullException(nameof(timing));
            tap = new GestureBinding[keyCount]; hold = new GestureBinding[keyCount]; doubleTap = new GestureBinding[keyCount]; inChord = new bool[keyCount];
            var parent = Enumerable.Range(0,keyCount).ToArray();
            int Find(int key) => parent[key] == key ? key : parent[key] = Find(parent[key]);
            int bound = 0;
            foreach (var binding in bindings) {
                bound |= binding.Mask;
                switch (binding.Kind) {
                    case GestureKind.Tap: tap[binding.Keys[0]] = binding; break;
                    case GestureKind.Hold: hold[binding.Keys[0]] = binding; break;
                    case GestureKind.DoubleTap: doubleTap[binding.Keys[0]] = binding; break;
                    case GestureKind.Chord: chord[binding.Mask] = binding; break;
                    case GestureKind.ChordHold: chordHold[binding.Mask] = binding; break;
                }
                if (binding.Keys.Count == 2) { inChord[binding.Keys[0]] = inChord[binding.Keys[1]] = true; parent[Find(binding.Keys[0])] = Find(binding.Keys[1]); }
            }
            foreach (var root in Enumerable.Range(0,keyCount).Where(key => (bound & 1 << key) != 0).GroupBy(Find))
                groups.Add(new Group {Mask = root.Aggregate(0,(mask,key) => mask | 1 << key)});
        }
        public GestureTiming Timing => timing;
        // Focus loss, pause and gate closure: every group waits for a full release,
        // so a key still held when input resumes can never fire or stick.
        public void Reset() { foreach (var group in groups) { group.State = State.Consumed; group.Previous = 0; } }
        public void Update(long nowMs,int downMask,List<GestureEvent> output)
        {
            foreach (var group in groups) Step(group,nowMs,downMask & group.Mask,output);
        }
        static int Bit(int key) => 1 << key;
        static int Count(int mask) { int count = 0; for (; mask != 0; mask &= mask - 1) count++; return count; }
        static int Lowest(int mask) { for (int key = 0; key < 32; key++) if ((mask & 1 << key) != 0) return key; return -1; }
        bool Ambiguous(int key) => inChord[key] || hold[key] != null || doubleTap[key] != null;
        void Emit(GestureBinding binding,long nowMs,List<GestureEvent> output) { if (binding != null) output.Add(new GestureEvent(binding,nowMs)); }
        void Step(Group group,long now,int down,List<GestureEvent> output)
        {
            int pressed = down & ~group.Previous;
            group.Previous = down;
            switch (group.State) {
                case State.Idle: Press(group,now,down,pressed,output); break;
                case State.Pending: {
                    int key = group.First;
                    if ((down & Bit(key)) == 0) {
                        // Released: a tap, unless a double tap might still follow.
                        if (doubleTap[key] != null) { group.State = State.TapReleased; group.ReleasedAt = now; }
                        else { Emit(tap[key],now,output); group.State = State.Idle; }
                        int others = down & ~Bit(key);
                        if (others != 0) { if (group.State == State.TapReleased) { Emit(tap[key],now,output); group.State = State.Idle; } Press(group,now,others,others & pressed,output); }
                        break;
                    }
                    long held = now - group.PendingAt;
                    if (!group.WindowElapsed && held > timing.ChordWindowMs) {
                        group.WindowElapsed = true;
                        // No chord inside the window. Without a hold binding the tap
                        // fires now, so a long press never waits for release, and a
                        // second key arriving late (a near miss) is swallowed.
                        if (hold[key] == null) { Emit(tap[key],now,output); group.State = State.Consumed; break; }
                    }
                    int added = pressed & ~Bit(key);
                    if (added != 0) {
                        int pair = Bit(key) | added;
                        if (!group.WindowElapsed && Count(added) == 1 && (chord.ContainsKey(pair) || chordHold.ContainsKey(pair))) Arm(group,pair,now,output);
                        else group.State = State.Consumed; // late or unbound second key: suppress everything
                        break;
                    }
                    if (group.WindowElapsed && hold[key] != null && held >= timing.HoldMs) { Emit(hold[key],now,output); group.State = State.Consumed; }
                    break;
                }
                case State.ChordArmed:
                    if ((down & group.ChordMask) != group.ChordMask) {
                        // Released before the hold: the chord fires on release.
                        chord.TryGetValue(group.ChordMask,out var released); Emit(released,now,output);
                        group.State = down == 0 ? State.Idle : State.Consumed;
                    } else if ((down & ~group.ChordMask) != 0) group.State = State.Consumed;
                    else if (now - group.ChordAt >= timing.HoldMs) { Emit(chordHold[group.ChordMask],now,output); group.State = State.Consumed; }
                    break;
                case State.TapReleased: {
                    int key = group.First;
                    if (pressed == Bit(key) && now - group.ReleasedAt <= timing.DoubleTapMs) { Emit(doubleTap[key],now,output); group.State = State.Consumed; break; }
                    if (pressed != 0 || now - group.ReleasedAt > timing.DoubleTapMs) {
                        Emit(tap[key],now,output); group.State = State.Idle;
                        if (pressed != 0) Press(group,now,down,pressed,output);
                    }
                    break;
                }
                case State.Consumed:
                    if (down == 0) group.State = State.Idle;
                    break;
            }
        }
        void Press(Group group,long now,int down,int pressed,List<GestureEvent> output)
        {
            if (pressed == 0) return;
            if (down != pressed) { group.State = State.Consumed; return; } // a key was already down without an owner
            if (Count(pressed) == 2 && (chord.ContainsKey(pressed) || chordHold.ContainsKey(pressed))) { Arm(group,pressed,now,output); return; }
            if (Count(pressed) != 1) { group.State = State.Consumed; return; }
            int key = Lowest(pressed);
            if (!Ambiguous(key)) { Emit(tap[key],now,output); group.State = State.Consumed; return; } // nothing to wait for
            group.State = State.Pending; group.First = key; group.PendingAt = now; group.WindowElapsed = false;
        }
        void Arm(Group group,int pair,long now,List<GestureEvent> output)
        {
            if (chordHold.ContainsKey(pair)) { group.State = State.ChordArmed; group.ChordMask = pair; group.ChordAt = now; return; }
            Emit(chord[pair],now,output); group.State = State.Consumed; // fires on press
        }
        // Worst-case added latency for a key's single action, reported at load.
        public int TapLatencyMs(int key)
        {
            if (key < 0 || key >= tap.Length || tap[key] == null) return 0;
            int latency = inChord[key] ? timing.ChordWindowMs : 0;
            if (hold[key] != null) latency = Math.Max(latency,timing.HoldMs);
            if (doubleTap[key] != null) latency += timing.DoubleTapMs;
            return latency;
        }
    }
}
