using System;
using System.Collections.Generic;

namespace LSA.Enhanced.VehicleHud
{
    // Pure, RPH-free diagnostics. All values are sampled from the driven vehicle.
    // Brake wear, alignment, and suspension damage are NOT GTA-native health meters.
    public sealed class VehicleReading
    {
        public int Handle;
        public float Engine, Body, Tank;
        public int KnownTires; // bits: front-left, front-right, rear-left, rear-right
        public int BurstTires;
        public bool OnAllWheels;
        public bool MovingForward;
        public float SpeedMps, SteeringDegrees, LateralSpeedMps;
    }

    public sealed class DamageEvent
    {
        public long AtMs;
        public string Text;
        public DamageEvent(long atMs,string text) { AtMs = atMs; Text = text; }
    }

    public sealed class VehicleView
    {
        public readonly VehicleReading Reading;
        public readonly string DriftHint;
        public readonly DamageEvent[] Events;
        public VehicleView(VehicleReading reading,string driftHint,DamageEvent[] events)
        { Reading = reading; DriftHint = driftHint; Events = events; }
    }

    public sealed class VehicleDamageTimeline
    {
        const int MaxEvents = 5;
        static readonly string[] TireNames = {"Front-left","Front-right","Rear-left","Rear-right"};
        readonly List<DamageEvent> events = new List<DamageEvent>();
        VehicleReading previous;
        string driftDirection;
        long driftSince, driftLastEvent;
        public VehicleView Current {get;private set;}
        public void Clear()
        {
            previous = null; events.Clear(); driftDirection = null; driftSince = 0; driftLastEvent = 0;
            Current = null;
        }
        public void Update(VehicleReading next,long timeMs)
        {
            if (next == null || next.Handle <= 0) { Clear(); return; }
            if (previous == null || previous.Handle != next.Handle) {
                Clear();
                previous = next;
                Current = new VehicleView(next,null,new DamageEvent[0]);
                return;
            }
            AddHealth("Engine",previous.Engine,next.Engine,timeMs);
            AddHealth("Body",previous.Body,next.Body,timeMs);
            AddHealth("Fuel tank",previous.Tank,next.Tank,timeMs);
            int comparable = previous.KnownTires & next.KnownTires;
            int changed = (previous.BurstTires ^ next.BurstTires) & comparable;
            for (int i = 0; i < 4; i++) {
                int bit = 1 << i;
                if ((changed & bit) != 0) Add(timeMs,TireNames[i] + (((next.BurstTires & bit) != 0) ? " tire burst" : " tire repaired"));
            }
            string drift = Drift(next);
            if (drift == null || drift != driftDirection) { driftDirection = drift; driftSince = timeMs; }
            else if (timeMs - driftSince >= 1600 && timeMs - driftLastEvent >= 12000) {
                Add(timeMs,"Possible " + drift + " drift (inferred)");
                driftLastEvent = timeMs;
            }
            previous = next;
            Current = new VehicleView(next,drift != null && timeMs - driftSince >= 1600 ? "Possible " + drift + " drift (inferred)" : null,events.ToArray());
        }
        // Lateral movement is not proof of alignment or steering pull. Suppress turns,
        // reversing, very slow speeds, airborne states, and large sideways slides.
        public static string Drift(VehicleReading sample)
        {
            if (!sample.OnAllWheels || !sample.MovingForward || sample.SpeedMps < 14f ||
                Math.Abs(sample.SteeringDegrees) > 1.5f ||
                Math.Abs(sample.LateralSpeedMps) < 0.65f ||
                Math.Abs(sample.LateralSpeedMps) > Math.Max(2.5f,sample.SpeedMps * 0.16f)) return null;
            return sample.LateralSpeedMps > 0 ? "rightward" : "leftward";
        }
        void AddHealth(string name,float oldValue,float newValue,long timeMs)
        {
            if (!Finite(oldValue) || !Finite(newValue)) return;
            float change = newValue - oldValue;
            if (change <= -8f) Add(timeMs,name + " -" + Math.Round(-change) + " HP");
            else if (change >= 40f) Add(timeMs,name + " repaired");
        }
        static bool Finite(float v) => !float.IsNaN(v) && !float.IsInfinity(v);
        void Add(long atMs,string message)
        {
            // Short ring buffer per vehicle; no event is persisted to player profiles.
            if (events.Count == MaxEvents) events.RemoveAt(0);
            events.Add(new DamageEvent(atMs,message));
        }
    }
}
