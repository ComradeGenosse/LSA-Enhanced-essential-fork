"""Hard and soft critics for experience specifications (LLM-Modulo style).

Hard critics produce errors (the spec is rejected). Soft critics produce warnings.
A spec that passes every hard critic is *compilable against the abstract model*;
it is not thereby fun, nor GTA-feasible. See 04-gameplay-generation-execution-contract.md.
"""
from . import world as W
from .catalog import TIER_ORDER, tier_ok
from .search import solve

ALLOWED_RESPONSES = {"activate", "deactivate", "spawn", "reassign", "transform", "goto", "conclude",
                     "speak_beat", "note", "blip"}
FORBIDDEN_RESPONSES = {"set_player_money", "kill_player", "teleport_player", "set_mission_flag", "exec_code",
                       "set_stat", "give_player_weapon_permanent", "clear_area_all"}
ALLOWED_CONSEQUENCES = {"ledger_fact", "relationship_note", "reputation", "unlock_followup", "memory_offer"}
OPT_IN_CONSEQUENCES = {"player_money", "player_wanted", "vehicle_ownership"}
DEFAULT_BUDGETS = {"peds": 8, "vehicles": 4, "props": 6, "pickups": 4, "items": 4, "steps": 80}
LANDMARK_PLACES = {"del_perro_pier", "vespucci_beach", "sandy_shores", "grapeseed", "lsia"}


def atoms(formula, out=None):
    out = [] if out is None else out
    if not isinstance(formula, dict):
        out.append(("__bad__", []))
        return out
    if "f" in formula:
        out.append((formula["f"], formula.get("args", [])))
    elif "claim" in formula:
        out.append(("__claim__", [formula["claim"]]))
    else:
        for k in ("and", "or"):
            if k in formula:
                for sub in formula[k]:
                    atoms(sub, out)
        for k in ("not", "ever", "held", "within"):
            if k in formula:
                atoms(formula[k], out)
        if "before" in formula:
            for sub in formula["before"]:
                atoms(sub, out)
    return out


def _all_responses(exp):
    for s in exp.get("stages", []):
        for r in s.get("rules", []):
            for resp in r.get("then", []):
                yield ("rule", s["id"], r.get("id"), resp)
    for i, a in enumerate(exp.get("accommodations", [])):
        for resp in a.get("then", []):
            yield ("acc", None, i, resp)


def validate(exp, cat, mode="lab", run_search=True, search_nodes=6000, want_shapes=6):
    errors, warnings = [], []
    used_tiers = []

    def err(code, detail):
        errors.append([code, detail])

    def warn(code, detail):
        warnings.append([code, detail])

    def need(tier, what):
        used_tiers.append(tier)
        if tier == "X":
            err("H3_EVIDENCE_TIER", "%s is unavailable/blocked (tier X)" % what)
        elif not tier_ok(tier, mode):
            err("H3_EVIDENCE_TIER", "%s requires tier %s, mode '%s' allows <= %s" % (what, tier, mode, {"accepted": "A", "play": "B", "lab": "C", "bridge": "D"}[mode]))

    # ---------------- H1 schema / references
    for k in ("id", "roles", "stages", "start"):
        if k not in exp:
            err("H1_SCHEMA", "missing field " + k)
    if errors:
        return {"valid": False, "errors": errors, "warnings": warnings}
    roles = {}
    for r in exp["roles"]:
        if r.get("id") in roles:
            err("H1_SCHEMA", "duplicate role " + str(r.get("id")))
        roles[r["id"]] = r
    if "player" not in roles:
        err("H1_SCHEMA", "no player role")
    stage_ids = {s["id"] for s in exp["stages"]}
    if exp["start"] not in stage_ids:
        err("H1_SCHEMA", "start stage missing")
    targets = stage_ids | {"END_SUCCESS", "END_FAILURE", "END_ABORT", "END_CONCLUDED"}
    for s in exp["stages"]:
        for k in ("on_success", "on_failure", "on_timeout"):
            if k in s and s[k] not in targets:
                err("H1_SCHEMA", "stage %s %s -> unknown %s" % (s["id"], k, s[k]))
    for r in exp["roles"]:
        if r.get("place") and r["place"] not in W.PLACES:
            err("H1_SCHEMA", "role %s at unknown place %s" % (r["id"], r["place"]))
        for ref in ("in", "driver", "revealed_by"):
            if r.get(ref) and r[ref] not in roles:
                err("H1_SCHEMA", "role %s.%s references unknown role %s" % (r["id"], ref, r[ref]))

    def check_formula(f, where, objective_kind=None):
        for name, args in atoms(f):
            if name == "__claim__":
                err("H5_OBSERVABILITY", "%s: narrative claim used as outcome (%r)" % (where, args[0]))
                continue
            if name == "__bad__":
                err("H1_SCHEMA", "%s: malformed formula" % where)
                continue
            fl = cat["fluents"].get(name)
            if fl is None:
                err("H5_OBSERVABILITY", "%s: no sensor/fluent '%s' in catalog" % (where, name))
                continue
            if name not in W.MODELLED_FLUENTS:
                err("H5_OBSERVABILITY", "%s: fluent '%s' not modelled for feasibility" % (where, name))
            if fl.get("strength") == "claim_only" and objective_kind in ("success", "failure"):
                err("H5_OBSERVABILITY", "%s: '%s' is a claim, not world evidence" % (where, name))
            need(fl["tier"], "fluent " + name)
            for a in args:
                if isinstance(a, str) and a not in roles and a not in W.PLACES:
                    err("H1_SCHEMA", "%s: fluent %s references unknown role/place %s" % (where, name, a))

    # ---------------- H2/H3/H4 policies
    for s in exp["stages"]:
        if not s.get("objectives"):
            err("H1_SCHEMA", "stage %s has no objectives" % s["id"])
        for o in s.get("objectives", []):
            check_formula(o.get("formula", {}), "stage %s objective %s" % (s["id"], o.get("id")), o.get("kind"))
        for p in s.get("policies", []):
            _check_policy(p, roles, cat, err, need, "stage " + s["id"])
        for rule in s.get("rules", []):
            check_formula(rule.get("on", {}), "stage %s rule %s trigger" % (s["id"], rule.get("id")))
    for i, inv in enumerate(exp.get("invariants", [])):
        check_formula(inv.get("formula", {}), "invariant %d" % i)

    # ---------------- responses (H12 forbidden / H2 policies inside rules)
    for where, sid, rid, resp in _all_responses(exp):
        do = resp.get("do")
        if do in FORBIDDEN_RESPONSES:
            err("H12_FORBIDDEN", "%s %s: forbidden response '%s'" % (where, rid, do))
        elif do not in ALLOWED_RESPONSES:
            err("H2_CAPABILITY", "%s %s: unknown response '%s'" % (where, rid, do))
        if do == "activate":
            _check_policy(resp, roles, cat, err, need, "%s %s" % (where, rid))
        if do in ("spawn",) and resp.get("role") not in roles:
            err("H1_SCHEMA", "%s %s spawns unknown role" % (where, rid))
        if do == "reassign" and (resp.get("from") not in roles or resp.get("to") not in roles):
            err("H1_SCHEMA", "%s %s reassign references unknown role" % (where, rid))
        if do == "transform":
            check_formula(resp.get("to", {}), "%s %s transform" % (where, rid), "success")
        if do == "goto" and resp.get("stage") not in targets:
            err("H1_SCHEMA", "%s %s goto unknown stage" % (where, rid))
        if do == "speak_beat":
            need("A" if any(r["source"] == "companion" for r in exp["roles"]) else "C", "speech beat")
        if do == "blip":
            need("C", "blip")

    # ---------------- staging tiers, H11 places, H9 budgets
    counts = {"peds": 0, "vehicles": 0, "props": 0, "pickups": 0, "items": 0}
    for r in exp["roles"]:
        k, src = r["kind"], r["source"]
        if src == "spawn":
            if k == "ped":
                counts["peds"] += 1
                need(cat["staging"]["spawn_scene_ped"]["tier"], "spawn ped " + r["id"])
            elif k == "vehicle":
                counts["vehicles"] += 1
                need(cat["staging"]["spawn_scene_vehicle"]["tier"], "spawn vehicle " + r["id"])
            elif k == "prop":
                counts["props"] += 1
                need(cat["staging"]["spawn_prop"]["tier"], "spawn prop " + r["id"])
            elif k == "pickup":
                counts["pickups"] += 1
                need(cat["staging"]["spawn_pickup"]["tier"], "spawn pickup " + r["id"])
            elif k == "item":
                counts["items"] += 1
                need("B" if "essential_item" in r.get("tags", []) else cat["staging"]["spawn_prop"]["tier"], "spawn item " + r["id"])
            if any(t in r.get("tags", []) for t in ("armed",)):
                need(cat["staging"]["give_weapon"]["tier"], "arm " + r["id"])
        elif src == "companion":
            need(cat["staging"]["spawn_promoted_near_player"]["tier"], "companion " + r["id"])
        elif src == "atlas":
            need("B", "atlas place " + r["id"])
        elif src == "existing":
            need("C", "adopt existing world entity " + r["id"])
        if src == "spawn" and k in ("ped", "prop", "pickup", "item") and r.get("place") and "water" in W.PLACES[r["place"]]["tags"]:
            err("H11_PLACE", "%s %s placed in water" % (k, r["id"]))
        if k == "vehicle" and r.get("place") and not W.place_ok_for_vehicle(W.vehicle_class(r), r["place"]):
            err("H11_PLACE", "vehicle %s (%s) cannot exist at %s" % (r["id"], W.vehicle_class(r), r["place"]))
    budgets = dict(DEFAULT_BUDGETS)
    budgets.update(exp.get("budgets", {}))
    for k, v in counts.items():
        if v > budgets[k]:
            err("H9_BUDGET", "%d %s exceeds budget %d" % (v, k, budgets[k]))
    total_timeout = sum(s.get("timeout", 10 ** 6) for s in exp["stages"])
    if total_timeout > budgets["steps"]:
        warn("S6_LONG", "sum of stage timeouts %d exceeds step budget %d" % (total_timeout, budgets["steps"]))
    # deliver-vehicle-into-interior style contradictions
    for s in exp["stages"]:
        for o in s.get("objectives", []):
            for name, args in atoms(o.get("formula", {})):
                if name == "near" and len(args) >= 2 and args[0] in roles and roles[args[0]]["kind"] == "vehicle":
                    dest = args[1] if args[1] in W.PLACES else roles.get(args[1], {}).get("place")
                    if dest and not W.place_ok_for_vehicle(W.vehicle_class(roles[args[0]]), dest):
                        err("H11_PLACE", "objective %s requires vehicle %s at incompatible %s" % (o["id"], args[0], dest))

    # ---------------- H10 termination, H13 stakes
    for s in exp["stages"]:
        if "timeout" not in s:
            err("H10_TERMINATION", "stage %s has no timeout" % s["id"])
        has_fail = any(o.get("kind") == "failure" for o in s.get("objectives", []))
        timeout_fails = "timeout" in s and s.get("on_timeout", "END_FAILURE") != "END_SUCCESS"
        if not has_fail and not timeout_fails:
            err("H13_NO_STAKES", "stage %s has no failure condition" % s["id"])

    # ---------------- H8 orphans
    referenced = set()
    for s in exp["stages"]:
        for o in s.get("objectives", []):
            referenced.update(a for _, args in atoms(o.get("formula", {})) for a in args if isinstance(a, str))
        for p in s.get("policies", []):
            referenced.add(p["role"])
            referenced.update(v for v in p.get("args", {}).values() if isinstance(v, str))
        for rule in s.get("rules", []):
            referenced.update(a for _, args in atoms(rule.get("on", {})) for a in args if isinstance(a, str))
    for where, sid, rid, resp in _all_responses(exp):
        for k in ("role", "from", "to"):
            v = resp.get(k)
            if isinstance(v, str):
                referenced.add(v)
            elif isinstance(v, dict):
                referenced.update(a for _, args in atoms(v) for a in args if isinstance(a, str))
        for v in resp.get("args", {}).values():
            if isinstance(v, str):
                referenced.add(v)
    for r in exp["roles"]:
        for ref in ("in", "driver", "revealed_by"):
            if r.get(ref):
                referenced.add(r[ref])
                referenced.add(r["id"])
    for r in exp["roles"]:
        # 'affordance' roles are deliberate opportunities for the player (e.g. a getaway car);
        # they need not be referenced by objectives, but they still count toward budgets.
        if r["source"] == "spawn" and r["id"] not in referenced and "affordance" not in r.get("tags", []):
            err("H8_ORPHAN", "spawned role %s is never used" % r["id"])

    # ---------------- consequences (H12)
    for c in exp.get("consequences", []):
        eff = c.get("effect")
        if eff in OPT_IN_CONSEQUENCES and not c.get("player_opt_in"):
            err("H12_FORBIDDEN", "consequence %s changes player state without explicit opt-in" % eff)
        elif eff not in ALLOWED_CONSEQUENCES and eff not in OPT_IN_CONSEQUENCES:
            err("H12_FORBIDDEN", "unknown consequence effect %s" % eff)

    # ---------------- soft critics
    for s in exp["stages"]:
        if len(s.get("objectives", [])) > 3:
            warn("S3_COGNITIVE_LOAD", "stage %s has %d objectives" % (s["id"], len(s["objectives"])))
    critical = set()
    for s in exp["stages"]:
        for o in s.get("objectives", []):
            if o.get("kind") == "success":
                for _, args in atoms(o.get("formula", {})):
                    for a in args:
                        if isinstance(a, str) and a in roles and roles[a]["source"] == "spawn":
                            critical.add(a)
    covered = {a["threat"].get("role_lost") for a in exp.get("accommodations", []) if "role_lost" in a.get("threat", {})}
    for c in sorted(critical - covered):
        warn("S1_BRITTLE", "critical role %s has no accommodation for loss" % c)

    result = {"valid": not errors, "errors": errors, "warnings": warnings,
              "required_tier": max(used_tiers, key=lambda t: TIER_ORDER[t]) if used_tiers else "A",
              "counts": counts}
    if run_search and not errors:
        try:
            s0 = W.initial_state(exp)
            trivially = False
            for oid, kind, f in W.objectives(exp, s0):
                if kind == "success" and W.evaluate(W.clone(s0), f, "probe", update=False):
                    trivially = True
            if trivially:
                result["errors"].append(["H6_TRIVIAL", "success objective already true at start"])
            sres = solve(exp, max_nodes=search_nodes, want_shapes=want_shapes)
            result["search"] = sres
            if not sres["solvable"]:
                result["errors"].append(["H7_UNSOLVABLE", "no abstract solution within search bound (%d nodes)" % sres["nodes"]])
            elif len(sres["solution_shapes"]) <= 1:
                result["warnings"].append(["S4_ONE_WAY", "only one solution shape found"])
            if sres["solvable"] and exp.get("accommodations"):
                plain = solve(exp, max_nodes=search_nodes, want_shapes=1, accommodations=False)
                result["solvable_without_accommodations"] = plain["solvable"]
                if not plain["solvable"]:
                    result["warnings"].append(["S7_ONLY_VIA_ACCOMMODATION",
                                               "the designed path is unsolvable; success relies on an accommodation path"])
        except (KeyError, ValueError) as e:
            result["errors"].append(["H5_OBSERVABILITY", "abstract evaluation failed: %s" % e])
        result["valid"] = not result["errors"]
    return result


def _check_policy(p, roles, cat, err, need, where):
    cap = p.get("cap")
    pol = cat["policies"].get(cap)
    if pol is None:
        err("H2_CAPABILITY", "%s: unknown capability '%s'" % (where, cap))
        return
    need(pol["tier"], "capability " + cap)
    role = roles.get(p.get("role"))
    if role is None:
        err("H1_SCHEMA", "%s: policy for unknown role %s" % (where, p.get("role")))
        return
    if role["kind"] == "player":
        err("H4_AUTHORITY", "%s: the Game Master may not control the player (%s)" % (where, cap))
        return
    actor = pol["actor"]
    if actor == "scene" and role["source"] != "spawn":
        err("H4_AUTHORITY", "%s: scene capability %s on non-scene actor %s" % (where, cap, role["id"]))
    if actor == "promoted" and role["source"] != "companion":
        err("H4_AUTHORITY", "%s: promoted capability %s on non-promoted actor %s" % (where, cap, role["id"]))
    if actor == "promoted" and not p.get("consented", False):
        err("H4_AUTHORITY", "%s: companion activity %s needs player consent (ACT5-style)" % (where, cap))
    if actor in ("essential_managed", "essential_scene") and "essential_managed" not in role.get("tags", []):
        err("H4_AUTHORITY", "%s: Essential capability %s on actor not managed by Essential" % (where, cap))
    for k, v in p.get("args", {}).items():
        if isinstance(v, str) and v not in roles and v not in W.PLACES:
            err("H1_SCHEMA", "%s: %s arg %s=%s unknown" % (where, cap, k, v))
