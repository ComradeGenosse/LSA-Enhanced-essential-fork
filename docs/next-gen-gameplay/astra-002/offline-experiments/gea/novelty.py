"""Mechanical-novelty and surface-variety measures computed from the IR itself.

Both generators are measured by the same functions on the same canonical form, so the
measure cannot read a generator's self-description. "Mechanical" here means: what the
player must make true, under what pressure, with what reactive rules and stage links.
Names, places and vehicle models are "surface".
"""
import hashlib
import math
import random
from collections import Counter

MECH_TAGS = {"armed", "informant", "vip", "fragile", "affordance", "animal", "clue"}
LAND = {"car", "van", "sports", "offroad", "bike"}


def role_labels(exp):
    labels = {"player": "PLAYER"}
    for r in exp["roles"]:
        if r["kind"] == "player":
            continue
        t = sorted(x for x in r.get("tags", []) if x in MECH_TAGS)
        if r["kind"] == "vehicle":
            vc = next((x for x in r.get("tags", []) if x in LAND or x in ("boat", "heli")), "car")
            t.append("land" if vc in LAND else vc)
        if r.get("driver"):
            t.append("driven")
        if r.get("in"):
            t.append("carried")
        if r.get("deferred"):
            t.append("revealed" if r.get("revealed_by") else "deferred")
        src = {"companion": "COMP", "atlas": "PLACE"}.get(r["source"], "")
        labels[r["id"]] = "%s%s[%s]" % (src, r["kind"], ",".join(t))
    return labels


def skeleton(f, labels):
    if "f" in f:
        args = []
        for a in f.get("args", []):
            if isinstance(a, int):
                args.append("N")
            elif a in labels:
                args.append(labels[a])
            else:
                args.append("P")
        return "%s(%s)" % (f["f"], ",".join(args))
    for k in ("and", "or"):
        if k in f:
            return "%s{%s}" % (k, ";".join(sorted(skeleton(x, labels) for x in f[k])))
    for k in ("not", "ever"):
        if k in f:
            return "%s(%s)" % (k, skeleton(f[k], labels))
    if "held" in f:
        return "held(%s)" % skeleton(f["held"], labels)
    if "within" in f:
        return "within(%s)" % skeleton(f["within"], labels)
    if "before" in f:
        return "before(%s)" % ",".join(skeleton(x, labels) for x in f["before"])
    return "?"


def stage_order(exp):
    order, seen = [], set()
    sid = exp["start"]
    by = {s["id"]: s for s in exp["stages"]}
    while sid in by and sid not in seen:
        seen.add(sid)
        order.append(by[sid])
        sid = by[sid].get("on_success")
    order.extend(s for s in exp["stages"] if s["id"] not in seen)
    return order


def mechanic_features(exp):
    labels = role_labels(exp)
    feats = set()
    stages = stage_order(exp)
    feats.add("stages:%d" % len(stages))
    succ_roles = []
    for i, s in enumerate(stages):
        roles_here = set()
        for o in s.get("objectives", []):
            sk = skeleton(o["formula"], labels)
            if o["kind"] == "success":
                feats.add("obj:" + sk)
                roles_here.update(a for a in _args(o["formula"]) if a in labels and a != "player")
            else:
                feats.add("fail:" + sk)
        for p in s.get("policies", []):
            if p["cap"] in ("follow_player",):
                continue
            feats.add("pol:%s@%s" % (p["cap"], labels.get(p["role"], "?")))
        for r in s.get("rules", []):
            kinds = sorted("%s:%s" % (x["do"], x.get("cap", "")) for x in r.get("then", []) if x["do"] not in ("speak_beat", "note"))
            feats.add("rule:%s->%s" % (skeleton(r["on"], labels), "+".join(kinds)))
        succ_roles.append(roles_here)
        if s.get("on_failure") not in ("END_FAILURE", None):
            feats.add("branch:fail_forward")
    for i in range(1, len(succ_roles)):
        if succ_roles[i] & succ_roles[i - 1]:
            feats.add("link:continue")
    for r in exp["roles"]:
        if r.get("revealed_by"):
            feats.add("link:reveal")
    for a in exp.get("accommodations", []):
        feats.add("acc:" + ",".join(sorted(x["do"] for x in a.get("then", []))))
    return feats


def _args(f):
    if "f" in f:
        return [a for a in f.get("args", []) if isinstance(a, str)]
    out = []
    for k in ("and", "or"):
        for x in f.get(k, []):
            out.extend(_args(x))
    for k in ("not", "ever", "held", "within"):
        if k in f:
            out.extend(_args(f[k]))
    for x in f.get("before", []):
        out.extend(_args(x))
    return out


def signature(exp):
    labels = role_labels(exp)
    parts = []
    for s in stage_order(exp):
        objs = sorted("%s:%s" % (o["kind"], skeleton(o["formula"], labels)) for o in s.get("objectives", []))
        # set semantics: three identical guards are one pressure type (difficulty), not three mechanics
        pols = sorted({"%s@%s" % (p["cap"], labels.get(p["role"], "?")) for p in s.get("policies", []) if p["cap"] != "follow_player"})
        rules = sorted({"%s->%s" % (skeleton(r["on"], labels), "+".join(sorted(x["do"] for x in r.get("then", [])))) for r in s.get("rules", [])})
        parts.append("|".join(objs) + "#" + "|".join(pols) + "#" + "|".join(rules))
    return hashlib.sha1("//".join(parts).encode()).hexdigest()[:16]


def surface(exp):
    places = sorted(r.get("place") or "-" for r in exp["roles"] if r["kind"] != "player")
    classes = sorted(t for r in exp["roles"] if r["kind"] == "vehicle" for t in r.get("tags", []) if t != "affordance")
    return (exp.get("player_start"), tuple(places), tuple(classes))


ARCHETYPES = [
    ("steal_car_deliver", lambda sk: "in_vehicle(PLAYER" in sk and "near(vehicle" in sk),
    ("acquire_vehicle", lambda sk: sk.startswith("in_vehicle(PLAYER")),
    ("kill_target", lambda sk: sk.startswith("dead(")),
    ("deliver_item", lambda sk: "holding(PLAYER" in sk and "near(PLAYER" in sk),
    ("retrieve_item", lambda sk: "holding(PLAYER" in sk),
    ("intercept", lambda sk: sk.startswith("or{") and "vehicle_driveable" in sk),
    ("escort_rescue", lambda sk: "alive(" in sk),
    ("race", lambda sk: sk.startswith("within(")),
    ("tail", lambda sk: sk.startswith("held(together")),
    ("hold_area", lambda sk: sk.startswith("held(near")),
    ("investigate", lambda sk: sk.startswith("interacted(")),
    ("meet", lambda sk: sk.startswith("conversed(")),
    ("disable_vehicle", lambda sk: sk.startswith("not(vehicle_driveable")),
]


def archetype_sequence(exp):
    labels = role_labels(exp)
    seq = []
    for s in stage_order(exp):
        sk = next((skeleton(o["formula"], labels) for o in s.get("objectives", []) if o["kind"] == "success"), "")
        name = next((n for n, test in ARCHETYPES if test(sk)), "other")
        seq.append(name)
    return tuple(seq)


def jaccard_distance(a, b):
    if not a and not b:
        return 0.0
    return 1.0 - len(a & b) / len(a | b)


def diversity_report(exps, pairs=2000, seed=7):
    rng = random.Random(seed)
    feats = [mechanic_features(e) for e in exps]
    sigs = [signature(e) for e in exps]
    surfs = [surface(e) for e in exps]
    n = len(exps)
    dist = []
    if n >= 2:
        for _ in range(pairs):
            i, j = rng.randrange(n), rng.randrange(n)
            if i != j:
                dist.append(jaccard_distance(feats[i], feats[j]))
    counter = Counter(f for fs in feats for f in fs)
    total = sum(counter.values()) or 1
    entropy = -sum((c / total) * math.log2(c / total) for c in counter.values())
    seqs = Counter(archetype_sequence(e) for e in exps)
    return {
        "n": n,
        "unique_mechanical_signatures": len(set(sigs)),
        "unique_mechanical_ratio": round(len(set(sigs)) / n, 4) if n else 0,
        "unique_surface_ratio": round(len(set(surfs)) / n, 4) if n else 0,
        "mean_pairwise_mechanic_jaccard_distance": round(sum(dist) / len(dist), 4) if dist else 0,
        "distinct_mechanic_features": len(counter),
        "mechanic_feature_entropy_bits": round(entropy, 3),
        "distinct_archetype_sequences": len(seqs),
        "top_archetype_sequences": [[" > ".join(k), v] for k, v in seqs.most_common(12)],
    }
