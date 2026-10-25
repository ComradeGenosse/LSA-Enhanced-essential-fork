using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Enhanced.VehicleHud
{
    // Pure gameplay presentation. Never interprets experimental wheel-slot
    // values as physical wheel health, brake faults or alignment diagnoses.
    public sealed class HudAlert
    {
        public readonly string Text;
        public readonly int Severity; // 0 notice, 1 warning, 2 critical
        public HudAlert(string text,int severity) { Text=text; Severity=severity; }
    }
    public sealed class VehicleHudPresentation
    {
        public readonly string Status;
        public readonly int Severity;
        public readonly HudAlert[] Alerts;
        VehicleHudPresentation(string status,int severity,HudAlert[] alerts)
        { Status=status; Severity=severity; Alerts=alerts; }

        // 0 unknown, 1 no reported burst, 2 puncture. "No burst" must not
        // be called "healthy wheel": rim, axle and mod state are not measured.
        public static int WheelState(VehicleReading reading,int corner)
        {
            if (reading == null || corner < 0 || corner > 3) return 0;
            int bit = 1 << corner;
            if ((reading.KnownTires & bit) == 0) return 0;
            return (reading.BurstTires & bit) != 0 ? 2 : 1;
        }
        public static int HealthPercent(float raw)
        {
            if (float.IsNaN(raw) || float.IsInfinity(raw) || raw < 0f || raw > 5000f) return -1;
            return (int)Math.Round(Math.Max(0,Math.Min(100,raw / 10f)));
        }
        public static VehicleHudPresentation Build(VehicleView view,long nowMs)
        {
            if (view?.Reading == null) return null;
            var r = view.Reading;
            int engine = HealthPercent(r.Engine), body=HealthPercent(r.Body), tank=HealthPercent(r.Tank);
            string status = "MONITORING";
            int severity = 0;
            if ((r.KnownTires & r.BurstTires) != 0) { status = "TIRE PUNCTURE"; severity = 2; }
            else if (engine >= 0 && engine <= 25 || tank >= 0 && tank <= 25 || body >= 0 && body <= 20) {
                status = "CRITICAL DAMAGE"; severity = 2;
            } else if (engine >= 0 && engine <= 65 || body >= 0 && body <= 60 || tank >= 0 && tank <= 60) {
                status = "DAMAGE DETECTED"; severity = 1;
            } else if (r.KnownTires != 15) status = "TIRE DATA LIMITED";
            if (view.DriftHint != null && severity == 0) { status = "POSSIBLE DRIFT"; severity = 1; }

            var alerts = new List<HudAlert>();
            foreach (var item in (view.Events ?? new DamageEvent[0]).Reverse()) {
                if (item == null || item.AtMs > nowMs || nowMs-item.AtMs > 9000) continue;
                var alert = Translate(item.Text);
                if (alert == null || alerts.Any(existing => existing.Text == alert.Text)) continue;
                alerts.Add(alert);
                if (alerts.Count == 2) break;
            }
            return new VehicleHudPresentation(status,severity,alerts.ToArray());
        }
        public static HudAlert Translate(string source)
        {
            if (string.IsNullOrEmpty(source)) return null;
            // Raw RPH wheel health slots and anonymous chassis probes are only
            // displayed in Advanced Diagnostics, never misleading driving alerts.
            if (source.StartsWith("Wheel slot ",StringComparison.Ordinal) ||
                source.StartsWith("Tire slot ",StringComparison.Ordinal) ||
                source.StartsWith("Chassis probe ",StringComparison.Ordinal)) return null;
            if (source.EndsWith(" tire burst",StringComparison.Ordinal)) {
                string corner=source.Substring(0,source.Length-" tire burst".Length);
                return new HudAlert(corner.ToUpperInvariant()+" TIRE PUNCTURED",2);
            }
            if (source.EndsWith(" tire repaired",StringComparison.Ordinal)) {
                string corner=source.Substring(0,source.Length-" tire repaired".Length);
                return new HudAlert(corner.ToUpperInvariant()+" TIRE REPAIRED",0);
            }
            if (source.StartsWith("Major body damage",StringComparison.Ordinal))
                return new HudAlert("HEAVY BODY IMPACT",2);
            if (source.StartsWith("Body -",StringComparison.Ordinal))
                return new HudAlert("BODY DAMAGE",1);
            if (source.StartsWith("Engine -",StringComparison.Ordinal))
                return new HudAlert("ENGINE DAMAGE",1);
            if (source.StartsWith("Fuel tank -",StringComparison.Ordinal))
                return new HudAlert("FUEL TANK DAMAGED",1);
            if (source.StartsWith("Possible ",StringComparison.Ordinal) && source.Contains(" drift"))
                return new HudAlert("POSSIBLE LATERAL DRIFT",1);
            if (source.EndsWith(" repaired",StringComparison.Ordinal))
                return new HudAlert("COMPONENT REPAIRED",0);
            return null;
        }
    }
}