"""Episode simulator for X-4: how should a Game Master respond when the player (or the
world) breaks the plan?

Strategies compared (see 04 / 05 for the contract they correspond to):
  S0 static        - no accommodation, no replanning (a fixed mission script)
  S1 llm_replan    - every significant event triggers a model re-plan; plans applied unchecked
  S2 llm_modulo    - same triggers, but hard critics + a continuity critic gate each re-plan
  S3 contingency   - precompiled accommodations (validated at design time) fire instantly
  S4 hybrid        - S3, plus at most 2 asynchronous validated re-designs when a threat
                     is not covered by the precompiled library

All model behaviour (latency, bad-plan rate, critic detection) is PARAMETERISED, not
measured. The value of the experiment is the structural comparison and the sensitivity
sweep; real rates must come from E1/E3 with a live provider.

Outcomes: END_SUCCESS (original or design-time-validated stakes), END_SUCCESS_MOVED
(reached only after the goalposts moved: an unchecked bad re-plan or S4's generic
fail-forward), END_CONCLUDED (graceful designed ending), END_FAILURE, dead_experience
(failure after >= 5 blocked steps), aborted_by_reload, timeout_in_progress.

Structural limits worth stating up front: in S1/S2 a *good* re-plan can only apply the
same repairs that S3 has precompiled, so S1/S2 cannot beat S3 by construction; what the
experiment measures is the *exposure* each policy creates (churn, incoherent objectives
shown, waiting time, model calls) and how much uncovered threats cost.
"""
import copy
import random

from . import world as W
from .search import macro_actions, apply_macro, solve


def success_formula(exp, state):
    if state["outcome"]:
        return None
    for oid, kind, f in W.objectives(exp, state):
        if kind == "success":
            return (oid, f)
    return None


def _positive_args(f, neg=False, out=None):
    out = [] if out is None else out
    if "f" in f:
        if not neg and f["f"] in ("holding", "near", "together", "in_vehicle", "conversed", "interacted", "alive", "pickup_collected"):
            out.extend(a for a in f.get("args", []) if isinstance(a, str))
        return out
    for k in ("and", "or"):
        for x in f.get(k, []):
            _positive_args(x, neg, out)
    if "not" in f:
        _positive_args(f["not"], not neg, out)
    for k in ("ever", "held", "within"):
        if k in f:
            _positive_args(f[k], neg, out)
    for x in f.get("before", []):
        _positive_args(x, neg, out)
    return out


def objective_blocked(exp, state):
    sf = success_formula(exp, state)
    if not sf:
        return False
    f = sf[1]
    args = _positive_args(f)
    lost = [a for a in args if a not in W.PLACES and a != "player" and W.role_lost(state, a)]
    if not lost:
        return False
    # an 'or' objective may still be achievable via another branch: crude check on the top level
    if "or" in f:
        return all(any(a in lost for a in _positive_args(x)) for x in f["or"])
    return True


# ------------------------------------------------------------------ players

class Player:
    def __init__(self, kind, rng):
        self.kind, self.rng, self.plan, self.plan_key = kind, rng, [], None

    def _replan(self, exp, state):
        r = solve_from(exp, state, nodes=700)
        self.plan = list(r) if r else []
        self.plan_key = (state["stage"], str(success_formula(exp, state)))

    def choose(self, exp, state):
        acts = macro_actions(exp, state)
        if not acts:
            return ("wait", None)
        if self.kind == "chaotic" and self.rng.random() < 0.5:
            weights = [3 if a[0] in ("kill", "destroy", "ram", "snipe") else 1 for a in acts]
            return self.rng.choices(acts, weights=weights)[0]
        if self.kind == "wanderer" and self.rng.random() < 0.7:
            return self.rng.choice([a for a in acts if a[0] in ("goto", "wait")] or acts)
        if self.kind == "creative" and self.rng.random() < 0.5:
            alts = first_actions_of_solutions(exp, state, nodes=500)
            unusual = [a for a in alts if a[0] in ("ram", "threaten", "snipe", "destroy", "talk")]
            pick = unusual or alts
            if pick:
                return self.rng.choice(pick)
        key = (state["stage"], str(success_formula(exp, state)))
        if not self.plan or key != self.plan_key or self.plan[0] not in acts:
            self._replan(exp, state)
        if self.plan:
            return tuple(self.plan.pop(0))
        return self.rng.choice(acts)


def _sub_exp(exp, state):
    """Experience view whose start is the current stage (for local search)."""
    return exp


def solve_from(exp, state, nodes=700):
    from collections import deque
    q = deque([(state, ())])
    seen = {W.key(state)}
    n = 0
    stage0 = state["stage"]
    while q and n < nodes:
        s, path = q.popleft()
        n += 1
        for a in macro_actions(exp, s):
            t = apply_macro(exp, s, a)
            if t is None:
                continue
            k = W.key(t)
            if k in seen:
                continue
            seen.add(k)
            p = path + (a,)
            if t["outcome"] == "END_SUCCESS" or (t["stage"] != stage0 and not t["outcome"]):
                return [list(x) for x in p]
            if t["outcome"]:
                continue
            q.append((t, p))
    return None


def first_actions_of_solutions(exp, state, nodes=500):
    from collections import deque
    q = deque([(state, None)])
    seen = {W.key(state)}
    firsts = set()
    n = 0
    stage0 = state["stage"]
    while q and n < nodes:
        s, first = q.popleft()
        n += 1
        for a in macro_actions(exp, s):
            t = apply_macro(exp, s, a)
            if t is None:
                continue
            k = W.key(t)
            if k in seen:
                continue
            seen.add(k)
            f0 = first or a
            if t["outcome"] == "END_SUCCESS" or (t["stage"] != stage0 and not t["outcome"]):
                firsts.add(f0)
                continue
            if t["outcome"]:
                continue
            q.append((t, f0))
    return sorted(firsts, key=str)


# ------------------------------------------------------------------ strategies

class Params:
    def __init__(self, p_bad=0.15, latency=(0, 1), coverage=1.0, p_cosmetic=0.3, hard_detect=0.97,
                 continuity_detect=0.8, q_world=0.03, p_reload=0.1, max_steps=80):
        self.__dict__.update(locals())
        del self.__dict__["self"]


def run_episode(exp0, strategy, player_kind, params, seed):
    rng = random.Random(seed)
    exp = copy.deepcopy(exp0)
    world_acc = strategy in ("S3", "S4")
    if strategy in ("S3", "S4") and params.coverage < 1.0:
        keep = [a for a in exp.get("accommodations", []) if rng.random() < params.coverage]
        exp["accommodations"] = keep
    library = {a["threat"].get("role_lost"): a["then"] for a in exp0.get("accommodations", []) if "role_lost" in a["threat"]}
    if not world_acc:
        exp["accommodations"] = []
    player = Player(player_kind, rng)
    state = W.initial_state(exp)
    m = {"churn": 0, "incoherent_shown": 0, "coherence_breaks": 0, "model_calls": 0, "limbo": 0, "stall": 0,
         "resumed": 0, "outcome": None, "steps": 0, "disturbances": 0, "redesigns": 0, "moved": False}
    pending = None  # (remaining latency, kind)
    redesigns = 0
    lost_seen = set()
    reload_at = rng.randrange(5, 40) if rng.random() < params.p_reload else None
    critical = sorted({a for st in exp0["stages"] for o in st["objectives"] if o["kind"] == "success"
                       for a in _positive_args(o["formula"]) if a not in W.PLACES and a != "player"})
    exposed = sorted(set(critical) | support_roles(exp0, critical))
    checkpoint_stage = state["stage"]
    for t in range(params.max_steps):
        if state["outcome"]:
            break
        # --- session reload: RAM-only state is gone
        if reload_at is not None and t == reload_at:
            reload_at = None
            if strategy in ("S3", "S4"):
                # ledger keeps only verified stage boundaries; re-stage the current stage freshly
                fresh = W.initial_state(exp)
                fresh["player"]["place"] = state["player"]["place"]
                W.enter_stage(exp, fresh, checkpoint_stage)
                state = fresh
                m["resumed"] += 1
                continue
            m["outcome"] = "aborted_by_reload"
            break
        # --- exogenous world disturbance (traffic, police, ambient AI)
        # Targets: critical roles and the roles that carry them (run 2). In run 1 only
        # critical roles were eligible, so in the courier job (whose critical roles are an
        # item and a place) the disturbance never fired - see README "Revision log".
        if rng.random() < params.q_world:
            alive = [r for r in exposed if r in state["roles"] and state["roles"][r]["spawned"] and not W.role_lost(state, r)
                     and state["roles"][r]["kind"] in ("ped", "vehicle")]
            if alive:
                victim = rng.choice(alive)
                state = W.clone(state)
                if state["roles"][victim]["kind"] == "ped":
                    W.kill_role(state, victim)
                else:
                    W.destroy_vehicle(state, victim)
                m["disturbances"] += 1
        # --- player acts; world advances
        before_stage, before_obj = state["stage"], success_formula(exp, state)
        before_wanted, before_fired = state["player"]["wanted"], len(state["fired"])
        act = player.choose(exp, state)
        nxt = apply_macro(exp, state, act, accommodations=world_acc) if act[0] == "goto" else W.step(exp, state, act, world_acc)
        if nxt is None:
            nxt = W.step(exp, state, ("wait", None), world_acc)
        state = nxt
        m["steps"] = state["t"]
        if state["stage"] != before_stage and not state["outcome"]:
            checkpoint_stage = state["stage"]
        newly_lost = [r for r in critical if r in state["roles"] and r not in lost_seen and W.role_lost(state, r)]
        lost_seen.update(newly_lost)
        after_obj = success_formula(exp, state)
        if state["stage"] == before_stage and before_obj and after_obj and before_obj[1] != after_obj[1]:
            m["churn"] += 1  # objective changed without stage progress (accommodation or re-plan)
        if state["outcome"]:
            break
        blocked = objective_blocked(exp, state)
        if blocked:
            m["stall"] += 1
        # --- strategy reaction
        if strategy == "S0":
            continue
        if strategy in ("S3", "S4"):
            if blocked:
                if strategy == "S4" and redesigns < 2:
                    redesigns += 1
                    m["model_calls"] += 1
                    if rng.random() > params.p_bad or rng.random() < params.hard_detect:
                        _fail_forward(exp, state)
                        m["churn"] += 1
                        m["redesigns"] += 1
                        m["moved"] = True  # the stakes changed: success now counts as END_SUCCESS_MOVED
                        continue
                W.apply_responses(exp, state, [{"do": "conclude", "outcome": "END_CONCLUDED"}])
            continue
        # S1 / S2: event-triggered re-planning
        significant = bool(newly_lost) or state["player"]["wanted"] != before_wanted or len(state["fired"]) != before_fired
        if pending is None and significant:
            pending = [rng.randint(*params.latency), list(newly_lost)]
            m["model_calls"] += 1
        if pending is not None:
            if pending[0] > 0:
                pending[0] -= 1
                m["limbo"] += 1
                continue
            lost_now = pending[1]
            pending = None
            bad = rng.random() < params.p_bad
            if bad:
                kind = "incoherent" if rng.random() < 0.5 else "coherence_break"
                caught = strategy == "S2" and rng.random() < (params.hard_detect if kind == "incoherent" else params.continuity_detect)
                if caught:
                    pending = [rng.randint(*params.latency), lost_now]
                    m["model_calls"] += 1
                    continue
                _apply_bad(exp, state, kind, rng)
                m["moved"] = True
                m["churn"] += 1
                if kind == "incoherent":
                    m["incoherent_shown"] += 1
                else:
                    m["coherence_breaks"] += 1
                continue
            repaired = False
            for r in lost_now:
                if r in library:
                    W.apply_responses(exp, state, library[r])
                    repaired = True
            if not repaired and objective_blocked(exp, state):
                W.apply_responses(exp, state, [{"do": "conclude", "outcome": "END_CONCLUDED"}])
            elif not lost_now and rng.random() < (params.p_cosmetic if strategy == "S1" else params.p_cosmetic / 3):
                m["churn"] += 1  # cosmetic re-wording of an unchanged objective
    out = state["outcome"] or m["outcome"] or "timeout_in_progress"
    if out == "END_FAILURE" and m["stall"] >= 5:
        out = "dead_experience"
    if out == "END_SUCCESS" and m["moved"]:
        # Run 2: a 'success' reached only after the goalposts moved (an unchecked bad
        # re-plan, or S4's generic fail-forward) is reported separately, not as success.
        out = "END_SUCCESS_MOVED"
    m["outcome"] = out
    return m


def support_roles(exp, critical):
    """Roles that carry or transport a critical role (holder ped, its vehicle, ...)."""
    roles = {r["id"]: r for r in exp["roles"]}
    out, frontier = set(), list(critical)
    while frontier:
        x = frontier.pop()
        r = roles.get(x)
        if r is None:
            continue
        nxt = []
        if r.get("in"):
            nxt.append(r["in"])
        nxt += [v["id"] for v in roles.values() if v.get("driver") == x]
        for y in nxt:
            if y not in out and y not in critical:
                out.add(y)
                frontier.append(y)
    return out


def _apply_bad(exp, state, kind, rng):
    sf = success_formula(exp, state)
    if not sf:
        return
    oid = sf[0]
    lost = [r for r in state["roles"] if W.role_lost(state, r)]
    if kind == "incoherent":
        to = {"f": "holding", "args": ["player", lost[0]]} if lost else {"and": [{"f": "near", "args": ["player", "paleto_forest"]},
                                                                               {"f": "near", "args": ["player", "harbor_water"]}]}
    else:
        to = {"f": "near", "args": ["player", rng.choice(sorted(p for p in W.PLACES if "water" not in W.PLACES[p]["tags"]))]}
    state["objective_overrides"][oid] = to


def _fail_forward(exp, state):
    """Generic continuation used by S4's re-design: turn a blocked objective into an escape."""
    sf = success_formula(exp, state)
    if not sf:
        return
    here = state["player"]["place"]
    state["objective_overrides"][sf[0]] = {"f": "far", "args": ["player", here, 3]}
