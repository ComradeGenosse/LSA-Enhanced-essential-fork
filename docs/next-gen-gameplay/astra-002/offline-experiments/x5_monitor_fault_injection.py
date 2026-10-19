"""X-5 (offline part of E1): can an objective monitor refuse fabricated completion while
still recognising genuine completion quickly?

Synthetic traces of a 'deliver the van to the safehouse' objective sampled at ~4 Hz.
Ground truth: the van genuinely arrives at time T* (or never). Faults are injected that
mirror real LSA failure modes recorded in the repository: model narration claiming
success, handler acknowledgements (D-017: acceptance != completion), stale epochs after
reconnect (C-13), handle reuse (identifier taxonomy row 1), teleports, out-of-order and
duplicate delivery, dropouts, unauthenticated frames, pre-activation state, sensor flicker.

Measures false 'achieved' (a fabricated or early completion) and false negatives /
latency of the evidence-ladder monitor versus naive monitors.
"""
import json
import os
import random
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gea.monitor import MONITORS, Stamp  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "x5_monitor_fault_injection.json")
FAULTS = ["claim", "ack", "stale_epoch", "handle_reuse", "teleport", "out_of_order", "duplicate", "dropout",
          "unauth", "pre_activation", "flicker"]
TARGET = (100.0, 0.0)
RADIUS = 15.0


def make_trace(rng):
    host, epoch, inc = "h1", 7, "inc-A"
    t_act = 2000
    genuine = rng.random() < 0.5
    t_star = rng.randrange(6000, 20000) if genuine else None
    end = 30000
    faults = rng.sample(FAULTS, rng.randint(1, 3))
    ev = []
    # genuine motion: van approaches the target at ~8 m/s from 220 m away, arrives at t_star
    t = 0
    while t <= end:
        if t_star is not None:
            frac = min(1.0, max(0.0, t / t_star))
            x = 220 - (220 - TARGET[0]) * frac
        else:
            x = 220 - min(110, t / 1000.0 * 4)  # wanders but never reaches
        pos = (x, 0.0)
        inside = abs(x - TARGET[0]) <= RADIUS and (t_star is not None and t >= t_star)
        if "dropout" in faults and 9000 <= t <= 12000:
            t += 250
            continue
        ev.append({"t": t, "source": "native_sensor", "authenticated": True, "host": host, "epoch": epoch,
                   "incarnation": inc, "value": inside, "pos": pos})
        if "duplicate" in faults and rng.random() < 0.3:
            ev.append(dict(ev[-1]))
        t += 250
    def inject(e):
        ev.append(e)
    fake_t = rng.randrange(2500, 9000)
    if "claim" in faults:
        inject({"t": fake_t, "source": "model_text", "value": True})
    if "ack" in faults:
        inject({"t": fake_t, "source": "handler_ack", "value": True})
    if "stale_epoch" in faults:
        for k in range(4):
            inject({"t": fake_t + 250 * k + 10, "source": "native_sensor", "authenticated": True, "host": host, "epoch": epoch - 1,
                    "incarnation": inc, "value": True, "pos": TARGET})
    if "handle_reuse" in faults:
        for k in range(6):
            inject({"t": fake_t + 250 * k + 20, "source": "native_sensor", "authenticated": True, "host": host, "epoch": epoch,
                    "incarnation": "inc-B", "value": True, "pos": TARGET})
    if "teleport" in faults:
        for k in range(3):
            inject({"t": fake_t + 250 * k + 30, "source": "native_sensor", "authenticated": True, "host": host, "epoch": epoch,
                    "incarnation": inc, "value": True, "pos": TARGET})
    if "unauth" in faults:
        for k in range(4):
            inject({"t": fake_t + 250 * k + 40, "source": "native_sensor", "authenticated": False, "host": host, "epoch": epoch,
                    "incarnation": inc, "value": True, "pos": TARGET})
    if "pre_activation" in faults:
        for k in range(4):
            inject({"t": 500 + 250 * k + 50, "source": "native_sensor", "authenticated": True, "host": host, "epoch": epoch,
                    "incarnation": inc, "value": True, "pos": TARGET})
    if "flicker" in faults:
        inject({"t": fake_t + 60, "source": "native_sensor", "authenticated": True, "host": host, "epoch": epoch,
                "incarnation": inc, "value": True, "pos": (ev[0]["pos"][0], 0.0)})
    ev.sort(key=lambda e: e["t"])
    if "out_of_order" in faults:
        # a delayed true sample with an old timestamp is delivered after newer frames
        late = {"t": fake_t, "source": "native_sensor", "authenticated": True, "host": host, "epoch": epoch,
                "incarnation": inc, "value": True, "pos": TARGET}
        idx = next((i for i, e in enumerate(ev) if e["t"] > fake_t + 3000), len(ev))
        ev.insert(idx, late)
    return ev, Stamp(host, epoch, inc, t_act), t_star, faults


def main():
    rng = random.Random(2026)
    n = 20000
    stats = {m: {"false_achieved": 0, "early_achieved": 0, "missed": 0, "genuine": 0, "fabricated_traces": 0,
                 "latency_ms": []} for m in MONITORS}
    by_fault = defaultdict(lambda: Counter())
    for _ in range(n):
        ev, stamp, t_star, faults = make_trace(rng)
        for name, fn in MONITORS.items():
            got = fn(ev, stamp)
            s = stats[name]
            if t_star is None:
                s["fabricated_traces"] += 1
                if got is not None:
                    s["false_achieved"] += 1
                    for f in faults:
                        by_fault[name][f] += 1
            else:
                s["genuine"] += 1
                if got is None:
                    s["missed"] += 1
                elif got < t_star:
                    s["early_achieved"] += 1
                    for f in faults:
                        by_fault[name]["early:" + f] += 1
                else:
                    s["latency_ms"].append(got - t_star)
    out = {"experiment": "X-5 objective monitor fault injection (offline, synthetic traces)", "traces": n, "monitors": {}}
    for name, s in stats.items():
        lat = sorted(s["latency_ms"])
        out["monitors"][name] = {
            "false_achieved_rate_on_never_true": round(s["false_achieved"] / max(1, s["fabricated_traces"]), 4),
            "early_achieved_rate_on_genuine": round(s["early_achieved"] / max(1, s["genuine"]), 4),
            "missed_rate_on_genuine": round(s["missed"] / max(1, s["genuine"]), 4),
            "latency_ms_p50": lat[len(lat) // 2] if lat else None,
            "latency_ms_p95": lat[int(len(lat) * 0.95)] if lat else None,
            "false_or_early_by_fault": dict(by_fault[name].most_common(12)),
        }
    out["caveat"] = "Synthetic traces. Demonstrates the contract's guards, not GTA sensor behaviour (E0/E1 measure that)."
    with open(OUT, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=2)
    for name, m in out["monitors"].items():
        print("%-20s false=%.4f early=%.4f missed=%.4f p50=%s p95=%s" % (name, m["false_achieved_rate_on_never_true"],
              m["early_achieved_rate_on_genuine"], m["missed_rate_on_genuine"], m["latency_ms_p50"], m["latency_ms_p95"]))


if __name__ == "__main__":
    main()
