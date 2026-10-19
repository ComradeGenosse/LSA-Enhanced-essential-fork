"""Bounded search over abstract player macro-actions (solvability / stakes / solution diversity)."""
from collections import deque
from . import world as W


def _formula_places(f, out):
    if not isinstance(f, dict):
        return
    if "f" in f:
        out.update(a for a in f.get("args", []) if isinstance(a, str) and a in W.PLACES)
        return
    for k in ("and", "or"):
        for x in f.get(k, []):
            _formula_places(x, out)
    for k in ("not", "ever", "held", "within"):
        if k in f:
            _formula_places(f[k], out)
    for x in f.get("before", []):
        _formula_places(x, out)


def relevant_places(exp, state):
    """Places worth travelling to: role locations, literal places in objectives/rules,
    policy destinations, and firing positions next to armed actors."""
    places = set()
    for r in exp["roles"]:
        if r.get("place"):
            places.add(r["place"])
    for st in exp["stages"]:
        for o in st.get("objectives", []):
            _formula_places(o.get("formula", {}), places)
        for rule in st.get("rules", []):
            _formula_places(rule.get("on", {}), places)
    for f in state["objective_overrides"].values():
        _formula_places(f, places)
    for rid, r in state["roles"].items():
        if r["kind"] == "ped" and r["spawned"] and r["alive"] and "armed" in r["tags"]:
            rp = W.role_place(state, rid)
            if rp:
                places.update(n for n in W.PLACES[rp]["adj"] if W.place_ok_on_foot(n))
    for s in exp["stages"]:
        for p in s.get("policies", []):
            d = p.get("args", {}).get("dest")
            if d in W.PLACES:
                places.add(d)
    for rid in state["roles"]:
        rp = W.role_place(state, rid)
        if rp:
            places.add(rp)
    places.add(state["player"]["place"])
    return places


def macro_actions(exp, state):
    acts = []
    here = state["player"]["place"]
    for dest in sorted(relevant_places(exp, state)):
        if dest != here:
            acts.append(("goto", dest))
    for a in W.player_actions(exp, state):
        if a[0] != "move":
            acts.append(a)
    return acts


def apply_macro(exp, state, act, accommodations=True):
    """Returns the resulting state (possibly mid-route if the stage changed)."""
    if act[0] != "goto":
        return W.step(exp, state, act, accommodations)
    s = state
    dest = act[1]
    guard = 0
    while s["player"]["place"] != dest and not s["outcome"] and guard < 12:
        guard += 1
        veh = s["player"]["vehicle"]
        vclass = W.vehicle_class(next((r for r in exp["roles"] if r["id"] == veh), {})) if veh else None
        ok = (lambda n: W.place_ok_for_vehicle(vclass, n)) if veh else W.place_ok_on_foot
        cur = s["player"]["place"]
        nxt = None
        best = W.DIST[cur][dest]
        for n in sorted(W.PLACES[cur]["adj"]):
            if ok(n) and W.DIST[n][dest] < best:
                nxt, best = n, W.DIST[n][dest]
        if nxt is None:
            return None  # unreachable with current mode of travel
        stage_before = s["stage"]
        s = W.step(exp, s, ("move", nxt), accommodations)
        if s["stage"] != stage_before:
            break
    return s


def solve(exp, max_nodes=60000, max_steps=None, want_shapes=24, accommodations=True):
    """Breadth-first search over macro-actions. Returns a dict summary."""
    s0 = W.initial_state(exp)
    max_steps = max_steps or exp.get("budgets", {}).get("steps", 80)
    q = deque([(s0, ())])
    seen = {W.key(s0)}
    nodes = 0
    first_success = None
    shapes = set()
    outcomes = {}
    failure_reachable = False
    while q and nodes < max_nodes:
        if first_success is not None and failure_reachable and len(shapes) >= want_shapes:
            break
        s, path = q.popleft()
        nodes += 1
        for a in macro_actions(exp, s):
            n = apply_macro(exp, s, a, accommodations)
            if n is None or n["t"] > max_steps:
                continue
            k = W.key(n)
            if k in seen:
                continue
            seen.add(k)
            np = path + (a,)
            if n["outcome"]:
                outcomes[n["outcome"]] = outcomes.get(n["outcome"], 0) + 1
                if n["outcome"] == "END_SUCCESS":
                    if first_success is None:
                        first_success = np
                    if len(shapes) < want_shapes:
                        shapes.add(tuple(x[0] for x in np))
                elif n["outcome"] in ("END_FAILURE",):
                    failure_reachable = True
                continue
            q.append((n, np))
    return {
        "solvable": first_success is not None,
        "shortest": [list(x) for x in first_success] if first_success else None,
        "solution_shapes": sorted(" ".join(s) for s in shapes),
        "failure_reachable": failure_reachable,
        "outcomes": outcomes,
        "nodes": nodes,
        "exhausted": not q,
    }
