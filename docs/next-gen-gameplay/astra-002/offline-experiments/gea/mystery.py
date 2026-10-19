"""Mystery construction and fair-play checking for #72 immersive mysteries (X-6).

A mystery is fair when the clues a player can physically discover identify exactly one
culprit, no single clue gives it away, every false testimony is refuted by physical
evidence (otherwise the game misleads the player), and the loss of a clue can be repaired
by adding another verifiable clue. These are *logical* properties a language model is not
guaranteed to satisfy on its own; here a small exact solver checks them.
"""
import itertools
import random

ATTRS = {
    "vehicle": ["sedan", "pickup", "motorbike", "van"],
    "footwear": ["boots", "sneakers", "heels"],
    "weapon": ["knife", "pistol", "bat"],
    "hand": ["left", "right"],
    "coat": ["red", "black", "grey"],
}
SCENE_PLACES = ["paleto_forest", "grapeseed", "sandy_shores", "vinewood_hills", "la_mesa_rail"]


def make_case(rng, k=None):
    k = k or rng.randint(4, 6)
    suspects = []
    while len(suspects) < k:
        s = {a: rng.choice(v) for a, v in ATTRS.items()}
        if s not in suspects:
            suspects.append(s)
    return {"suspects": suspects, "culprit": rng.randrange(k)}


def consistent(case, clues):
    """Suspects compatible with physical evidence, alibis and every *uncontradicted* testimony."""
    phys = {}
    for c in clues:
        if c["type"] == "physical":
            phys[c["attr"]] = c["value"]
    out = []
    for i, s in enumerate(case["suspects"]):
        ok = True
        for c in clues:
            if c["type"] == "physical" and s[c["attr"]] != c["value"]:
                ok = False
            elif c["type"] == "alibi" and c["suspect"] == i:
                ok = False
            elif c["type"] == "testimony":
                if c["attr"] in phys and phys[c["attr"]] != c["value"]:
                    continue  # refuted testimony is discarded (and marks its witness as a liar)
                if s[c["attr"]] != c["value"]:
                    ok = False
        if ok:
            out.append(i)
    return out


def truthful(case, clue):
    cul = case["suspects"][case["culprit"]]
    if clue["type"] in ("physical", "testimony"):
        return cul[clue["attr"]] == clue["value"]
    return clue["suspect"] != case["culprit"]


def analyse(case, clues):
    full = consistent(case, clues)
    unique = full == [case["culprit"]]
    misleading = len(full) == 1 and full[0] != case["culprit"]
    min_subset = None
    if unique:
        for r in range(1, len(clues) + 1):
            if any(consistent(case, list(sub)) == [case["culprit"]] for sub in itertools.combinations(clues, r)):
                min_subset = r
                break
    redundancy = None
    if unique:
        keep = sum(1 for i in range(len(clues)) if consistent(case, clues[:i] + clues[i + 1:]) == [case["culprit"]])
        redundancy = keep / len(clues)
    return {"unique": unique, "misleading": misleading, "ambiguous": len(full) > 1, "empty": not full,
            "candidates": len(full), "min_subset": min_subset, "redundancy": redundancy}


def candidate_pool(case):
    cul = case["suspects"][case["culprit"]]
    pool = [{"type": "physical", "attr": a, "value": cul[a]} for a in ATTRS]
    pool += [{"type": "alibi", "suspect": i} for i in range(len(case["suspects"])) if i != case["culprit"]]
    pool += [{"type": "testimony", "attr": a, "value": cul[a], "honest": True} for a in ATTRS]
    return pool


def naive_clues(case, rng, n=None):
    """Unchecked authoring: plausible clue mix, no solver (proxy for an unconstrained writer)."""
    n = n or rng.randint(3, 5)
    cul = case["suspects"][case["culprit"]]
    clues = []
    for _ in range(n):
        t = rng.choice(["physical", "alibi", "testimony"])
        if t == "physical":
            a = rng.choice(list(ATTRS))
            clues.append({"type": t, "attr": a, "value": cul[a]})
        elif t == "alibi":
            innocent = [i for i in range(len(case["suspects"])) if i != case["culprit"]]
            clues.append({"type": t, "suspect": rng.choice(innocent)})
        else:
            a = rng.choice(list(ATTRS))
            honest = rng.random() < 0.7
            v = cul[a] if honest else rng.choice([x for x in ATTRS[a] if x != cul[a]])
            clues.append({"type": t, "attr": a, "value": v, "honest": honest})
    return clues


def guided_clues(case, rng, min_depth=2, target_redundancy=0.25, max_clues=7):
    """Solver-guided construction: depth >= min_depth, one refuted red herring, some redundancy."""
    pool = candidate_pool(case)
    rng.shuffle(pool)
    clues = []
    # 1) add clues that narrow the set without giving it away in one step
    for c in list(pool):
        if len(clues) >= max_clues:
            break
        trial = clues + [c]
        if len(consistent(case, trial)) < len(consistent(case, clues)) or not clues:
            if any(consistent(case, [c]) == [case["culprit"]] for _ in [0]) and min_depth > 1:
                continue
            clues = trial
            pool.remove(c)
        if consistent(case, clues) == [case["culprit"]]:
            break
    if consistent(case, clues) != [case["culprit"]]:
        for c in pool:
            if consistent(case, clues + [c]) == [case["culprit"]]:
                clues.append(c)
                break
    # 2) one red herring: a false testimony that a physical clue refutes
    cul = case["suspects"][case["culprit"]]
    phys_attrs = [c["attr"] for c in clues if c["type"] == "physical"]
    if phys_attrs:
        a = rng.choice(phys_attrs)
        wrong = [x for x in ATTRS[a] if x != cul[a]]
        clues.append({"type": "testimony", "attr": a, "value": rng.choice(wrong), "honest": False})
    # 3) redundancy: add backups until removal of some clue keeps uniqueness
    an = analyse(case, clues)
    for c in pool:
        if an["unique"] and (an["redundancy"] or 0) >= target_redundancy:
            break
        if c in clues or len(clues) >= max_clues + 2:
            continue
        trial = clues + [c]
        a2 = analyse(case, trial)
        if a2["unique"] and (a2["min_subset"] or 0) >= min_depth:
            clues, an = trial, a2
    return clues


def repair(case, clues, lost_index):
    """Accommodation: a clue became unavailable (witness killed, prop destroyed). Find a
    replacement clue from the pool that restores a unique, non-trivial solution."""
    remaining = clues[:lost_index] + clues[lost_index + 1:]
    if consistent(case, remaining) == [case["culprit"]]:
        return remaining, "still_solvable"
    for c in candidate_pool(case):
        if c in remaining:
            continue
        trial = remaining + [c]
        a = analyse(case, trial)
        if a["unique"] and (a["min_subset"] or 0) >= 2:
            return trial, "repaired"
    return remaining, "unrepairable"
