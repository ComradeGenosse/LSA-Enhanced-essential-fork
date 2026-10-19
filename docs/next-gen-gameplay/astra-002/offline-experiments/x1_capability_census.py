"""X-1 (offline part of E0): how much gameplay can be composed at each evidence tier?

Question: given the capability catalog derived from the LSA audit (tiers A-D/X), how
many *valid and mechanically distinct* experiences can the algebra generator compose if
compilation is restricted to (a) GTA-observed capabilities only, (b) LSA source on main,
(c) native/RPH members a lab stage-executor could call, (d) plus Essential internals?

This does not prove any capability works in GTA; it ranks which missing capabilities
block the most gameplay, i.e. what E0 must measure first.
"""
import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gea.catalog import load_catalog  # noqa: E402
from gea.generator import AlgebraGenerator  # noqa: E402
from gea.novelty import signature  # noqa: E402
from gea.runner import validate_many  # noqa: E402

N = int(os.environ.get("X1_N", "300"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "x1_capability_census.json")


def tier_counts(cat):
    doc = cat["doc"]
    out = {}
    for section in ("fluents", "actorPolicies", "staging", "presentation"):
        c = Counter(x["tier"] for x in doc[section])
        out[section] = dict(sorted(c.items()))
    return out


def main():
    t0 = time.time()
    cat = load_catalog()
    gen = AlgebraGenerator(seed=11)
    exps = [gen.generate(i) for i in range(N)]
    by_mode = {}
    blockers = Counter()
    for mode in ("accepted", "play", "lab", "bridge"):
        res = validate_many(exps, mode=mode, nodes=3000)
        valid = [e for e, r in zip(exps, res) if r["valid"]]
        by_mode[mode] = {"valid": len(valid), "of": N,
                         "unique_mechanical_signatures": len({signature(e) for e in valid}),
                         "error_codes": dict(Counter(c for r in res for c, _ in r["errors"]).most_common())}
        if mode == "play":
            for r in res:
                for c, d in r["errors"]:
                    if c == "H3_EVIDENCE_TIER":
                        what = d.split(" requires")[0].split(" is unavailable")[0]
                        what = " ".join(w for w in what.split() if not w[-1].isdigit() or w.startswith("gm_"))
                        blockers[what] += 1
    # what is composable WITHOUT any scene actors (no stage executor): place/companion only
    gen2 = AlgebraGenerator(seed=12, allow_scene=False)
    exps2 = [gen2.generate(i) for i in range(100)]
    res2 = validate_many(exps2, mode="play", nodes=3000)
    valid2 = [e for e, r in zip(exps2, res2) if r["valid"]]
    out = {
        "experiment": "X-1 capability census (offline)",
        "n_generated": N,
        "catalog_tier_counts": tier_counts(cat),
        "valid_by_mode": by_mode,
        "top_play_mode_blockers": blockers.most_common(15),
        "no_scene_actor_generator": {
            "generated": len(exps2), "valid_in_play_mode": len(valid2),
            "unique_mechanical_signatures": len({signature(e) for e in valid2}),
            "example": valid2[0]["stages"][0]["objectives"] if valid2 else None,
            "errors": dict(Counter(c for r in res2 for c, _ in r["errors"]).most_common()),
        },
        "seconds": round(time.time() - t0, 1),
        "caveat": "Tiers come from a desk audit (source/docs). 'lab' validity means the abstract model finds a solution; it is not GTA feasibility.",
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
