using System;
using System.Collections.Generic;
using System.Linq;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Settings;

namespace LSA.Enhanced.Input
{
    // Per-frame gesture router in the loader's AppDomain. Steam Input maps L4/R4
    // to router-only keys; this class polls them, recognizes taps and chords,
    // applies the input gates and hands catalog commands to the dispatcher.
    // Essential's own keys are only ever reached through the relay.
    public sealed class InputRouter
    {
        const int SnapshotRefreshMs = 100, InterestRefreshMs = 1000, InterestMs = 1500;
        readonly IKeySource keys;
        readonly IGameState game;
        readonly LoaderDispatcher dispatcher;
        readonly INativeBridge bridge;
        readonly IClock clock;
        readonly IHud hud;
        readonly Action<string> log;
        readonly List<GestureEvent> events = new List<GestureEvent>();
        EnhancedSettings settings;
        GestureRecognizer recognizer;
        NativeSnapshot snapshot;
        long nextSnapshotRead, nextInterest;
        bool gated, focused;
        public InputRouter(IKeySource keys,IGameState game,LoaderDispatcher dispatcher,INativeBridge bridge,IClock clock,IHud hud,Action<string> log)
        {
            this.keys = keys; this.game = game; this.dispatcher = dispatcher; this.bridge = bridge; this.clock = clock; this.hud = hud; this.log = log ?? (_ => { });
        }
        public Func<bool> MenuOpen = () => false;
        public Func<bool> UiAvailable = () => false;
        // Session-only overrides from the Controls page; a settings reload keeps them.
        public bool GesturesPaused {get;set;}
        public int? SessionChordWindowMs {get;private set;}
        EssentialBindings essential;
        public string State {get;private set;} = "disabled";
        public string Conflict {get;private set;}
        public IReadOnlyList<GestureBinding> ActiveBindings {get;private set;} = new GestureBinding[0];
        public EnhancedSettings Settings => settings;
        // Settings, Essential's keys and UI availability can all change while
        // playing; every change rebuilds the recognizer between frames.
        public void Apply(EnhancedSettings next,EssentialBindings essential)
        {
            settings = next; this.essential = essential; recognizer = null; Conflict = null; ActiveBindings = new GestureBinding[0];
            dispatcher.ReleaseKeys();
            if (next == null || !next.InputEnabled) { SetState("disabled"); return; }
            bool ui = UiAvailable();
            var bindings = next.Bindings.Where(binding => ui || !binding.Command.StartsWith("ui.",StringComparison.Ordinal)).ToList();
            foreach (int key in bindings.SelectMany(binding => binding.Keys).Distinct()) {
                var clash = essential?.ConflictWith(next.KeyCodes[key]);
                if (clash != null) {
                    // A router key that is also an Essential key would fire twice.
                    Conflict = next.KeyNames[key] + "=" + PhysicalKeys.Name(next.KeyCodes[key]) + " is also Essential's " + clash.Setting;
                    SetState("suspended");
                    hud.Show("Input paused: " + PhysicalKeys.Name(next.KeyCodes[key]) + " is also Essential's " + clash.Setting);
                    return;
                }
            }
            if (bindings.Count == 0) { SetState("no_bindings"); return; }
            var timing = SessionChordWindowMs.HasValue ? new GestureTiming(SessionChordWindowMs.Value,Math.Max(next.Timing.HoldMs,SessionChordWindowMs.Value + 100),next.Timing.DoubleTapMs) : next.Timing;
            recognizer = new GestureRecognizer(bindings,timing,next.KeyCodes.Count);
            // A router key held across the rebuild waits for its release instead of
            // starting a gesture mid-press.
            if (next.KeyCodes.Any(keys.IsDown)) recognizer.Reset();
            ActiveBindings = bindings.AsReadOnly();
            gated = false;
            log("[UX] input_latency " + string.Join(" ",next.KeyNames.Select((name,index) => name + "=" + recognizer.TapLatencyMs(index) + "ms")));
            SetState("ready");
        }
        public void SetSessionChordWindow(int? ms)
        {
            SessionChordWindowMs = ms.HasValue ? Math.Max(40,Math.Min(250,ms.Value)) : (int?)null;
            if (settings != null) Apply(settings,essential);
        }
        public int ChordWindowMs => SessionChordWindowMs ?? settings?.Timing.ChordWindowMs ?? GestureTiming.Default.ChordWindowMs;
        void SetState(string value) { if (State != value) { State = value; log("[UX] input_router state=" + value + (Conflict != null ? " conflict=" + Conflict : "")); } }
        public NativeSnapshot Snapshot(long utcNow)
        {
            long now = clock.Monotonic;
            if (now >= nextSnapshotRead) { snapshot = NativeSnapshot.Parse(bridge.Snapshot()); nextSnapshotRead = now + SnapshotRefreshMs; }
            return snapshot;
        }
        public void Tick()
        {
            dispatcher.Update();
            if (recognizer == null) return;
            long now = clock.Monotonic,utc = clock.Utc;
            bool focus = keys.GameHasFocus();
            if (!focus && focused) dispatcher.ReleaseKeys(); // a synthesized key can never stick
            focused = focus;
            // Keep Essential's gates fresh while gestures can act.
            if (focus && now >= nextInterest) { bridge.RequestSnapshots(InterestMs); nextInterest = now + InterestRefreshMs; }
            bool menuOpen = MenuOpen();
            string closed = InputGates.Closed(focus,game,false,Snapshot(utc),utc);
            if (closed != null) {
                if (!gated) { recognizer.Reset(); gated = true; SetState("gated:" + closed); }
                return;
            }
            if (gated) { gated = false; SetState("ready"); }
            int down = 0;
            for (int key = 0; key < settings.KeyCodes.Count; key++) if (keys.IsDown(settings.KeyCodes[key])) down |= 1 << key;
            events.Clear();
            recognizer.Update(now,down,events);
            foreach (var gesture in events) {
                // While an LSA menu is open only menu toggles pass; RNUI owns navigation.
                if ((menuOpen || GesturesPaused) && !gesture.Command.StartsWith("ui.",StringComparison.Ordinal)) continue;
                dispatcher.Dispatch(gesture.Command,"chord");
            }
        }
        public void Stop() { recognizer = null; dispatcher.Stop(); SetState("stopped"); }
    }
}
