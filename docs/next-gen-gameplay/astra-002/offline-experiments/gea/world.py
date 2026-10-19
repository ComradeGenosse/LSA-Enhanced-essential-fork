"""Abstract world model ("digital twin lite") for offline feasibility checks.

This is NOT a GTA simulation. Places are abstract graph nodes named after real Los
Santos districts; time advances in abstract steps (~10-20 s of play each). The model
exists to test whether an experience specification is *structurally* playable:
whether success can be reached by some sequence of ordinary player verbs, whether
failure is reachable (stakes), and how adaptation policies behave when the player
breaks the plan. Physics, traffic, navmesh, streaming, AI tactics and fun are out of
scope and must be measured in GTA (see 05-falsifiable-experiment-ladder.md).
"""
from collections import deque
import copy

PLACES = {
    "vinewood_blvd":  {"tags": {"road", "urban"}, "adj": ["downtown", "vinewood_hills", "del_perro"]},
    "downtown":       {"tags": {"road", "urban"}, "adj": ["vinewood_blvd", "mission_row", "pillbox_store", "strawberry", "terminal_docks", "del_perro"]},
    "mission_row":    {"tags": {"road", "urban", "police"}, "adj": ["downtown", "strawberry"]},
    "pillbox_store":  {"tags": {"road", "urban"}, "adj": ["downtown", "store_interior"]},
    "store_interior": {"tags": {"interior", "urban"}, "adj": ["pillbox_store"]},
    "strawberry":     {"tags": {"road", "urban"}, "adj": ["downtown", "mission_row", "davis", "terminal_docks"]},
    "davis":          {"tags": {"road", "urban"}, "adj": ["strawberry", "la_mesa_rail"]},
    "la_mesa_rail":   {"tags": {"road", "offroad", "industrial"}, "adj": ["davis", "terminal_docks", "sandy_hwy"]},
    "terminal_docks": {"tags": {"road", "industrial", "dock"}, "adj": ["downtown", "strawberry", "la_mesa_rail", "harbor_water"]},
    "harbor_water":   {"tags": {"water"}, "adj": ["terminal_docks", "del_perro_pier"]},
    "del_perro":      {"tags": {"road", "urban"}, "adj": ["vinewood_blvd", "downtown", "del_perro_pier", "vespucci_beach"]},
    "del_perro_pier": {"tags": {"road", "urban", "landmark", "dock"}, "adj": ["del_perro", "harbor_water", "vespucci_beach"]},
    "vespucci_beach": {"tags": {"offroad", "landmark"}, "adj": ["del_perro", "del_perro_pier"]},
    "vinewood_hills": {"tags": {"road", "rural"}, "adj": ["vinewood_blvd", "sandy_hwy"]},
    "sandy_hwy":      {"tags": {"road", "rural"}, "adj": ["vinewood_hills", "la_mesa_rail", "sandy_shores", "grapeseed"]},
    "sandy_shores":   {"tags": {"road", "rural", "landmark"}, "adj": ["sandy_hwy", "alamo_sea", "grapeseed"]},
    "alamo_sea":      {"tags": {"water"}, "adj": ["sandy_shores"]},
    "grapeseed":      {"tags": {"road", "rural", "offroad"}, "adj": ["sandy_hwy", "sandy_shores", "paleto_forest"]},
    "paleto_forest":  {"tags": {"offroad", "rural"}, "adj": ["grapeseed"]},
}

VEHICLE_ALLOWED = {
    "car": {"road"}, "van": {"road"}, "sports": {"road"}, "bike": {"road", "offroad"},
    "offroad": {"road", "offroad"}, "boat": {"water"}, "heli": {"road", "offroad", "water"},
}
PLAYER_START_HP = 6


def _dist_table():
    d = {}
    for a in PLACES:
        dist = {a: 0}
        q = deque([a])
        while q:
            x = q.popleft()
            for y in PLACES[x]["adj"]:
                if y not in dist:
                    dist[y] = dist[x] + 1
                    q.append(y)
        d[a] = dist
    return d


DIST = _dist_table()


def vehicle_class(role):
    for t in role.get("tags", []):
        if t in VEHICLE_ALLOWED:
            return t
    return "car"


def place_ok_for_vehicle(vclass, place):
    return bool(PLACES[place]["tags"] & VEHICLE_ALLOWED.get(vclass, {"road"}))


def place_ok_on_foot(place):
    return "water" not in PLACES[place]["tags"]


# ---------------------------------------------------------------- state

def initial_state(exp):
    roles = {}
    player_place = exp.get("player_start", "downtown")
    for r in exp["roles"]:
        rid = r["id"]
        if r["kind"] == "player":
            continue
        st = {"kind": r["kind"], "place": r.get("place"), "alive": True, "in": r.get("in"),
              "held_by": None, "flags": set(), "tags": set(r.get("tags", [])),
              "spawned": not r.get("deferred", False), "companion": r["source"] == "companion",
              "revealed_by": r.get("revealed_by")}
        if r["source"] == "companion":
            st["place"] = player_place
        if r["kind"] == "place":
            st["place"] = r.get("place")
        roles[rid] = st
    # resolve containment
    for r in exp["roles"]:
        if r["kind"] == "item" and r.get("in"):
            holder = roles.get(r["in"])
            if holder is not None and holder["kind"] in ("ped",):
                roles[r["id"]]["held_by"] = r["in"]
                roles[r["id"]]["in"] = None
        if r["kind"] == "vehicle" and r.get("driver"):
            roles[r["driver"]]["in"] = r["id"]
            roles[r["driver"]]["place"] = roles[r["id"]]["place"]
    state = {
        "t": 0,
        "player": {"place": player_place, "vehicle": None, "hp": PLAYER_START_HP, "wanted": 0,
                   "streak": 0, "holding": set(), "flags": set()},
        "roles": roles,
        "policies": [],
        "fired": set(),
        "mon": {},
        "stage": exp["start"],
        "clock": 0,
        "outcome": None,
        "objective_overrides": {},
        "aliases": {},
        "events": [],
    }
    enter_stage(exp, state, exp["start"])
    return state


def clone(state):
    s = copy.copy(state)
    s["player"] = dict(state["player"])
    s["player"]["holding"] = set(state["player"]["holding"])
    s["player"]["flags"] = set(state["player"]["flags"])
    s["roles"] = {k: dict(v) for k, v in state["roles"].items()}
    for v in s["roles"].values():
        v["flags"] = set(v["flags"])
    s["policies"] = list(state["policies"])
    s["fired"] = set(state["fired"])
    s["mon"] = dict(state["mon"])
    s["objective_overrides"] = dict(state["objective_overrides"])
    s["aliases"] = dict(state["aliases"])
    s["events"] = []
    return s


def key(state):
    roles = tuple(sorted(
        (k, v["place"], v["alive"], v["in"], v["held_by"], tuple(sorted(v["flags"])), v["spawned"])
        for k, v in state["roles"].items()))
    p = state["player"]
    return (p["place"], p["vehicle"], p["hp"], p["wanted"], p["streak"], tuple(sorted(p["holding"])),
            tuple(sorted(p["flags"])), roles, tuple(state["policies"]), tuple(sorted(state["fired"])),
            tuple(sorted(state["mon"].items())), state["stage"], state["clock"], state["outcome"],
            tuple(sorted((k, str(v)) for k, v in state["objective_overrides"].items())),
            tuple(sorted(state["aliases"].items())))


def stage_of(exp, sid):
    for s in exp["stages"]:
        if s["id"] == sid:
            return s
    return None


def resolve(state, rid):
    seen = 0
    while rid in state["aliases"] and seen < 8:
        rid = state["aliases"][rid]
        seen += 1
    return rid


def role_place(state, rid):
    rid = resolve(state, rid)
    if rid == "player":
        return state["player"]["place"]
    r = state["roles"].get(rid)
    if r is None or not r["spawned"]:
        return None
    if r["kind"] == "item":
        if r["held_by"] == "player":
            return state["player"]["place"]
        if r["held_by"]:
            return role_place(state, r["held_by"])
        if r["in"]:
            return role_place(state, r["in"])
        return r["place"]
    if r["kind"] == "ped" and r["in"]:
        return role_place(state, r["in"])
    return r["place"]


def role_lost(state, rid):
    rid = resolve(state, rid)
    r = state["roles"].get(rid)
    if r is None:
        return True
    if not r["spawned"]:
        return False
    if r["kind"] in ("ped", "vehicle") and not r["alive"]:
        return True
    if "escaped" in r["flags"] or "destroyed_item" in r["flags"]:
        return True
    return False


def kill_role(state, rid):
    """A ped dies where it is; whatever it carried drops at *its* place.

    (Run-1 bug, fixed 2026-10-19: carried items were dropped at the *player's* place,
    which teleported loot to a player who shot the carrier from an adjacent place.)
    """
    R = state["roles"]
    x = R[rid]
    if x["in"]:
        x["place"] = role_place(state, x["in"])
        x["in"] = None
    x["alive"] = False
    for it in R.values():
        if it["kind"] == "item" and it["held_by"] == rid:
            it["held_by"] = None
            it["place"] = x["place"]


def destroy_vehicle(state, rid):
    """A vehicle is destroyed with its occupants; fragile items inside it, or held by an
    occupant, are destroyed too; other items drop at the wreck.

    (Run-1 bug, fixed 2026-10-19: occupants were processed before the items they held,
    so a fragile item held by the driver survived the destruction of its vehicle.)
    """
    R = state["roles"]
    v = R[rid]
    wreck = role_place(state, rid)
    v["alive"] = False
    occupants = {k for k, x in R.items() if x["kind"] == "ped" and x["in"] == rid}
    for x in R.values():
        if x["kind"] == "item" and (x["in"] == rid or x["held_by"] in occupants):
            if "fragile" in x["tags"]:
                x["flags"].add("destroyed_item")
            x["held_by"] = None
            x["in"] = None
            x["place"] = wreck
    for k in occupants:
        x = R[k]
        x["alive"] = False
        x["place"] = wreck
        x["in"] = None


def enter_stage(exp, state, sid):
    state["stage"] = sid
    state["clock"] = 0
    if sid.startswith("END"):
        state["outcome"] = sid
        state["policies"] = []
        return
    st = stage_of(exp, sid)
    state["policies"] = [(p["role"], p["cap"], tuple(sorted((k, str(v)) for k, v in p.get("args", {}).items())))
                         for p in st.get("policies", [])]
    # Monitor memory is per stage: latches/counters never carry over.
    state["mon"] = {k: v for k, v in state["mon"].items() if not k.startswith("stage:")}


# ---------------------------------------------------------------- fluents

def fluent(state, name, args):
    p = state["player"]
    R = state["roles"]

    def r(x):
        return R.get(resolve(state, x))

    if name == "exists":
        x = resolve(state, args[0])
        if x == "player":
            return True
        rr = R.get(x)
        return bool(rr and rr["spawned"] and not role_lost(state, x))
    if name in ("near", "together"):
        a, b = args[0], args[1]
        pa = role_place(state, a)
        pb = b if b in PLACES else role_place(state, b)
        return pa is not None and pa == pb
    if name == "far":
        a, b, n = args[0], args[1], int(args[2])
        pa = role_place(state, a)
        pb = b if b in PLACES else role_place(state, b)
        if pa is None or pb is None:
            return False
        return DIST[pa][pb] >= n
    if name == "alive":
        x = resolve(state, args[0])
        if x == "player":
            return p["hp"] > 0
        rr = R.get(x)
        return bool(rr and rr["spawned"] and rr["alive"])
    if name == "dead":
        rr = r(args[0])
        return bool(rr and rr["spawned"] and not rr["alive"])
    if name == "in_vehicle":
        who, v = resolve(state, args[0]), resolve(state, args[1])
        if who == "player":
            return p["vehicle"] == v
        rr = R.get(who)
        return bool(rr and rr["in"] == v and rr["alive"])
    if name == "in_any_vehicle":
        who = resolve(state, args[0])
        if who == "player":
            return p["vehicle"] is not None
        rr = R.get(who)
        return bool(rr and rr["in"])
    if name == "holding":
        who, item = resolve(state, args[0]), resolve(state, args[1])
        it = R.get(item)
        return bool(it and it["held_by"] == who and "destroyed_item" not in it["flags"])
    if name == "pickup_collected":
        rr = r(args[0])
        return bool(rr and "collected" in rr["flags"])
    if name == "interacted":
        rr = r(args[0])
        return bool(rr and "interacted" in rr["flags"])
    if name == "conversed":
        rr = r(args[0])
        return bool(rr and "conversed" in rr["flags"])
    if name == "vehicle_driveable":
        rr = r(args[0])
        return bool(rr and rr["alive"] and "disabled" not in rr["flags"])
    if name == "wanted_ge":
        return p["wanted"] >= int(args[0])
    if name == "player_wasted":
        return p["hp"] <= 0
    if name == "player_busted":
        return "busted" in p["flags"]
    if name == "fleeing":
        rr = r(args[0])
        return bool(rr and "fleeing" in rr["flags"])
    if name == "on_screen":
        # abstract: an entity is 'on screen' iff co-located with the player
        return role_place(state, args[0]) == p["place"]
    if name == "timer_elapsed":
        return state["clock"] >= int(args[0])
    if name == "scripted_state":
        return False
    raise KeyError("fluent not modelled in abstract world: " + name)


MODELLED_FLUENTS = {"exists", "near", "together", "far", "alive", "dead", "in_vehicle", "in_any_vehicle", "holding",
                    "pickup_collected", "interacted", "conversed", "vehicle_driveable", "wanted_ge",
                    "player_wasted", "player_busted", "fleeing", "on_screen", "timer_elapsed", "scripted_state"}


def evaluate(state, formula, path, update=True):
    """Evaluate a temporal formula with per-node monitor memory (latches/counters)."""
    if "f" in formula:
        return fluent(state, formula["f"], formula.get("args", []))
    if "and" in formula:
        res = [evaluate(state, sub, path + ".a%d" % i, update) for i, sub in enumerate(formula["and"])]
        return all(res)
    if "or" in formula:
        res = [evaluate(state, sub, path + ".o%d" % i, update) for i, sub in enumerate(formula["or"])]
        return any(res)
    if "not" in formula:
        return not evaluate(state, formula["not"], path + ".n", update)
    if "ever" in formula:
        k = "stage:" + path
        v = evaluate(state, formula["ever"], path + ".e", update) or state["mon"].get(k, 0) == 1
        if update and v:
            state["mon"][k] = 1
        return v
    if "held" in formula:
        k = "stage:" + path
        inner = evaluate(state, formula["held"], path + ".h", update)
        c = state["mon"].get(k, 0) + 1 if inner else 0
        if update:
            state["mon"][k] = c
        return c >= int(formula["n"])
    if "within" in formula:
        k = "stage:" + path
        inner = evaluate(state, formula["within"], path + ".w", update)
        if state["mon"].get(k) == 1:
            return True
        ok = inner and state["clock"] <= int(formula["n"])
        if update and ok:
            state["mon"][k] = 1
        return ok
    if "before" in formula:
        k = "stage:" + path
        a = evaluate(state, formula["before"][0], path + ".b0", update)
        b = evaluate(state, formula["before"][1], path + ".b1", update)
        prev = state["mon"].get(k, 0)  # 0 undecided, 1 a-first, 2 b-first
        if prev == 0:
            if a and not b:
                prev = 1
            elif b:
                prev = 2
            if update:
                state["mon"][k] = prev
        return prev == 1
    if "claim" in formula:
        raise ValueError("narrative claim is not evaluable")
    raise ValueError("bad formula: %r" % (formula,))


# ---------------------------------------------------------------- player verbs

def player_actions(exp, state):
    """Enumerate abstract player macro-actions applicable in this state."""
    acts = []
    p = state["player"]
    here = p["place"]
    veh = p["vehicle"]
    vclass = vehicle_class(next((r for r in exp["roles"] if r["id"] == veh), {})) if veh else None
    for nxt in PLACES[here]["adj"]:
        if veh:
            if place_ok_for_vehicle(vclass, nxt):
                acts.append(("move", nxt))
        elif place_ok_on_foot(nxt):
            acts.append(("move", nxt))
    for rid, r in state["roles"].items():
        if not r["spawned"]:
            continue
        rp = role_place(state, rid)
        if rp != here:
            continue
        k = r["kind"]
        if k == "vehicle" and r["alive"] and veh != rid:
            if veh is None:
                acts.append(("enter", rid))
            acts.append(("destroy", rid))
            if veh is not None and "disabled" not in r["flags"]:
                acts.append(("ram", rid))
        if k == "ped" and r["alive"] and not r.get("companion"):
            acts.append(("kill", rid))
            if "animal" not in r["tags"]:
                if "hands_up" not in r["flags"]:
                    acts.append(("threaten", rid))
                acts.append(("talk", rid))
        if k == "item" and r["held_by"] != "player" and "destroyed_item" not in r["flags"]:
            holder = r["held_by"]
            hr = state["roles"].get(holder) if holder else None
            if holder is None and r["in"] is None:
                acts.append(("pickup", rid))
            elif hr is not None and (not hr["alive"] or "hands_up" in hr["flags"]):
                acts.append(("take", rid))
            elif r["in"] is not None:
                vr = state["roles"].get(r["in"])
                if vr is not None and (not vr["alive"] or "disabled" in vr["flags"] or
                                       not any(x["in"] == r["in"] and x["alive"] for x in state["roles"].values() if x["kind"] == "ped")):
                    acts.append(("take", rid))
        if k == "pickup" and "collected" not in r["flags"]:
            acts.append(("pickup", rid))
        if k == "prop" and "interacted" not in r["flags"]:
            acts.append(("interact", rid))
    if veh is None:
        # ranged fire at an armed hostile in an adjacent place (GTA players rarely need melee range)
        for rid, r in state["roles"].items():
            if r["kind"] == "ped" and r["spawned"] and r["alive"] and not r.get("companion") and "armed" in r["tags"]:
                rp = role_place(state, rid)
                if rp in PLACES[here]["adj"]:
                    acts.append(("snipe", rid))
    if veh:
        acts.append(("exit", None))
        if p["wanted"] > 0:
            acts.append(("evade", None))
    acts.append(("wait", None))
    return acts


def _wanted(state, n):
    if "urban" in PLACES[state["player"]["place"]]["tags"] or "police" in PLACES[state["player"]["place"]]["tags"]:
        state["player"]["wanted"] = min(5, state["player"]["wanted"] + n)


def apply_player(exp, state, act):
    verb, arg = act
    p = state["player"]
    R = state["roles"]
    if verb == "move":
        p["place"] = arg
        if p["vehicle"]:
            R[p["vehicle"]]["place"] = arg
    elif verb == "enter":
        v = R[arg]
        drivers = [k for k, x in R.items() if x["kind"] == "ped" and x["in"] == arg and x["alive"]]
        for d in drivers:  # carjack: driver ejected and flees
            R[d]["in"] = None
            R[d]["place"] = p["place"]
            R[d]["flags"].add("fleeing")
            _wanted(state, 1)
        p["vehicle"] = arg
        v["flags"].discard("parked")
        state["events"].append(("entered", arg))
    elif verb == "exit":
        p["vehicle"] = None
    elif verb in ("kill", "snipe"):
        kill_role(state, arg)
        _wanted(state, 1)
        state["events"].append(("killed", arg))
    elif verb == "threaten":
        R[arg]["flags"].add("hands_up")
        _wanted(state, 1)
    elif verb == "talk":
        R[arg]["flags"].add("conversed")
        for rid, x in R.items():  # informants reveal deferred roles they know about
            if x.get("revealed_by") == arg:
                x["spawned"] = True
    elif verb == "ram":
        v = R[arg]
        v["flags"].add("disabled")
        for k, x in R.items():
            if x["kind"] == "ped" and x["in"] == arg and x["alive"]:
                x["in"] = None
                x["place"] = p["place"]
                x["flags"].add("hands_up")
        _wanted(state, 1)
    elif verb == "destroy":
        destroy_vehicle(state, arg)
        _wanted(state, 1)
        state["events"].append(("destroyed", arg))
    elif verb in ("pickup", "take"):
        x = R[arg]
        if x["kind"] == "item":
            x["held_by"] = "player"
            x["in"] = None
            p["holding"].add(arg)
        else:
            x["flags"].add("collected")
        state["events"].append(("got", arg))
    elif verb == "interact":
        R[arg]["flags"].add("interacted")
        for rid, x in R.items():
            if x.get("revealed_by") == arg:
                x["spawned"] = True
    elif verb == "evade":
        p["wanted"] = max(0, p["wanted"] - 1)
    elif verb == "wait":
        pass
    else:
        raise ValueError(verb)


# ---------------------------------------------------------------- actor policies

def _step_toward(cur, dest, ok):
    best = cur
    for n in PLACES[cur]["adj"]:
        if ok(n) and DIST[n][dest] < DIST[best][dest]:
            best = n
    return best


def _step_away(cur, threat, ok):
    best, bd = cur, DIST[cur][threat]
    for n in sorted(PLACES[cur]["adj"]):
        if ok(n) and DIST[n][threat] > bd:
            best, bd = n, DIST[n][threat]
    return best


def apply_policies(exp, state):
    R = state["roles"]
    p = state["player"]
    t = state["t"]
    roles_by_id = {r["id"]: r for r in exp["roles"]}
    for (rid, cap, args_t) in state["policies"]:
        args = dict(args_t)
        rid = resolve(state, rid)
        x = R.get(rid)
        if x is None or not x["spawned"] or not x["alive"] or "hands_up" in x["flags"]:
            continue
        if cap in ("gm_vehicle_flee", "gm_drive_to", "gm_vehicle_chase", "gm_escort"):
            v = x["in"]
            if v is None:
                continue
            vr = R[v]
            if not vr["alive"] or "disabled" in vr["flags"]:
                continue
            vclass = vehicle_class(roles_by_id.get(v, {}))
            ok = lambda n, vc=vclass: place_ok_for_vehicle(vc, n)
            if t % 2 == 1 and cap != "gm_vehicle_chase":
                continue
            if cap == "gm_drive_to":
                dest = args.get("dest")
                if vr["place"] != dest:
                    vr["place"] = _step_toward(vr["place"], dest, ok)
                if vr["place"] == dest:
                    x["flags"].add("arrived")
            elif cap == "gm_vehicle_flee":
                vr["place"] = _step_away(vr["place"], p["place"], ok)
                x["flags"].add("fleeing")
                if DIST[vr["place"]][p["place"]] >= 4:
                    x["flags"].add("escaped")
            elif cap == "gm_vehicle_chase":
                if vr["place"] != p["place"]:
                    vr["place"] = _step_toward(vr["place"], p["place"], ok)
        elif cap in ("gm_flee", "ess_flee"):
            if t % 3 != 0 or x["in"]:
                continue
            x["place"] = _step_away(x["place"], p["place"], place_ok_on_foot)
            x["flags"].add("fleeing")
            if DIST[x["place"]][p["place"]] >= 4:
                x["flags"].add("escaped")
        elif cap in ("gm_walk_to", "walk_to_place"):
            if t % 3 != 0 or x["in"]:
                continue
            dest = args.get("dest")
            if x["place"] != dest:
                x["place"] = _step_toward(x["place"], dest, place_ok_on_foot)
            if x["place"] == dest:
                x["flags"].add("arrived")
        elif cap in ("follow_player", "gm_follow_player"):
            if x["in"] is None or x["in"] != p["vehicle"]:
                x["place"] = p["place"]
                x["in"] = p["vehicle"]
        elif cap in ("gm_combat", "gm_combat_area", "gm_guard_area", "ess_attack_with_weapon"):
            x["flags"].add("hostile")
            if cap == "gm_combat" and x["in"] is None and role_place(state, rid) != p["place"] and t % 2 == 0:
                x["place"] = _step_toward(x["place"], p["place"], place_ok_on_foot)
        elif cap in ("gm_hands_up",):
            x["flags"].add("hands_up")
    # damage from co-located hostile armed actors (vehicles shield the player except from chasers)
    for rid, x in R.items():
        if x["kind"] != "ped" or not x["spawned"] or not x["alive"] or "armed" not in x["tags"]:
            continue
        if "hands_up" in x["flags"] or role_place(state, rid) != p["place"]:
            continue
        chase = any(pol[0] == rid and pol[1] == "gm_vehicle_chase" for pol in state["policies"])
        if not ("hostile" in x["flags"] or chase):
            continue
        if p["vehicle"] and not chase:
            continue
        p["hp"] -= 1
    # police pressure
    if p["wanted"] >= 3 and p["vehicle"] is None:
        p["streak"] += 1
        if p["streak"] >= 2:
            p["flags"].add("busted")
    elif p["wanted"] >= 2 and "police" in PLACES[p["place"]]["tags"]:
        p["flags"].add("busted")
    else:
        p["streak"] = 0


# ---------------------------------------------------------------- rules & stage logic

def apply_responses(exp, state, responses):
    for resp in responses:
        do = resp["do"]
        if do == "activate":
            state["policies"].append((resp["role"], resp["cap"], tuple(sorted((k, str(v)) for k, v in resp.get("args", {}).items()))))
        elif do == "deactivate":
            state["policies"] = [p for p in state["policies"] if p[0] != resp["role"]]
        elif do == "spawn":
            rr = state["roles"].get(resp["role"])
            if rr is not None:
                rr["spawned"] = True
        elif do == "reassign":
            state["aliases"][resp["from"]] = resp["to"]
        elif do == "transform":
            state["objective_overrides"][resp["objective"]] = resp["to"]
        elif do == "goto":
            enter_stage(exp, state, resp["stage"])
            return
        elif do == "conclude":
            enter_stage(exp, state, resp["outcome"])
            return
        elif do in ("speak_beat", "note", "blip"):
            state["events"].append((do, resp.get("beat") or resp.get("text")))
        else:
            raise ValueError("forbidden or unknown response: " + do)


def objectives(exp, state):
    st = stage_of(exp, state["stage"])
    out = []
    for o in st.get("objectives", []):
        f = state["objective_overrides"].get(o["id"], o["formula"])
        out.append((o["id"], o["kind"], f))
    return out


def end_of_step(exp, state, accommodations=True):
    """Advance clock, run rules, accommodations and objective monitors."""
    if state["outcome"]:
        return
    st = stage_of(exp, state["stage"])
    state["clock"] += 1
    # rules (latching)
    for rule in st.get("rules", []):
        rk = st["id"] + ":" + rule["id"]
        if rk in state["fired"] and not rule.get("repeat"):
            continue
        try:
            trig = evaluate(state, rule["on"], "rule:" + rk)
        except KeyError:
            trig = False
        if trig:
            state["fired"].add(rk)
            apply_responses(exp, state, rule["then"])
            if state["outcome"] or state["stage"] != st["id"]:
                return
    # accommodations (experience-wide)
    if accommodations:
        for i, acc in enumerate(exp.get("accommodations", [])):
            ak = "acc:%d" % i
            if ak in state["fired"]:
                continue
            th = acc["threat"]
            hit = False
            if "role_lost" in th:
                hit = role_lost(state, th["role_lost"])
            elif "formula" in th:
                hit = evaluate(state, th["formula"], "acc%d" % i)
            if hit:
                state["fired"].add(ak)
                apply_responses(exp, state, acc["then"])
                if state["outcome"] or state["stage"] != st["id"]:
                    return
    # objectives
    succ = fail = False
    for oid, kind, f in objectives(exp, state):
        v = evaluate(state, f, "stage:" + st["id"] + ":" + oid)
        if v and kind == "success":
            succ = True
        if v and kind == "failure":
            fail = True
    if fail:
        enter_stage(exp, state, st.get("on_failure", "END_FAILURE"))
    elif succ:
        enter_stage(exp, state, st.get("on_success", "END_SUCCESS"))
    elif state["clock"] >= st.get("timeout", 10 ** 6):
        enter_stage(exp, state, st.get("on_timeout", "END_FAILURE"))


def step(exp, state, act, accommodations=True):
    s = clone(state)
    apply_player(exp, s, act)
    apply_policies(exp, s)
    s["t"] += 1
    end_of_step(exp, s, accommodations)
    return s
