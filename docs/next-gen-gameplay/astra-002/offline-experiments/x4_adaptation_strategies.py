"""X-4 (offline part of E3/E7): adaptation policies under player improvisation, world
disruption and session reloads.

Strategies S0-S4 are defined in gea/adaptation.py. Player models: planner (follows a
shortest solution), creative (prefers alternative solutions), chaotic (violent random
half the time), wanderer (disengaged). Model latency, bad-plan rate and critic detection
are parameters, not measurements; the sweep shows where the conclusions flip.
"""
import json
import os
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gea.adaptation import Params, run_episode  # noqa: E402
from gea.fixtures import courier_job_x4, LOST_DOG_OUTING  # noqa: E402

EPISODES = int(os.environ.get("X4_EPISODES", "120"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "x4_adaptation_strategies.json")
UNSATISFYING = {"dead_experience", "aborted_by_reload", "timeout_in_progress"}


def cell(args):
    exp_name, strategy, player, pdict, episodes = args
    exp = courier_job_x4() if exp_name == "courier_job" else LOST_DOG_OUTING
    params = Params(**pdict)
    outs = [run_episode(exp, strategy, player, params, seed=10_000 + i) for i in range(episodes)]
    oc = Counter(o["outcome"] for o in outs)
    mean = lambda k: round(sum(o[k] for o in outs) / len(outs), 3)
    return {"experience": exp_name, "strategy": strategy, "player": player, "params": pdict,
            "outcomes": dict(oc), "success": round(oc.get("END_SUCCESS", 0) / len(outs), 3),
            "success_moved": round(oc.get("END_SUCCESS_MOVED", 0) / len(outs), 3),
            "concluded": round(oc.get("END_CONCLUDED", 0) / len(outs), 3),
            "failed": round(oc.get("END_FAILURE", 0) / len(outs), 3),
            "unsatisfying": round(sum(oc.get(k, 0) for k in UNSATISFYING) / len(outs), 3),
            "disturbances": mean("disturbances"), "redesigns": mean("redesigns"),
            "churn": mean("churn"), "incoherent_shown": mean("incoherent_shown"),
            "coherence_breaks": mean("coherence_breaks"), "model_calls": mean("model_calls"),
            "limbo_steps": mean("limbo"), "stall_steps": mean("stall"), "resumed": mean("resumed")}


def main():
    t0 = time.time()
    jobs = []
    conditions = {"normal": {"q_world": 0.03, "p_reload": 0.1}, "turbulent": {"q_world": 0.08, "p_reload": 0.3}}
    for exp_name in ("courier_job", "outing"):
        for cname, cond in conditions.items():
            for strategy in ("S0", "S1", "S2", "S3", "S4"):
                for player in ("planner", "creative", "chaotic", "wanderer"):
                    if exp_name == "outing" and player == "creative":
                        continue
                    jobs.append((exp_name, strategy, player, dict(cond), EPISODES))
    sweep = []
    for p_bad in (0.05, 0.15, 0.30):
        for lat in ((0, 0), (0, 1), (1, 2)):
            for strategy in ("S1", "S2"):
                for player in ("planner", "chaotic"):
                    sweep.append(("courier_job", strategy, player, {"p_bad": p_bad, "latency": lat, "q_world": 0.08, "p_reload": 0.0}, EPISODES))
    for cov in (1.0, 0.5, 0.0):
        for strategy in ("S3", "S4"):
            for player in ("planner", "chaotic"):
                sweep.append(("courier_job", strategy, player, {"coverage": cov, "q_world": 0.08, "p_reload": 0.0}, EPISODES))
    with ProcessPoolExecutor(max_workers=max(1, min(4, os.cpu_count() or 1))) as ex:
        main_res = list(ex.map(cell, jobs))
        sweep_res = list(ex.map(cell, sweep))
    out = {"experiment": "X-4 adaptation strategies (offline, parameterised model behaviour)",
           "episodes_per_cell": EPISODES, "conditions": conditions, "main": main_res, "sweep": sweep_res,
           "seconds": round(time.time() - t0, 1),
           "revision": "run 2 (2026-10-19): disturbances also hit the roles that carry critical roles; world-model kill/destroy bugs fixed; success after moved goalposts reported as END_SUCCESS_MOVED. Run 1 is kept in results/run1-superseded/.",
           "caveat": "Abstract world and synthetic players. Model latency/bad-plan/critic rates are assumptions; see sweep."}
    with open(OUT, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=2)
    print("%-11s %-9s %-3s %-9s succ  moved concl fail  unsat churn incoh brk  calls limbo stall dist" % ("exp", "cond", "S", "player"))
    for r in main_res:
        cond = "turbulent" if r["params"]["q_world"] > 0.05 else "normal"
        print("%-11s %-9s %-3s %-9s %.2f  %.2f  %.2f  %.2f  %.2f  %.2f  %.2f  %.2f %.2f  %.2f  %.2f  %.2f" % (
            r["experience"], cond, r["strategy"], r["player"], r["success"], r["success_moved"], r["concluded"], r["failed"],
            r["unsatisfying"], r["churn"], r["incoherent_shown"], r["coherence_breaks"], r["model_calls"], r["limbo_steps"],
            r["stall_steps"], r["disturbances"]))
    print("--- sweep")
    for r in sweep_res:
        print(r["strategy"], r["player"], json.dumps(r["params"]), "succ %.2f moved %.2f concl %.2f unsat %.2f churn %.2f incoh %.2f brk %.2f calls %.2f limbo %.2f" % (
            r["success"], r["success_moved"], r["concluded"], r["unsatisfying"], r["churn"], r["incoherent_shown"], r["coherence_breaks"],
            r["model_calls"], r["limbo_steps"]))


if __name__ == "__main__":
    main()
