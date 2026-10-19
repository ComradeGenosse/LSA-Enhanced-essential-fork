"""X-3 (offline part of E6): surface variety vs mechanical novelty, and expressive range.

Compares a template-randomising baseline (the shape of existing GTA mission-generator
mods) with the fluent/policy algebra generator, measured by the same IR-level functions.
Also reports which mechanics the validator filters out (validation bias) and the
expressive range over (pressure, solution diversity).

Mechanical novelty is NOT fun. This experiment can show that a generator produces
structurally different gameplay; only E6 with players can show it is enjoyable.
"""
import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gea.generator import AlgebraGenerator, TemplateGenerator  # noqa: E402
from gea.novelty import diversity_report, archetype_sequence, mechanic_features  # noqa: E402
from gea.runner import validate_many  # noqa: E402

N = int(os.environ.get("X3_N", "300"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "x3_novelty_expressive_range.json")
SINGLE = {"steal_car_deliver", "acquire_vehicle", "kill_target", "deliver_item", "retrieve_item", "intercept",
          "escort_rescue", "race", "tail", "hold_area", "investigate", "meet", "disable_vehicle"}


def pressure(exp):
    caps = set()
    for s in exp["stages"]:
        for p in s.get("policies", []):
            if p["cap"].startswith("gm_") and p["cap"] != "gm_follow_player":
                caps.add(p["cap"])
        for r in s.get("rules", []):
            for x in r.get("then", []):
                if x["do"] == "activate" and x.get("cap", "").startswith("gm_") and x["cap"] != "gm_follow_player":
                    caps.add(x["cap"] + "*")
    return len(caps)


def run(name, gen):
    exps = [gen.generate(i) for i in range(N)]
    res = validate_many(exps, mode="lab", nodes=3000)
    valid = [(e, r) for e, r in zip(exps, res) if r["valid"]]
    rep = diversity_report([e for e, _ in valid])
    grid = Counter()
    for e, r in valid:
        grid[(min(pressure(e), 4), min(r["shapes"], 6))] += 1
    seqs = Counter(archetype_sequence(e) for e, _ in valid)
    multi = sum(v for k, v in seqs.items() if len(k) > 1 and len(set(k)) > 1)
    beyond_single = sum(v for k, v in seqs.items() if not (len(k) == 1 and k[0] in SINGLE))
    rel_gen = Counter(f for e in exps for f in e["meta"]["features"] if f.startswith("rel:") or f.startswith("template:"))
    rel_valid = Counter(f for e, _ in valid for f in e["meta"]["features"] if f.startswith("rel:") or f.startswith("template:"))
    bias = {k: [rel_gen[k], rel_valid.get(k, 0), round(rel_valid.get(k, 0) / rel_gen[k], 3)] for k in sorted(rel_gen)}
    stages = Counter(len(e["stages"]) for e, _ in valid)
    return {
        "generated": N, "valid": len(valid), "validity_rate": round(len(valid) / N, 3),
        "diversity": rep,
        "expressive_range_grid_pressure_x_solution_shapes": {"%d,%d" % k: v for k, v in sorted(grid.items())},
        "stage_count_distribution": dict(sorted(stages.items())),
        "multi_archetype_share": round(multi / max(1, len(valid)), 3),
        "share_beyond_single_archetype_templates": round(beyond_single / max(1, len(valid)), 3),
        "validation_bias_by_relation[generated,valid,rate]": bias,
        "mean_solution_shapes": round(sum(r["shapes"] for _, r in valid) / max(1, len(valid)), 2),
        "example_valid_ids": [e["id"] for e, _ in valid[:5]],
    }, valid


def plot(results, path):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return False
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.6), sharey=True)
    for ax, (name, res) in zip(axes, results.items()):
        grid = [[0] * 5 for _ in range(7)]
        for k, v in res["expressive_range_grid_pressure_x_solution_shapes"].items():
            x, y = map(int, k.split(","))
            grid[y][x] = v
        im = ax.imshow(grid, origin="lower", cmap="viridis", aspect="auto")
        ax.set_title("%s (valid %d/%d)" % (name, res["valid"], res["generated"]))
        ax.set_xlabel("distinct pressure types")
        for y in range(7):
            for x in range(5):
                if grid[y][x]:
                    ax.text(x, y, str(grid[y][x]), ha="center", va="center", color="w", fontsize=7)
    axes[0].set_ylabel("distinct solution shapes (cap 6)")
    fig.suptitle("X-3 expressive range (abstract model, offline)", fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    return True


def main():
    t0 = time.time()
    results, valids = {}, {}
    for name, gen in (("template_baseline", TemplateGenerator(seed=3)), ("algebra", AlgebraGenerator(seed=3))):
        results[name], valids[name] = run(name, gen)
    # held-out style check: how many algebra mechanics never occur in the template set at all
    tfeat = set().union(*[mechanic_features(e) for e, _ in valids["template_baseline"]]) if valids["template_baseline"] else set()
    afeat = [mechanic_features(e) for e, _ in valids["algebra"]]
    disjoint = sum(1 for f in afeat if not (f & {x for x in tfeat if x.startswith("obj:")}))
    results["algebra"]["share_with_no_template_objective"] = round(disjoint / max(1, len(afeat)), 3)
    results["seconds"] = round(time.time() - t0, 1)
    results["caveat"] = "Abstract model; validity = solvable+stakes in the model. Mechanical novelty is not evidence of fun."
    png = os.path.join(os.path.dirname(OUT), "x3_expressive_range.png")
    results["plot"] = os.path.basename(png) if plot({k: v for k, v in results.items() if isinstance(v, dict) and "valid" in v}, png) else None
    with open(OUT, "w", encoding="utf8") as fh:
        json.dump(results, fh, indent=2)
    for name in ("template_baseline", "algebra"):
        r = results[name]
        print(name, "valid", r["valid"], "/", r["generated"], json.dumps({k: v for k, v in r["diversity"].items() if k != "top_archetype_sequences"}))
        print("  beyond-single-archetype share", r["share_beyond_single_archetype_templates"], "multi", r["multi_archetype_share"], "mean shapes", r["mean_solution_shapes"])
    print("algebra share with no template objective", results["algebra"]["share_with_no_template_objective"])


if __name__ == "__main__":
    main()
