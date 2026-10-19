"""X-2 (offline part of E1/E2): do the hard critics reject the failure classes that make
generated "missions" fake, unsafe or unplayable - without rejecting valid specs?

Positives: the three reference fixtures plus valid algebra-generated specs.
Negatives: each positive mutated by researcher-authored fault operators modelled on
documented failure modes (Essential's own callout prompt rules, LSA decisions D-001/D-017,
ACT invariants, the user's ASTRA-002 brief). Each operator has an expected critic code.

What this tests: critic coverage of the contract. What it does NOT test: how often a real
LLM produces such faults (that needs E1 with a live provider) or GTA feasibility.
"""
import copy
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gea.catalog import load_catalog  # noqa: E402
from gea.fixtures import all_fixtures  # noqa: E402
from gea.generator import AlgebraGenerator  # noqa: E402
from gea.runner import validate_many  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "x2_validator_fault_classes.json")


def _success(exp):
    st = exp["stages"][0]
    return next(o for o in st["objectives"] if o["kind"] == "success")


def _spawned(exp, kind=None):
    return [r for r in exp["roles"] if r["source"] == "spawn" and (kind is None or r["kind"] == kind)]


def f01_invented_capability(e):
    e["stages"][0]["policies"].append({"role": _spawned(e, "ped")[0]["id"] if _spawned(e, "ped") else "player",
                                       "cap": "hack_bank_mainframe", "args": {}})
    return "H2_CAPABILITY"


def f02_narrative_claim(e):
    _success(e)["formula"] = {"claim": "Nathan says the job is done"}
    return "H5_OBSERVABILITY"


def f03_unobservable_fluent(e):
    _success(e)["formula"] = {"f": "gang_respects_player", "args": []}
    return "H5_OBSERVABILITY"


def f04_claim_only_fluent(e):
    _success(e)["formula"] = {"f": "player_utterance_intent", "args": ["job_complete"]}
    return "H5_OBSERVABILITY"


def f05_control_player(e):
    e["stages"][0]["policies"].append({"role": "player", "cap": "gm_drive_to", "args": {"dest": "grapeseed"}})
    return "H4_AUTHORITY"


def f06_companion_without_consent(e):
    if not any(r["source"] == "companion" for r in e["roles"]):
        e["roles"].append({"id": "nathan", "kind": "ped", "source": "companion", "tags": ["promoted"]})
    e["stages"][0]["policies"].append({"role": "nathan", "cap": "drive_to_place", "args": {"dest": "grapeseed"}})
    return "H4_AUTHORITY"


def f07_scene_cap_on_companion(e):
    if not any(r["source"] == "companion" for r in e["roles"]):
        e["roles"].append({"id": "nathan", "kind": "ped", "source": "companion", "tags": ["promoted"]})
    e["stages"][0]["policies"].append({"role": "nathan", "cap": "gm_combat", "args": {"target": "player"}})
    return "H4_AUTHORITY"


def f08_boat_on_land(e):
    e["roles"].append({"id": "zboat", "kind": "vehicle", "source": "spawn", "tags": ["boat", "affordance"], "place": "downtown"})
    return "H11_PLACE"


def f09_deliver_vehicle_indoors(e):
    e["roles"].append({"id": "zcar", "kind": "vehicle", "source": "spawn", "tags": ["car"], "place": "pillbox_store"})
    _success(e)["formula"] = {"and": [{"f": "in_vehicle", "args": ["player", "zcar"]},
                                      {"f": "near", "args": ["zcar", "store_interior"]}]}
    return "H11_PLACE"


def f10_dangling_reference(e):
    _success(e)["formula"] = {"f": "dead", "args": ["ghost_target"]}
    return "H1_SCHEMA"


def f11_orphan_spawn(e):
    e["roles"].append({"id": "zextra", "kind": "ped", "source": "spawn", "tags": ["armed"], "place": "davis"})
    return "H8_ORPHAN"


def f12_trivial_success(e):
    _success(e)["formula"] = {"f": "alive", "args": ["player"]}
    return "H6_TRIVIAL"


def f13_unsolvable(e):
    _success(e)["formula"] = {"and": [{"f": "near", "args": ["player", "paleto_forest"]},
                                      {"f": "near", "args": ["player", "harbor_water"]}]}
    return "H7_UNSOLVABLE"


def f14_no_stakes(e):
    for st in e["stages"]:
        st["objectives"] = [o for o in st["objectives"] if o["kind"] == "success"]
        st["on_timeout"] = "END_SUCCESS"
    return "H13_NO_STAKES"


def f15_no_timeout(e):
    e["stages"][0].pop("timeout", None)
    return "H10_TERMINATION"


def f16_budget_overflow(e):
    for i in range(12):
        rid = "zh%d" % i
        e["roles"].append({"id": rid, "kind": "ped", "source": "spawn", "tags": ["armed"], "place": "davis"})
        e["stages"][0]["policies"].append({"role": rid, "cap": "gm_combat", "args": {"target": "player"}})
    return "H9_BUDGET"


def f17_forbidden_response(e):
    e["stages"][0].setdefault("rules", []).append({"id": "zr", "on": {"f": "timer_elapsed", "args": [1]},
                                                   "then": [{"do": random.choice(["set_mission_flag", "kill_player", "exec_code", "teleport_player"])}]})
    return "H12_FORBIDDEN"


def f18_money_without_opt_in(e):
    e.setdefault("consequences", []).append({"on": "END_SUCCESS", "effect": "player_money", "amount": 25000})
    return "H12_FORBIDDEN"


def f19_blocked_capability(e):
    peds = _spawned(e, "ped")
    rid = peds[0]["id"] if peds else "player"
    if peds:
        peds[0]["tags"] = list(set(peds[0].get("tags", [])) | {"essential_managed"})
    e["stages"][0]["policies"].append({"role": rid, "cap": "ess_generated_callout", "args": {}})
    return "H3_EVIDENCE_TIER"


OPERATORS = [f01_invented_capability, f02_narrative_claim, f03_unobservable_fluent, f04_claim_only_fluent,
             f05_control_player, f06_companion_without_consent, f07_scene_cap_on_companion, f08_boat_on_land,
             f09_deliver_vehicle_indoors, f10_dangling_reference, f11_orphan_spawn, f12_trivial_success,
             f13_unsolvable, f14_no_stakes, f15_no_timeout, f16_budget_overflow, f17_forbidden_response,
             f18_money_without_opt_in, f19_blocked_capability]


def main():
    t0 = time.time()
    random.seed(5)
    gen = AlgebraGenerator(seed=21)
    candidates = [gen.generate(i) for i in range(80)]
    res = validate_many(candidates, mode="lab", nodes=3000)
    positives = all_fixtures() + [e for e, r in zip(candidates, res) if r["valid"]][:37]
    pos_res = validate_many(positives, mode="lab", nodes=3000)
    false_rejects = [r["id"] for r in pos_res if not r["valid"]]
    negatives, expected, opnames = [], [], []
    for e in positives:
        for op in OPERATORS:
            m = copy.deepcopy(e)
            m["id"] = e["id"] + ":" + op.__name__
            code = op(m)
            negatives.append(m)
            expected.append(code)
            opnames.append(op.__name__)
    neg_res = validate_many(negatives, mode="lab", nodes=1500)
    per_op = defaultdict(lambda: {"n": 0, "rejected": 0, "expected_code_hit": 0, "codes": Counter()})
    accepted_negatives = []
    for name, code, r, m in zip(opnames, expected, neg_res, negatives):
        d = per_op[name]
        d["n"] += 1
        d["rejected"] += int(not r["valid"])
        codes = {c for c, _ in r["errors"]}
        d["expected_code_hit"] += int(code in codes)
        d["codes"].update(codes)
        if r["valid"]:  # a fault that got through: keep it, with whatever soft warnings it raised
            accepted_negatives.append({"id": m["id"], "expected": code,
                                       "warnings": sorted({c for c, _ in r.get("warnings", [])})})
    # tier policy: valid lab specs re-validated in 'play' mode must be rejected for tier
    play_res = validate_many(positives, mode="play", nodes=500)
    play_tier = sum(1 for r in play_res if any(c == "H3_EVIDENCE_TIER" for c, _ in r["errors"]))
    out = {
        "experiment": "X-2 validator fault-class coverage (offline)",
        "positives": len(positives),
        "false_rejections_of_positives": false_rejects,
        "operators": {k: {"n": v["n"], "rejected": v["rejected"], "expected_code_hit": v["expected_code_hit"],
                          "other_codes": dict(v["codes"].most_common())} for k, v in per_op.items()},
        "total_negatives": len(negatives),
        "total_rejected": sum(v["rejected"] for v in per_op.values()),
        "total_expected_code_hits": sum(v["expected_code_hit"] for v in per_op.values()),
        "accepted_negatives": accepted_negatives,
        "play_mode_tier_rejections_of_lab_valid_specs": [play_tier, len(positives)],
        "seconds": round(time.time() - t0, 1),
        "caveat": "Fault operators are researcher-authored; they measure critic coverage, not LLM error rates.",
    }
    with open(OUT, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps({k: v for k, v in out.items() if k != "operators"}, indent=2))
    for k, v in out["operators"].items():
        print("%-32s n=%-3d rejected=%-3d expected=%-3d" % (k, v["n"], v["rejected"], v["expected_code_hit"]))


if __name__ == "__main__":
    main()
