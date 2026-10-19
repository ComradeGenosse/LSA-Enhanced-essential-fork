"""Two experience generators used for the novelty experiment (X-3) and the census (X-1).

* TemplateGenerator - baseline modelled on existing GTA mission-generator mods
  (fixed mission shapes, randomised places/models/guards; cf. PGM 0.1.2, LIQUIDATOR).
* AlgebraGenerator  - composes stages from the fluent/policy algebra: it picks a stake,
  synthesises a goal formula over observable fluents, derives opposing pressure from the
  actor-policy catalog ("opposition analysis"), links stages by typed data flow and may
  add one twist. It contains no hand-written mission sequences, but it is still bounded
  by the vocabulary of fluents, policies and relations encoded below - that boundary is
  stated in 02/03 and is itself a research question (BQ-5).

Neither generator is an LLM. In the proposed architecture an LLM proposes specs in the
same IR and the same critics judge them; the experiment isolates what the IR + critics
can express and reject, independently of any model.
"""
import random
from . import world as W

NAMES = ["Rosa", "Dmitri", "Kev", "Lupe", "Marcus", "Tash", "Ozzie", "Nadia", "Benny", "Ivy", "Rook", "Sal"]
ROAD = [p for p, d in W.PLACES.items() if "road" in d["tags"]]
FOOT = [p for p, d in W.PLACES.items() if "water" not in d["tags"]]
INTERIOR = [p for p, d in W.PLACES.items() if "interior" in d["tags"]]
OFFROAD = [p for p, d in W.PLACES.items() if "offroad" in d["tags"] and "road" not in d["tags"]]


def _f(name, *args):
    return {"f": name, "args": list(args)}


class _Builder:
    def __init__(self, rng, companion, start):
        self.rng = rng
        self.exp = {"id": None, "mode": "mission", "genre": [], "consent": "player_requested", "pitch": "",
                    "player_start": start, "roles": [{"id": "player", "kind": "player", "source": "player"}],
                    "stages": [], "start": "s1", "accommodations": [], "consequences": [],
                    "budgets": {"steps": 90}, "meta": {"features": [], "surface": []}}
        self.n = 0
        self.companion = companion
        if companion:
            self.exp["roles"].append({"id": "nathan", "kind": "ped", "source": "companion", "tags": ["promoted"]})

    def role(self, kind, source="spawn", **kw):
        self.n += 1
        rid = "%s%d" % (kind[0] if kind != "pickup" else "k", self.n)
        r = {"id": rid, "kind": kind, "source": source, "tags": kw.pop("tags", [])}
        r.update(kw)
        self.exp["roles"].append(r)
        return rid

    def feat(self, *items):
        self.exp["meta"]["features"].extend(items)

    def surf(self, *items):
        self.exp["meta"]["surface"].extend(items)


class AlgebraGenerator:
    RELATIONS = {
        "ped": ["eliminate", "meet", "intercept", "tail", "escort", "rescue"],
        "vehicle": ["acquire", "deliver_vehicle", "disable"],
        "item": ["retrieve", "deliver_item"],
        "prop": ["examine"],
        "place": ["reach", "hold"],
    }

    def __init__(self, seed=0, allow_scene=True, allow_companion_policies=True):
        self.rng = random.Random(seed)
        self.allow_scene = allow_scene

    def generate(self, idx):
        rng = self.rng
        start = rng.choice(["downtown", "vinewood_blvd", "strawberry", "del_perro"])
        b = _Builder(rng, companion=rng.random() < 0.6, start=start)
        b.exp["id"] = "alg-%04d" % idx
        n_stages = rng.choice([1, 2, 2, 3, 3])
        prev = None  # (relation, stake role id, kind)
        twist_done = False
        for k in range(n_stages):
            sid = "s%d" % (k + 1)
            stage = {"id": sid, "objectives": [], "policies": [], "rules": [], "timeout": rng.choice([14, 18, 24, 30])}
            flow = "fresh"
            if prev and rng.random() < 0.65:
                flow = rng.choice(["continue", "reveal"])
            stake_kind, stake = None, None
            if flow == "continue" and prev[2] in ("item", "vehicle"):
                stake_kind, stake = prev[2], prev[1]
                rel = "deliver_item" if stake_kind == "item" else "deliver_vehicle"
            else:
                if flow == "continue":
                    flow = "fresh"
                stake_kind = rng.choice(list(self.RELATIONS))
                if not self.allow_scene and stake_kind != "place":
                    stake_kind = "place"
                rel = rng.choice(self.RELATIONS[stake_kind])
            b.feat("flow:" + flow)
            reveal_by = prev[1] if (flow == "reveal" and prev and prev[2] in ("ped", "prop")) else None
            self._stage(b, stage, stake_kind, stake, rel, reveal_by)
            if not twist_done and rng.random() < 0.3 and self.allow_scene:
                twist_done = self._twist(b, stage)
            # failure semantics and chaining
            fails = [_f("player_wasted"), _f("player_busted")]
            fails.extend(stage.pop("_extra_fail", []))
            stage["objectives"].append({"id": "f" + sid, "kind": "failure", "formula": {"or": fails}})
            if b.companion:
                stage["policies"].append({"role": "nathan", "cap": "follow_player", "consented": True})
            b.exp["stages"].append(stage)
            prev = (rel, stage.pop("_stake"), stage.pop("_kind"))
        for i, st in enumerate(b.exp["stages"]):
            nxt = b.exp["stages"][i + 1]["id"] if i + 1 < len(b.exp["stages"]) else "END_SUCCESS"
            st["on_success"] = nxt
            st["on_failure"] = "END_FAILURE"
            st["on_timeout"] = st.get("on_timeout", "END_FAILURE")
        # stage-structure feature (shape of the stage graph)
        b.feat("shape:%d" % len(b.exp["stages"]))
        return b.exp

    # ---- stage synthesis
    def _place(self, kinds=("road",), avoid=()):
        opts = [p for p, d in W.PLACES.items() if d["tags"] & set(kinds) and p not in avoid]
        return self.rng.choice(opts)

    def _stage(self, b, stage, kind, stake, rel, reveal_by):
        rng = self.rng
        sid = stage["id"]
        deferred = {"deferred": True, "revealed_by": reveal_by} if reveal_by else {}
        succ = None
        extra_fail = []
        press = []
        if kind == "ped":
            tags = [t for t in ("armed", "informant", "vip") if rng.random() < 0.35]
            in_vehicle = rel in ("intercept", "tail") or (rel == "eliminate" and rng.random() < 0.4)
            if in_vehicle:
                place = self._place(("road",))
                p = b.role("ped", tags=tags, place=place, **deferred)
                v = b.role("vehicle", tags=[rng.choice(["car", "van", "sports"])], place=place, driver=p, **deferred)
                b.surf(place, b.exp["roles"][-1]["tags"][0])
            else:
                place = self._place(("road", "offroad", "interior"))
                p = b.role("ped", tags=tags, place=place, **deferred)
                b.surf(place)
            dest = self._place(("road",), avoid=(place,))
            if rel == "eliminate":
                succ = _f("dead", p)
                if in_vehicle:
                    press.append({"role": p, "cap": "gm_drive_to", "args": {"dest": dest}})
                    extra_fail.append(_f("near", p, dest))
                    stage["rules"].append({"id": "notice", "on": _f("together", "player", p),
                                           "then": [{"do": "deactivate", "role": p},
                                                    {"do": "activate", "role": p, "cap": "gm_vehicle_flee", "args": {"from": "player"}}]})
                else:
                    g = b.role("ped", tags=["armed"], place=place)
                    press.append({"role": g, "cap": "gm_guard_area", "args": {"area": place}})
                    stage["rules"].append({"id": "alarm", "on": _f("together", "player", p),
                                           "then": [{"do": "activate", "role": p, "cap": "gm_flee", "args": {"from": "player"}}]})
                    extra_fail.append(_f("far", p, "player", 4))
            elif rel == "meet":
                succ = _f("conversed", p)
                if "armed" in tags:
                    press.append({"role": p, "cap": "gm_guard_area", "args": {"area": place}})
                extra_fail.append(_f("dead", p))
            elif rel == "intercept":
                succ = {"or": [_f("dead", p), {"not": _f("vehicle_driveable", v)}, _f("conversed", p)]}
                press.append({"role": p, "cap": "gm_drive_to", "args": {"dest": dest}})
                extra_fail.append(_f("near", p, dest))
            elif rel == "tail":
                n = rng.choice([2, 3])
                succ = {"held": _f("together", "player", p), "n": n}
                press.append({"role": p, "cap": "gm_drive_to", "args": {"dest": dest}})
                extra_fail.append(_f("near", p, dest))
                stage["rules"].append({"id": "spotted", "on": {"held": _f("together", "player", p), "n": n + 2},
                                       "then": [{"do": "deactivate", "role": p},
                                                {"do": "activate", "role": p, "cap": "gm_vehicle_flee", "args": {"from": "player"}}]})
                b.feat("temporal:held")
            elif rel in ("escort", "rescue"):
                succ = {"and": [_f("near", p, dest), _f("alive", p)]} if rel == "escort" else {"and": [_f("together", "player", p), _f("alive", p)]}
                if rel == "escort":
                    stage["rules"].append({"id": "join", "on": _f("conversed", p),
                                           "then": [{"do": "activate", "role": p, "cap": "gm_follow_player", "args": {}}]})
                    a = b.role("ped", tags=["armed"], place=self._place(("road",)), deferred=True)
                    av = b.role("vehicle", tags=["car"], place=b.exp["roles"][-1]["place"], driver=a, deferred=True)
                    stage["rules"].append({"id": "hit", "on": _f("conversed", p),
                                           "then": [{"do": "spawn", "role": a}, {"do": "spawn", "role": av},
                                                    {"do": "activate", "role": a, "cap": "gm_vehicle_chase", "args": {"target": "player"}}]})
                else:
                    g = b.role("ped", tags=["armed"], place=place)
                    press.append({"role": g, "cap": "gm_guard_area", "args": {"area": place}})
                extra_fail.append(_f("dead", p))
            stake_out, kind_out = p, "ped"
            b.feat("stake:ped", "rel:" + rel, "ped_in_vehicle:%s" % in_vehicle, *("tag:" + t for t in tags))
        elif kind == "vehicle":
            if stake is None:
                vclass = rng.choice(["car", "sports", "van", "offroad", "bike", "boat"])
                allowed = [p for p in W.PLACES if W.place_ok_for_vehicle(vclass, p)]
                place = rng.choice(allowed)
                v = b.role("vehicle", tags=[vclass], place=place, **deferred)
                b.surf(place, vclass)
            else:
                v = stake
                vclass = W.vehicle_class(next(r for r in b.exp["roles"] if r["id"] == v))
                place = next(r for r in b.exp["roles"] if r["id"] == v)["place"]
            if rel == "acquire":
                succ = _f("in_vehicle", "player", v)
                if rng.random() < 0.6:
                    g = b.role("ped", tags=["armed"], place=place)
                    press.append({"role": g, "cap": "gm_guard_area", "args": {"area": place}})
                extra_fail.append({"not": _f("vehicle_driveable", v)})
            elif rel == "deliver_vehicle":
                dests = [p for p in W.PLACES if W.place_ok_for_vehicle(vclass, p) and p != place]
                dest = rng.choice(dests)
                succ = {"and": [_f("in_vehicle", "player", v), _f("near", v, dest)]}
                if rng.random() < 0.6:
                    c = b.role("ped", tags=["armed"], place=self._place(("road",)), deferred=True)
                    cv = b.role("vehicle", tags=["car"], place=b.exp["roles"][-1]["place"], driver=c, deferred=True)
                    stage["rules"].append({"id": "heat", "on": _f("in_vehicle", "player", v),
                                           "then": [{"do": "spawn", "role": c}, {"do": "spawn", "role": cv},
                                                    {"do": "activate", "role": c, "cap": "gm_vehicle_chase", "args": {"target": "player"}}]})
                extra_fail.append({"not": _f("vehicle_driveable", v)})
            elif rel == "disable":
                d = b.role("ped", tags=[], place=place, **deferred)
                next(r for r in b.exp["roles"] if r["id"] == v)["driver"] = d
                dest = self._place(("road",), avoid=(place,)) if vclass in ("car", "sports", "van") else place
                succ = {"not": _f("vehicle_driveable", v)}
                if vclass in ("car", "sports", "van"):
                    press.append({"role": d, "cap": "gm_drive_to", "args": {"dest": dest}})
                    extra_fail.append(_f("near", v, dest))
            stake_out, kind_out = v, "vehicle"
            b.feat("stake:vehicle", "rel:" + rel, "vclass:" + vclass)
        elif kind == "item":
            if stake is None:
                mode = rng.choice(["carried", "stash", "in_vehicle"])
                if mode == "carried":
                    place = self._place(("road", "offroad"))
                    h = b.role("ped", tags=["armed"] if rng.random() < 0.5 else [], place=place, **deferred)
                    it = b.role("item", tags=[], **{"in": h}, **deferred)
                    if rng.random() < 0.5:
                        press.append({"role": h, "cap": "gm_flee", "args": {"from": "player"}})
                        extra_fail.append({"and": [_f("far", h, "player", 4), {"not": _f("holding", "player", it)}]})
                elif mode == "in_vehicle":
                    place = self._place(("road",))
                    h = b.role("ped", tags=["armed"], place=place, **deferred)
                    vv = b.role("vehicle", tags=["van"], place=place, driver=h, **deferred)
                    it = b.role("item", tags=["fragile"] if rng.random() < 0.4 else [], **{"in": h}, **deferred)
                    dest = self._place(("road",), avoid=(place,))
                    press.append({"role": h, "cap": "gm_drive_to", "args": {"dest": dest}})
                    extra_fail.append(_f("near", vv, dest))
                    extra_fail.append({"not": _f("exists", it)})
                else:
                    place = self._place(("road", "offroad", "interior"))
                    it = b.role("item", tags=[], place=place, **deferred)
                    if rng.random() < 0.7:
                        g = b.role("ped", tags=["armed"], place=place)
                        press.append({"role": g, "cap": "gm_guard_area", "args": {"area": place}})
                b.surf(place, mode)
                b.feat("item_mode:" + mode)
            else:
                it = stake
            if rel == "retrieve":
                succ = _f("holding", "player", it)
            else:
                dest = self._place(("road", "offroad"))
                succ = {"and": [_f("holding", "player", it), _f("near", "player", dest)]}
                if rng.random() < 0.5:
                    c = b.role("ped", tags=["armed"], place=self._place(("road",)), deferred=True)
                    cv = b.role("vehicle", tags=["car"], place=b.exp["roles"][-1]["place"], driver=c, deferred=True)
                    stage["rules"].append({"id": "pursuit", "on": {"f": "timer_elapsed", "args": [2]},
                                           "then": [{"do": "spawn", "role": c}, {"do": "spawn", "role": cv},
                                                    {"do": "activate", "role": c, "cap": "gm_vehicle_chase", "args": {"target": "player"}}]})
            stake_out, kind_out = it, "item"
            b.feat("stake:item", "rel:" + rel)
        elif kind == "prop":
            place = self._place(("road", "offroad", "interior"))
            pr = b.role("prop", tags=["clue"], place=place, **deferred)
            succ = _f("interacted", pr)
            if rng.random() < 0.5:
                g = b.role("ped", tags=["armed"], place=place)
                press.append({"role": g, "cap": "gm_guard_area", "args": {"area": place}})
            stake_out, kind_out = pr, "prop"
            b.surf(place)
            b.feat("stake:prop", "rel:examine")
        else:  # place
            dest = rng.choice(FOOT)
            pl = b.role("place", source="atlas", place=dest)
            if rel == "reach":
                n = rng.choice([6, 8, 10])
                succ = {"within": _f("near", "player", pl), "n": n}
                b.feat("temporal:within")
            else:
                n = rng.choice([3, 4, 5])
                succ = {"held": _f("near", "player", pl), "n": n}
                if self.allow_scene:
                    a = b.role("ped", tags=["armed"], place=self._place(("road", "offroad"), avoid=(dest,)), deferred=True)
                    stage["rules"].append({"id": "wave", "on": _f("near", "player", pl),
                                           "then": [{"do": "spawn", "role": a},
                                                    {"do": "activate", "role": a, "cap": "gm_combat", "args": {"target": "player"}}]})
                b.feat("temporal:held")
            stake_out, kind_out = pl, "place"
            b.surf(dest)
            b.feat("stake:place", "rel:" + rel)
        stage["objectives"].append({"id": "o" + sid, "kind": "success", "formula": succ})
        stage["policies"].extend(press)
        for pz in press:
            b.feat("press:" + pz["cap"])
        for rule in stage["rules"]:
            b.feat("rule:" + rule["id"])
        stage["_extra_fail"] = extra_fail
        stage["_stake"] = stake_out
        stage["_kind"] = kind_out

    def _twist(self, b, stage):
        rng = self.rng
        t = rng.choice(["third_party", "escalation", "decoy", "turncoat"])
        if t == "third_party":
            c = b.role("ped", tags=["armed"], place=self._place(("road",)), deferred=True)
            cv = b.role("vehicle", tags=["car"], place=b.exp["roles"][-1]["place"], driver=c, deferred=True)
            stage["rules"].append({"id": "rival", "on": {"f": "timer_elapsed", "args": [3]},
                                   "then": [{"do": "spawn", "role": c}, {"do": "spawn", "role": cv},
                                            {"do": "activate", "role": c, "cap": "gm_vehicle_chase", "args": {"target": "player"}}]})
        elif t == "escalation":
            c = b.role("ped", tags=["armed"], place=self._place(("road",)), deferred=True)
            stage["rules"].append({"id": "escalate", "on": _f("wanted_ge", 1),
                                   "then": [{"do": "spawn", "role": c},
                                            {"do": "activate", "role": c, "cap": "gm_combat", "args": {"target": "player"}}]})
        elif t == "decoy":
            succ = stage["objectives"][0]["formula"]
            if succ.get("f") != "holding":
                return False
            real = b.role("item", tags=[], place=self._place(("road", "offroad")), deferred=True)
            stage["rules"].append({"id": "decoy", "on": succ,
                                   "then": [{"do": "spawn", "role": real},
                                            {"do": "transform", "objective": stage["objectives"][0]["id"], "to": _f("holding", "player", real)},
                                            {"do": "speak_beat", "beat": "it_was_a_decoy"}]})
            # a decoy must not complete the stage: success is the real item only
            stage["objectives"][0]["formula"] = {"and": [succ, _f("holding", "player", real)]}
        elif t == "turncoat":
            peds = [r for r in b.exp["roles"] if r["kind"] == "ped" and r["source"] == "spawn" and "armed" not in r.get("tags", [])]
            if not peds:
                return False
            p = peds[-1]["id"]
            stage["rules"].append({"id": "turncoat", "on": _f("together", "player", p),
                                   "then": [{"do": "activate", "role": p, "cap": "gm_combat", "args": {"target": "player"}}]})
            next(r for r in b.exp["roles"] if r["id"] == p)["tags"].append("armed")
        b.feat("twist:" + t)
        return True


class TemplateGenerator:
    """Baseline: three fixed mission shapes with randomised surface parameters."""

    def __init__(self, seed=0):
        self.rng = random.Random(seed)

    def generate(self, idx):
        rng = self.rng
        b = _Builder(rng, companion=rng.random() < 0.6, start=rng.choice(["downtown", "vinewood_blvd", "strawberry", "del_perro"]))
        b.exp["id"] = "tpl-%04d" % idx
        t = rng.choice(["steal_car", "kill_target", "steal_object"])
        place = rng.choice(ROAD)
        dest = rng.choice([p for p in ROAD if p != place])
        stage = {"id": "s1", "objectives": [], "policies": [], "rules": [], "timeout": 30,
                 "on_success": "END_SUCCESS", "on_failure": "END_FAILURE", "on_timeout": "END_FAILURE"}
        guards = rng.choice([0, 1, 2, 3])
        for _ in range(guards):
            g = b.role("ped", tags=["armed"], place=place)
            stage["policies"].append({"role": g, "cap": "gm_guard_area", "args": {"area": place}})
        if t == "steal_car":
            vclass = rng.choice(["car", "sports", "van"])
            v = b.role("vehicle", tags=[vclass], place=place)
            succ = {"and": [_f("in_vehicle", "player", v), _f("near", v, dest)]}
            fail = [{"not": _f("vehicle_driveable", v)}]
            b.surf(place, dest, vclass)
        elif t == "kill_target":
            p = b.role("ped", tags=[], place=place)
            succ = _f("dead", p)
            fail = []
            b.surf(place, rng.choice(NAMES))
        else:
            it = b.role("item", tags=[], place=place)
            succ = {"and": [_f("holding", "player", it), _f("near", "player", dest)]}
            fail = []
            b.surf(place, dest)
        stage["objectives"].append({"id": "o1", "kind": "success", "formula": succ})
        stage["objectives"].append({"id": "f1", "kind": "failure", "formula": {"or": [_f("player_wasted"), _f("player_busted")] + fail}})
        if b.companion:
            stage["policies"].append({"role": "nathan", "cap": "follow_player", "consented": True})
        b.exp["stages"].append(stage)
        b.feat("template:" + t, "guards:%d" % min(guards, 1))
        return b.exp
