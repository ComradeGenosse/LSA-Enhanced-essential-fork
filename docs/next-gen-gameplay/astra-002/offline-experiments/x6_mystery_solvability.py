"""X-6 (offline part of E5): can a generated mystery be guaranteed fair and repairable?

Compares unchecked clue authoring (a proxy for a writer - human or model - without a
solver) with solver-guided construction. Measures: uniquely solvable, ambiguous,
*misleading* (an unrefuted false testimony points at an innocent), deduction depth,
redundancy, and whether the loss of any single clue (e.g. the witness is shot) can be
repaired with a new verifiable clue.

This checks logic, not discoverability in GTA: clue props/witnesses still need E0/E5
evidence that they can be placed, found and interacted with.
"""
import json
import os
import random
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gea.mystery import make_case, naive_clues, guided_clues, analyse, repair  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "x6_mystery_solvability.json")


def summarise(rows):
    n = len(rows)
    c = Counter()
    depth = Counter()
    red = []
    for r in rows:
        c["unique"] += r["unique"]
        c["ambiguous"] += r["ambiguous"]
        c["misleading"] += r["misleading"]
        c["empty"] += r["empty"]
        if r["unique"]:
            depth[r["min_subset"]] += 1
            red.append(r["redundancy"])
    return {"n": n, "unique_rate": round(c["unique"] / n, 4), "ambiguous_rate": round(c["ambiguous"] / n, 4),
            "misleading_rate": round(c["misleading"] / n, 4), "no_suspect_rate": round(c["empty"] / n, 4),
            "deduction_depth_distribution": dict(sorted(depth.items())),
            "mean_redundancy": round(sum(red) / len(red), 3) if red else None}


def main():
    rng = random.Random(72)
    n = 3000
    naive_rows, guided_rows, sizes = [], [], Counter()
    repair_outcomes = Counter()
    for _ in range(n):
        case = make_case(rng)
        naive_rows.append(analyse(case, naive_clues(case, rng)))
        g = guided_clues(case, rng)
        sizes[len(g)] += 1
        a = analyse(case, g)
        guided_rows.append(a)
        if a["unique"]:
            for i in range(len(g)):
                if g[i]["type"] == "testimony" and not g[i].get("honest", True):
                    continue  # losing a red herring never harms solvability
                _, outcome = repair(case, g, i)
                repair_outcomes[outcome] += 1
    out = {
        "experiment": "X-6 mystery fair-play and repair (offline logic)",
        "cases": n,
        "unchecked_authoring": summarise(naive_rows),
        "solver_guided": summarise(guided_rows),
        "guided_clue_count_distribution": dict(sorted(sizes.items())),
        "single_clue_loss_repair": dict(repair_outcomes),
        "caveat": "Logic only. Placement, discoverability and interaction verification are separate E0/E5 questions.",
    }
    with open(OUT, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
