#!/usr/bin/env python3
"""GTA V Enhanced interior (MLO) metadata catalog builder, validator, ranker and search tool.

Input : raw extractor output (JSONL/TSV written by extractor/Extractor.cs) - metadata only.
Output: catalog.sqlite, interiors-summary.json, candidates.json, coverage.json.
Everything is deterministic: no timestamps, sorted inserts, fixed scoring weights.
Verified metadata (read from archives) is kept apart from heuristics (flag columns named *_assumed / heuristic_*).
"""
import argparse
import glob
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
from collections import defaultdict

SCHEMA_VERSION = 1
LAYER_ORDER = ["base", "update-base", "update-dlc_patch", "update-dlcpack", "onigiri-nve"]  # ASSUMED load precedence, not verified
ONLINE_PREFIX = re.compile(r"^(apa_|hei_|bkr_|ex_|sm_|xm|ba_|vw_|gr_|ch_|sf_|lr_|mp_|imp_|h4_|reh_|tr_|ss1_|sum_|cay_|fix_|mpbiker|mpsmuggler|ar_|lts_|dlc_)")
ONLINE_DLC = re.compile(r"(^mp|heist|lowrider|casino|biker|gunrun|import|smug|doomsday|arena|salvage|drug|contract|tuner|assault|cayo|vinewood|xmas|valentine|halloween|independence|apartment|executive|finance)")
UNDERGROUND_TOKENS = re.compile(r"(tun|subway|metro|sewer|bunker|drain|mine|cave|vault|lab|garage)")
NOT_STRUCTURE = re.compile(r"(prop_|tree|palm|bush|veg|grass|plant|weed|shrub|cactus|rock|cliff|boulder|fern|stump|brush|reed|flower|bamboo|cedar|pine|oak|hedge|forest|_lod|road|_rd|bridge|rail|terrain|ground|canal|water|overpass|highway|fwy|tunnel|decal|dcal|glass|sign|light)", re.I)


# ---------------------------------------------------------------- math
def quat_world(raw):
    """Stored YMAP rotation (x,y,z,w) applied as-is (q v q^-1).
    Empirically validated: interior entity positions land inside the YMAP entity extents for 99.99% of
    93.9k rotated-instance entities, versus ~84% when W is negated (the CodeWalker Orientation convention)."""
    return tuple(raw)


def rotate(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))


def to_world(inst, local):
    q = quat_world(inst["rotationRaw"])
    s = inst.get("scaleXY", 1.0) or 1.0
    sz = inst.get("scaleZ", 1.0) or 1.0
    r = rotate(q, (local[0] * s, local[1] * s, local[2] * sz))
    p = inst["position"]
    return (p[0] + r[0], p[1] + r[1], p[2] + r[2])


def aabb_world(inst, bmin, bmax):
    pts = [to_world(inst, (x, y, z)) for x in (bmin[0], bmax[0]) for y in (bmin[1], bmax[1]) for z in (bmin[2], bmax[2])]
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def r3(v):
    return [round(x, 3) for x in v]


# ---------------------------------------------------------------- raw loading
def read_jsonl(pattern):
    out = []
    for f in sorted(glob.glob(pattern)):
        with open(f, encoding="utf-8-sig") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    out.append(json.loads(line))
    return out


def read_tsv(pattern):
    for f in sorted(glob.glob(pattern)):
        with open(f, encoding="utf-8-sig") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if line:
                    yield line.split("\t")


def variant_sig(rec):
    core = {k: rec[k] for k in ("mloFlags", "rooms", "portals", "entitySets", "entities", "timeCycleModifiers")}
    return hashlib.sha256(json.dumps(core, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def layer_rank(layer):
    return LAYER_ORDER.index(layer) if layer in LAYER_ORDER else -1


def load_raw(raw):
    archs = read_jsonl(os.path.join(raw, "mlo-ytyp-*.jsonl"))
    insts = read_jsonl(os.path.join(raw, "mlo-inst-*.jsonl"))
    ymaps = {}
    for c in read_tsv(os.path.join(raw, "ymaps-*.tsv")):
        ymaps[int(c[0])] = {"path": c[1], "layer": c[2], "dlc": c[3], "name": c[4]}
    ents = []
    for c in read_tsv(os.path.join(raw, "ents-*.tsv")):
        ents.append({"hash": int(c[0]), "name": c[1], "pos": (float(c[2]), float(c[3]), float(c[4])), "ymap": int(c[9]), "lod": c[11]})
    files = defaultdict(list)
    fpath = os.path.join(raw, "files.tsv")
    if os.path.exists(fpath):
        for c in read_tsv(fpath):
            files[c[0]].append((c[1], c[3], c[4], c[5]))
    dims = {}
    for c in read_tsv(os.path.join(raw, "archetypes-*.tsv")):
        h = int(c[0])
        dims[h] = (float(c[5]) - float(c[2]), float(c[6]) - float(c[3]), float(c[7]) - float(c[4]), c[1], c[8])
    return archs, insts, ymaps, ents, files, dims


# ---------------------------------------------------------------- build
def build(raw, outdir, provenance=None):
    archs, insts, ymaps, ents, files, dims = load_raw(raw)
    os.makedirs(outdir, exist_ok=True)
    archs.sort(key=lambda r: (r["archetype"], layer_rank(r["layer"]), r["ytyp"]))
    insts.sort(key=lambda r: (r["archetype"], r["position"], layer_rank(r["layer"]), r["ymap"]))

    # --- interiors (by archetype hash) with variants
    interiors = {}
    for r in archs:
        r["sig"] = variant_sig(r)
        it = interiors.setdefault(r["hash"], {"name": r["archetype"], "hash": r["hash"], "resolved": r["resolved"], "variants": []})
        it["variants"].append(r)

    def exit_portals(v):
        return [p for p in v["portals"] if p["roomFrom"] == 0 or p["roomTo"] == 0]

    # --- placements: group instances across layers
    placements = {}
    for i in insts:
        key = (i["hash"], round(i["position"][0], 2), round(i["position"][1], 2), round(i["position"][2], 2))
        placements.setdefault(key, []).append(i)

    # --- structure index
    cell = 60.0
    grid = defaultdict(list)
    seen = set()
    for e in ents:
        if NOT_STRUCTURE.search(e["name"]):
            continue
        d = dims.get(e["hash"])
        if not d or max(d[0], d[1]) < 6 or d[2] < 2.5:
            continue
        k = (e["hash"], round(e["pos"][0], 1), round(e["pos"][1], 1), round(e["pos"][2], 1))
        y = ymaps.get(e["ymap"], {"layer": "?", "path": ""})
        if k in seen:
            for g in grid[(int(e["pos"][0] // cell), int(e["pos"][1] // cell))]:
                if g["key"] == k:
                    if y["layer"] not in g["layers"]:
                        g["layers"].append(y["layer"])
            continue
        seen.add(k)
        grid[(int(e["pos"][0] // cell), int(e["pos"][1] // cell))].append({"key": k, "name": e["name"], "hash": e["hash"], "pos": e["pos"], "dims": d[:3], "layers": [y["layer"]], "ymap": y["path"]})

    def nearby(pos, radius):
        cx, cy = int(pos[0] // cell), int(pos[1] // cell)
        n = int(radius // cell) + 1
        out = []
        for dx in range(-n, n + 1):
            for dy in range(-n, n + 1):
                for g in grid.get((cx + dx, cy + dy), []):
                    dd = math.hypot(g["pos"][0] - pos[0], g["pos"][1] - pos[1])
                    if dd <= radius:
                        out.append((dd, g))
        out.sort(key=lambda t: (round(t[0], 3), t[1]["name"]))
        return out

    dbpath = os.path.join(outdir, "catalog.sqlite")
    if os.path.exists(dbpath):
        os.remove(dbpath)
    db = sqlite3.connect(dbpath)
    db.executescript("""
PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE interiors(hash INTEGER PRIMARY KEY, name TEXT, name_resolved INTEGER, variant_count INTEGER, variants_differ INTEGER, layers TEXT, placement_count INTEGER);
CREATE TABLE variants(id INTEGER PRIMARY KEY, interior_hash INTEGER, sig TEXT, layer TEXT, dlc TEXT, top_rpf TEXT, ytyp TEXT, mlo_flags INTEGER, lod_dist REAL, room_count INTEGER, portal_count INTEGER, exit_portal_count INTEGER, entity_count INTEGER, entity_set_count INTEGER, timecycle_modifiers INTEGER, assets_present INTEGER, assets_missing INTEGER);
CREATE TABLE rooms(variant_id INTEGER, idx INTEGER, name TEXT, bb_min TEXT, bb_max TEXT, flags INTEGER, floor_id INTEGER, portal_count INTEGER, attached_objects INTEGER, timecycle TEXT);
CREATE TABLE portals(variant_id INTEGER, idx INTEGER, room_from INTEGER, room_to INTEGER, flags INTEGER, center TEXT, corner_count INTEGER, is_exit INTEGER);
CREATE TABLE entity_sets(variant_id INTEGER, idx INTEGER, name TEXT, entity_count INTEGER);
CREATE TABLE mlo_entities(variant_id INTEGER, idx INTEGER, archetype TEXT, hash INTEGER, name_resolved INTEGER, x REAL, y REAL, z REAL, room INTEGER, flags INTEGER, dim_x REAL, dim_y REAL, dim_z REAL, asset_kinds TEXT);
CREATE TABLE placements(id INTEGER PRIMARY KEY, interior_hash INTEGER, interior TEXT, x REAL, y REAL, z REAL, layers TEXT, dlcs TEXT, source_count INTEGER, ymaps TEXT, rot_x REAL, rot_y REAL, rot_z REAL, rot_w REAL, group_id INTEGER, floor_id INTEGER, num_exit_portals INTEGER, inst_flags TEXT, entity_flags INTEGER, lod_level TEXT, lod_dist REAL, default_entity_sets TEXT, ext_min TEXT, ext_max TEXT, precedence_variant_id INTEGER, exit_portals_verified INTEGER, placement_conflict INTEGER, online_like_assumed INTEGER, underground_like_assumed INTEGER, ybn_name_matches TEXT);
CREATE TABLE placement_sources(placement_id INTEGER, layer TEXT, dlc TEXT, top_rpf TEXT, ymap TEXT, instance_index INTEGER, guid INTEGER);
CREATE TABLE placement_rooms(placement_id INTEGER, room_idx INTEGER, name TEXT, world_min TEXT, world_max TEXT);
CREATE TABLE placement_exit_portals(placement_id INTEGER, portal_idx INTEGER, room_from INTEGER, room_to INTEGER, world_center TEXT, world_corners TEXT);
CREATE TABLE nearby_structures(placement_id INTEGER, rank INTEGER, archetype TEXT, hash INTEGER, dist_xy REAL, x REAL, y REAL, z REAL, dim_x REAL, dim_y REAL, dim_z REAL, layers TEXT, ymap TEXT);
CREATE TABLE candidates(rank INTEGER PRIMARY KEY, placement_id INTEGER, interior TEXT, score REAL, json TEXT);
""")
    meta = {"schema_version": str(SCHEMA_VERSION), "layer_precedence_assumed": ",".join(LAYER_ORDER)}
    if provenance:
        meta["provenance_sha256"] = hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest()
    for k, v in sorted(meta.items()):
        db.execute("INSERT INTO meta VALUES (?,?)", (k, v))

    # ---- fill interiors/variants
    vid = 0
    variant_id_by = {}
    containment = {"ok": 0, "bad": 0, "total": 0}
    for h in sorted(interiors):
        it = interiors[h]
        sigs = {v["sig"] for v in it["variants"]}
        layers = sorted({v["layer"] for v in it["variants"]}, key=layer_rank)
        pc = sum(1 for k in placements if k[0] == h)
        db.execute("INSERT INTO interiors VALUES (?,?,?,?,?,?,?)", (h, it["name"], int(it["resolved"]), len(it["variants"]), int(len(sigs) > 1), ",".join(layers), pc))
        for v in it["variants"]:
            vid += 1
            variant_id_by[(h, v["sig"], v["layer"], v["ytyp"])] = vid
            v["_vid"] = vid
            xp = exit_portals(v)
            kinds_cache = {}
            present = missing = 0
            for e in v["entities"]:
                nm = e["archetype"].lower()
                if nm not in kinds_cache:
                    kinds_cache[nm] = sorted({f[0] for f in files.get(nm, []) if f[0] in (".ydr", ".yft", ".ydd")})
                if kinds_cache[nm]:
                    present += 1
                else:
                    missing += 1
            db.execute("INSERT INTO variants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (vid, h, v["sig"], v["layer"], v["dlc"], v["topRpf"], v["ytyp"], v["mloFlags"], v["lodDist"], len(v["rooms"]), len(v["portals"]), len(xp), len(v["entities"]), len(v["entitySets"]), v["timeCycleModifiers"], present, missing))
            for r in v["rooms"]:
                db.execute("INSERT INTO rooms VALUES (?,?,?,?,?,?,?,?,?,?)", (vid, r["index"], r["name"], json.dumps(r3(r["bbMin"])), json.dumps(r3(r["bbMax"])), r["flags"], r["floorId"], r["portalCount"], r["attachedObjects"], r["timecycle"]))
            for p in v["portals"]:
                db.execute("INSERT INTO portals VALUES (?,?,?,?,?,?,?,?)", (vid, p["index"], p["roomFrom"], p["roomTo"], p["flags"], json.dumps(r3(p["center"])), p["cornerCount"], int(p["roomFrom"] == 0 or p["roomTo"] == 0)))
            for s in v["entitySets"]:
                db.execute("INSERT INTO entity_sets VALUES (?,?,?,?)", (vid, s["index"], s["name"], s["entityCount"]))
            for e in v["entities"]:
                d = dims.get(e["hash"], (None, None, None, None, None))
                db.execute("INSERT INTO mlo_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (vid, e["index"], e["archetype"], e["hash"], int(e["resolved"]), round(e["position"][0], 3), round(e["position"][1], 3), round(e["position"][2], 3), e["room"], e["flags"], d[0], d[1], d[2], ",".join(kinds_cache[e["archetype"].lower()])))

    # ---- placements
    pid = 0
    pl_rows = []
    for key in sorted(placements, key=lambda k: (interiors[k[0]]["name"], k[1], k[2], k[3])):
        group = placements[key]
        h = key[0]
        it = interiors[h]
        # precedence variant: highest-ranked layer among variants (ASSUMPTION)
        pv = sorted(it["variants"], key=lambda v: (layer_rank(v["layer"]), v["ytyp"]))[-1]
        first = sorted(group, key=lambda g: (layer_rank(g["layer"]), g["ymap"]))[0]
        last = sorted(group, key=lambda g: (layer_rank(g["layer"]), g["ymap"]))[-1]
        pid += 1
        layers = sorted({g["layer"] for g in group}, key=layer_rank)
        dlcs = sorted({g["dlc"] for g in group if g["dlc"]})
        pos = first["position"]
        xp = exit_portals(pv)
        conflict = int(len({(g["groupId"], g["floorId"], tuple(g["defaultEntitySets"]), g["mloInstFlags"]) for g in group}) > 1)
        name_l = it["name"].lower()
        online = int(bool(ONLINE_PREFIX.match(name_l)) or all(bool(ONLINE_DLC.search(g["dlc"])) for g in group if g["dlc"]) and all(g["dlc"] for g in group))
        underground = int(bool(UNDERGROUND_TOKENS.search(name_l)))
        stems = {re.sub(r"_milo_$", "", os.path.splitext(g["ymapName"])[0]) for g in group} | {name_l}
        ybn = sorted({f[3] + "|" + f[0] for s in stems for f in files.get(s.lower(), []) if f[0] == ".ybn"})[:6]
        db.execute("INSERT INTO placements VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            pid, h, it["name"], pos[0], pos[1], pos[2], ",".join(layers), ",".join(dlcs), len(group), json.dumps(sorted({g["ymapName"] for g in group})),
            first["rotationRaw"][0], first["rotationRaw"][1], first["rotationRaw"][2], first["rotationRaw"][3], first["groupId"], first["floorId"], max(g["numExitPortals"] for g in group),
            json.dumps(sorted({g["mloInstFlags"] for g in group})), first["entityFlags"], first["lodLevel"], first["lodDist"], json.dumps(first["defaultEntitySets"]),
            json.dumps(r3(first["entitiesExtents"]["min"])), json.dumps(r3(first["entitiesExtents"]["max"])), pv["_vid"], len(xp), conflict, online, underground, json.dumps(ybn)))
        for g in sorted(group, key=lambda g: (layer_rank(g["layer"]), g["ymap"])):
            db.execute("INSERT INTO placement_sources VALUES (?,?,?,?,?,?,?)", (pid, g["layer"], g["dlc"], g["topRpf"], g["ymap"], g["instanceIndex"], g["guid"]))
        wr = []
        for r in pv["rooms"]:
            lo, hi = aabb_world(first, r["bbMin"], r["bbMax"])
            wr.append((lo, hi))
            db.execute("INSERT INTO placement_rooms VALUES (?,?,?,?,?)", (pid, r["index"], r["name"], json.dumps(r3(lo)), json.dumps(r3(hi))))
        for p in xp:
            wc = to_world(first, p["center"])
            corners = [r3(to_world(first, c[:3])) for c in (p.get("corners") or [])]
            db.execute("INSERT INTO placement_exit_portals VALUES (?,?,?,?,?,?)", (pid, p["index"], p["roomFrom"], p["roomTo"], json.dumps(r3(wc)), json.dumps(corners)))
        # containment validation: world positions of interior entities vs ymap entity extents
        ext = first["entitiesExtents"]
        for e in pv["entities"]:
            wp = to_world(first, e["position"])
            containment["total"] += 1
            if all(ext["min"][i] - 3 <= wp[i] <= ext["max"][i] + 3 for i in range(3)):
                containment["ok"] += 1
            else:
                containment["bad"] += 1
        # exterior structures
        ext_c = [(ext["min"][i] + ext["max"][i]) / 2 for i in range(3)]
        radius = max(40.0, 0.5 * math.hypot(ext["max"][0] - ext["min"][0], ext["max"][1] - ext["min"][1]) + 20)
        near = nearby(pos, radius)
        for rank, (dd, g) in enumerate(near[:15], 1):
            db.execute("INSERT INTO nearby_structures VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (pid, rank, g["name"], g["hash"], round(dd, 2), g["pos"][0], g["pos"][1], g["pos"][2], round(g["dims"][0], 2), round(g["dims"][1], 2), round(g["dims"][2], 2), ",".join(sorted(g["layers"], key=layer_rank)), g["ymap"]))
        pl_rows.append(pid)

    # ---- FTS (optional)
    try:
        db.execute("CREATE VIRTUAL TABLE search USING fts5(kind, name, detail)")
        rows = []
        for h in sorted(interiors):
            rows.append(("interior", interiors[h]["name"], ""))
        for r in db.execute("SELECT DISTINCT room_name FROM (SELECT name AS room_name FROM rooms)"):
            rows.append(("room", r[0], ""))
        for r in db.execute("SELECT DISTINCT archetype FROM mlo_entities ORDER BY 1"):
            rows.append(("entity", r[0], ""))
        for r in db.execute("SELECT DISTINCT archetype FROM nearby_structures ORDER BY 1"):
            rows.append(("structure", r[0], ""))
        db.executemany("INSERT INTO search VALUES (?,?,?)", sorted(set(rows)))
        meta["fts5"] = "1"
        db.execute("INSERT OR REPLACE INTO meta VALUES ('fts5','1')")
    except sqlite3.OperationalError:
        db.execute("INSERT OR REPLACE INTO meta VALUES ('fts5','0')")
    db.executescript("CREATE INDEX i_pl_xy ON placements(x,y); CREATE INDEX i_pl_name ON placements(interior); CREATE INDEX i_ent_name ON mlo_entities(archetype); CREATE INDEX i_ns_pl ON nearby_structures(placement_id); CREATE INDEX i_var_h ON variants(interior_hash);")
    db.commit()

    cands = rank_candidates(db)
    for c in cands:
        db.execute("INSERT INTO candidates VALUES (?,?,?,?,?)", (c["rank"], c["placement_id"], c["interior"], c["score"], json.dumps(c, sort_keys=True)))
    db.commit()

    cov = coverage(db, archs, insts, ymaps, ents, files, containment, provenance)
    with open(os.path.join(outdir, "coverage.json"), "w", encoding="utf-8") as f:
        json.dump(cov, f, indent=1, sort_keys=True)
    with open(os.path.join(outdir, "candidates.json"), "w", encoding="utf-8") as f:
        json.dump({"schema_version": SCHEMA_VERSION, "disclaimer": DISCLAIMER, "candidates": cands}, f, indent=1, sort_keys=True)
    summary = summarize(db)
    with open(os.path.join(outdir, "interiors-summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, separators=(",", ":"), sort_keys=True)
    db.execute("VACUUM")
    db.close()
    return cov


DISCLAIMER = ("Ranking is a heuristic over verified metadata (YTYP/YMAP) plus labelled assumptions. An MLO, an exit portal or a nearby "
              "large model does NOT prove a wall is breachable or that collision is isolatable; every candidate still needs a collision (YBN) "
              "and ownership investigation before any destruction work.")


# ---------------------------------------------------------------- ranking
WEIGHTS = {
    "exit_portal": 25, "extra_exit_portal": 5, "story_layer": 20, "online_like": -25, "rooms_2_10": 15, "rooms_1": 8, "rooms_gt20": -10,
    "single_dominant_building": 20, "few_buildings": 8, "many_buildings": -8, "no_conflict": 5, "conflict": -10, "underground": -30,
    "assets_complete": 5, "asset_gaps": -5, "crowded_mlo": -5, "ybn_name_match": 3, "colocated_shell": 10, "modest_footprint": 8, "huge_footprint": -8,
}


def rank_candidates(db, top=5, separation=150.0):
    rows = db.execute("SELECT * FROM placements").fetchall()
    cols = [d[0] for d in db.execute("SELECT * FROM placements LIMIT 0").description]
    pls = [dict(zip(cols, r)) for r in rows]
    scored = []
    for p in pls:
        var = db.execute("SELECT * FROM variants WHERE id=?", (p["precedence_variant_id"],)).fetchone()
        vcols = [d[0] for d in db.execute("SELECT * FROM variants LIMIT 0").description]
        v = dict(zip(vcols, var))
        near = db.execute("SELECT archetype,dist_xy,dim_x,dim_y,dim_z,x,y,z FROM nearby_structures WHERE placement_id=? ORDER BY rank", (p["id"],)).fetchall()
        buildings = [n for n in near if max(n[2], n[3]) >= 8 and n[4] >= 4 and n[1] <= 45]
        others = db.execute("SELECT COUNT(*) FROM placements WHERE id!=? AND ABS(x-?)<30 AND ABS(y-?)<30", (p["id"], p["x"], p["y"])).fetchone()[0]
        s = 0.0
        why = []
        flags = {}
        if v["exit_portal_count"] >= 1:
            s += WEIGHTS["exit_portal"]; why.append("exit portal(s) to limbo/exterior: %d (verified portal topology)" % v["exit_portal_count"])
            if v["exit_portal_count"] >= 2:
                s += WEIGHTS["extra_exit_portal"]
        else:
            why.append("no exit portal found (no verified exterior connection)")
        story = any(l in ("base", "update-base", "update-dlc_patch") for l in p["layers"].split(","))
        if story and not p["online_like_assumed"]:
            s += WEIGHTS["story_layer"]; why.append("placed in base/patch layer (offline availability ASSUMED)")
        if p["online_like_assumed"]:
            s += WEIGHTS["online_like"]; why.append("online-style naming/DLC (ASSUMED not story accessible)")
        rc = v["room_count"] - 1  # exclude limbo
        if 2 <= rc <= 10:
            s += WEIGHTS["rooms_2_10"]
        elif rc == 1:
            s += WEIGHTS["rooms_1"]
        elif rc > 20:
            s += WEIGHTS["rooms_gt20"]
        why.append("%d interior rooms" % rc)
        if len(buildings) == 1:
            s += WEIGHTS["single_dominant_building"]; why.append("one large exterior model within 45 m: %s" % buildings[0][0])
        elif 2 <= len(buildings) <= 3:
            s += WEIGHTS["few_buildings"]; why.append("%d large exterior models within 45 m" % len(buildings))
        elif len(buildings) > 3:
            s += WEIGHTS["many_buildings"]; why.append("%d large exterior models within 45 m (cluttered)" % len(buildings))
        else:
            why.append("no large exterior model found within 45 m")
        shell = [n for n in buildings if n[1] <= 3.0]
        if shell:
            s += WEIGHTS["colocated_shell"]; why.append("exterior model %s shares the MLO pivot (<=3 m): strong association (VERIFIED positions, same-building ASSUMED)" % shell[0][0])
        if buildings:
            fp = max(buildings[0][2], buildings[0][3])
            if 6 <= fp <= 30:
                s += WEIGHTS["modest_footprint"]; why.append("nearest large model footprint %.1f m (modest)" % fp)
            elif fp > 60:
                s += WEIGHTS["huge_footprint"]; why.append("nearest large model footprint %.1f m (very large)" % fp)
        if p["placement_conflict"]:
            s += WEIGHTS["conflict"]; why.append("placement variants disagree across layers")
        else:
            s += WEIGHTS["no_conflict"]
        if p["underground_like_assumed"]:
            s += WEIGHTS["underground"]; why.append("name suggests tunnel/underground/garage (ASSUMED)")
        if v["entity_count"] and v["assets_missing"] == 0:
            s += WEIGHTS["assets_complete"]
        elif v["assets_missing"] > 0:
            s += WEIGHTS["asset_gaps"]; why.append("%d interior entity archetypes without a ydr/yft/ydd file by name" % v["assets_missing"])
        if others > 0:
            s += WEIGHTS["crowded_mlo"]
        if json.loads(p["ybn_name_matches"]):
            s += WEIGHTS["ybn_name_match"]
        scored.append((s, p, v, buildings, why))
    scored.sort(key=lambda t: (-t[0], t[1]["interior"], t[1]["id"]))
    out = []
    for s, p, v, b, why in scored:
        if any(o["interior"] == p["interior"] or math.hypot(p["x"] - o["position"][0], p["y"] - o["position"][1]) < separation for o in out):
            continue  # diversity: one candidate per interior archetype and per area
        ex = db.execute("SELECT portal_idx, world_center FROM placement_exit_portals WHERE placement_id=? ORDER BY portal_idx", (p["id"],)).fetchall()
        out.append({
            "rank": len(out) + 1, "placement_id": p["id"], "interior": p["interior"], "score": round(s, 2), "position": [round(p["x"], 3), round(p["y"], 3), round(p["z"], 3)],
            "layers": p["layers"].split(","), "dlcs": [d for d in p["dlcs"].split(",") if d], "ymaps": json.loads(p["ymaps"]), "rooms": v["room_count"] - 1, "exit_portals": v["exit_portal_count"],
            "exit_portal_world_centers": [json.loads(e[1]) for e in ex], "exterior_models_within_45m": [{"archetype": n[0], "dist_xy": n[1], "size_xyz": [n[2], n[3], n[4]], "position": [n[5], n[6], n[7]]} for n in b[:4]],
            "ybn_name_matches_assumed": json.loads(p["ybn_name_matches"]), "reasons": why,
            "verified": ["MLO archetype + rooms/portals from YTYP", "world placement from YMAP", "large model positions from YMAP + bounds from YTYP"],
            "assumptions": ["offline/story availability", "layer load precedence", "exterior model belongs to the same building", "YBN files matched only by name"],
            "next_investigation": "Resolve which YBN children cover the exterior shell around the exit portal(s) (polygon-level), then check wall ownership/LOD/NVE overrides; no destruction work implied.",
        })
        if len(out) >= top:
            break
    return out


# ---------------------------------------------------------------- reports
def coverage(db, archs, insts, ymaps, ents, files, containment, provenance):
    q = lambda s: db.execute(s).fetchone()[0]
    layers = {r[0]: r[1] for r in db.execute("SELECT layer, COUNT(*) FROM variants GROUP BY layer ORDER BY layer")}
    ilayers = {}
    for r in db.execute("SELECT layers, COUNT(*) FROM placements GROUP BY layers ORDER BY layers"):
        ilayers[r[0]] = r[1]
    cov = {
        "schema_version": SCHEMA_VERSION,
        "counts": {
            "interiors_unique": q("SELECT COUNT(*) FROM interiors"), "variants_ytyp_defs": q("SELECT COUNT(*) FROM variants"), "variants_differing_interiors": q("SELECT COUNT(*) FROM interiors WHERE variants_differ=1"),
            "rooms": q("SELECT COUNT(*) FROM rooms"), "portals": q("SELECT COUNT(*) FROM portals"), "exit_portals": q("SELECT COUNT(*) FROM portals WHERE is_exit=1"), "entity_sets": q("SELECT COUNT(*) FROM entity_sets"),
            "interior_entities": q("SELECT COUNT(*) FROM mlo_entities"), "instance_records": len(insts), "placements_unique": q("SELECT COUNT(*) FROM placements"), "placements_with_exit_portal": q("SELECT COUNT(*) FROM placements WHERE exit_portals_verified>0"),
            "placements_conflict": q("SELECT COUNT(*) FROM placements WHERE placement_conflict=1"), "nearby_structure_rows": q("SELECT COUNT(*) FROM nearby_structures"), "ymaps_scanned": len(ymaps),
            "interiors_without_placement": q("SELECT COUNT(*) FROM interiors WHERE placement_count=0"),
        },
        "variants_by_layer": layers, "placements_by_layer_combo": ilayers,
        "name_resolution": {"interiors_resolved": q("SELECT COUNT(*) FROM interiors WHERE name_resolved=1"), "interior_entities_resolved": q("SELECT COUNT(*) FROM mlo_entities WHERE name_resolved=1"), "interior_entities_total": q("SELECT COUNT(*) FROM mlo_entities")},
        "asset_presence_by_name": {"entities_with_model_file": q("SELECT SUM(assets_present) FROM variants"), "entities_without_model_file": q("SELECT SUM(assets_missing) FROM variants")},
        "transform_validation": {"entities_inside_ymap_extents": containment["ok"], "entities_outside_extents": containment["bad"], "entities_checked": containment["total"], "tolerance_m": 3, "convention": "stored YMAP rotation (x,y,z,w) applied as-is"},
        "limitations": [
            "Metadata only: no collision (YBN polygon) ownership, no mesh geometry, no runtime/GTA verification.",
            "Layer precedence (base < update < DLC < NVE) is an ASSUMPTION; variants are all listed, none is proven active.",
            "Story-mode/offline accessibility is a heuristic (layer/DLC/name patterns), not verified; exit portals prove room topology only, not a physical doorway or reachable street.",
            "Exterior structures are large non-prop models near an instance (bounds from YTYP); association with the interior's building is a guess.",
            "Large-model scan keeps only HD-style entities with footprint >= 6 m and height >= 2.5 m and drops names matching vegetation/road/prop patterns; smaller walls are not indexed.",
            "Entity names unresolved by CodeWalker's hash index appear as numeric hashes.",
            "YMAP files whose strings/entities CodeWalker could not parse are logged in the raw run logs and are not in the catalog.",
        ],
    }
    if provenance:
        cov["provenance"] = provenance
    return cov


def summarize(db):
    out = {"schema_version": SCHEMA_VERSION, "interiors": []}
    for h, name, vc, vd, layers in db.execute("SELECT hash,name,variant_count,variants_differ,layers FROM interiors ORDER BY name"):
        pls = []
        for p in db.execute("SELECT id,x,y,z,layers,exit_portals_verified,online_like_assumed FROM placements WHERE interior_hash=? ORDER BY id", (h,)):
            pls.append({"id": p[0], "pos": [round(p[1], 2), round(p[2], 2), round(p[3], 2)], "layers": p[4].split(","), "exit_portals": p[5], "online_like_assumed": bool(p[6])})
        v = db.execute("SELECT room_count,portal_count,exit_portal_count,entity_count FROM variants WHERE interior_hash=? ORDER BY id DESC LIMIT 1", (h,)).fetchone()
        out["interiors"].append({"name": name, "hash": h, "variants": vc, "variants_differ": bool(vd), "layers": layers.split(","), "rooms": v[0], "portals": v[1], "exit_portals": v[2], "entities": v[3], "placements": pls})
    return out


# ---------------------------------------------------------------- validation
def validate(outdir, strict=True):
    errs = []
    dbp = os.path.join(outdir, "catalog.sqlite")
    if not os.path.exists(dbp):
        return ["missing catalog.sqlite"]
    db = sqlite3.connect(dbp)
    try:
        return _validate_db(db, outdir, errs)
    finally:
        db.close()


def _validate_db(db, outdir, errs):
    q = lambda s: db.execute(s).fetchone()[0]
    checks = {
        "variants without interior": "SELECT COUNT(*) FROM variants WHERE interior_hash NOT IN (SELECT hash FROM interiors)",
        "rooms without variant": "SELECT COUNT(*) FROM rooms WHERE variant_id NOT IN (SELECT id FROM variants)",
        "portals without variant": "SELECT COUNT(*) FROM portals WHERE variant_id NOT IN (SELECT id FROM variants)",
        "placements without interior": "SELECT COUNT(*) FROM placements WHERE interior_hash NOT IN (SELECT hash FROM interiors)",
        "placements with bad precedence variant": "SELECT COUNT(*) FROM placements WHERE precedence_variant_id NOT IN (SELECT id FROM variants)",
        "placement rooms orphan": "SELECT COUNT(*) FROM placement_rooms WHERE placement_id NOT IN (SELECT id FROM placements)",
        "portal room index out of range": "SELECT COUNT(*) FROM portals p JOIN variants v ON v.id=p.variant_id WHERE p.room_from>=v.room_count OR p.room_to>=v.room_count",
        "entity room out of range": "SELECT COUNT(*) FROM mlo_entities e JOIN variants v ON v.id=e.variant_id WHERE e.room>=v.room_count",
        "non-finite placement coords": "SELECT COUNT(*) FROM placements WHERE x IS NULL OR y IS NULL OR z IS NULL OR ABS(x)>20000 OR ABS(y)>20000 OR ABS(z)>5000",
        "candidates without placement": "SELECT COUNT(*) FROM candidates WHERE placement_id NOT IN (SELECT id FROM placements)",
        "exit portal count mismatch": "SELECT COUNT(*) FROM variants v WHERE exit_portal_count != (SELECT COUNT(*) FROM portals p WHERE p.variant_id=v.id AND p.is_exit=1)",
    }
    for label, sql in checks.items():
        n = q(sql)
        if n:
            errs.append("%s: %d" % (label, n))
    if q("SELECT COUNT(*) FROM candidates") > 5:
        errs.append("more than 5 candidates")
    cov_path = os.path.join(outdir, "coverage.json")
    if os.path.exists(cov_path):
        with open(cov_path) as fh:
            cov = json.load(fh)
        tv = cov["transform_validation"]
        if tv["entities_checked"] and tv["entities_inside_ymap_extents"] / tv["entities_checked"] < 0.98:
            errs.append("transform validation below 98%%: %s" % tv)
    # no binary/asset payloads
    for f in os.listdir(outdir):
        if f.endswith((".ydr", ".yft", ".ybn", ".ytd", ".rpf", ".dds")):
            errs.append("asset file in catalog dir: " + f)
    return errs


def fingerprint(outdir):
    db = sqlite3.connect(os.path.join(outdir, "catalog.sqlite"))
    h = hashlib.sha256()
    for line in db.iterdump():
        h.update(line.encode())
    db.close()
    return h.hexdigest()


# ---------------------------------------------------------------- search
def search(dbpath, text=None, near=None, radius=100.0, limit=25):
    db = sqlite3.connect(dbpath)
    rows = []
    if text:
        like = "%" + text + "%"
        for r in db.execute("SELECT p.id,p.interior,p.x,p.y,p.z,p.layers,p.exit_portals_verified FROM placements p WHERE p.interior LIKE ? "
                            "OR p.interior_hash IN (SELECT v.interior_hash FROM variants v JOIN rooms r ON r.variant_id=v.id WHERE r.name LIKE ?) "
                            "OR p.interior_hash IN (SELECT v.interior_hash FROM variants v JOIN mlo_entities e ON e.variant_id=v.id WHERE e.archetype LIKE ?) "
                            "OR p.id IN (SELECT placement_id FROM nearby_structures WHERE archetype LIKE ?) ORDER BY p.interior LIMIT ?", (like, like, like, like, limit)):
            rows.append(r)
    if near:
        x, y = near
        for r in db.execute("SELECT id,interior,x,y,z,layers,exit_portals_verified FROM placements WHERE (x-?)*(x-?)+(y-?)*(y-?)<=? ORDER BY (x-?)*(x-?)+(y-?)*(y-?) LIMIT ?", (x, x, y, y, radius * radius, x, x, y, y, limit)):
            rows.append(r)
    db.close()
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--raw", required=True); b.add_argument("--out", required=True); b.add_argument("--provenance")
    v = sub.add_parser("validate"); v.add_argument("--out", required=True)
    s = sub.add_parser("search"); s.add_argument("--db", required=True); s.add_argument("--text"); s.add_argument("--near", nargs=2, type=float); s.add_argument("--radius", type=float, default=100.0)
    f = sub.add_parser("fingerprint"); f.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "build":
        prov = None
        if a.provenance:
            with open(a.provenance, encoding="utf-8-sig") as fh:
                prov = json.load(fh)
        cov = build(a.raw, a.out, prov)
        print(json.dumps(cov["counts"], indent=1))
        errs = validate(a.out)
        if errs:
            print("VALIDATION FAILED:", *errs, sep="\n  ")
            return 1
        print("validation ok")
    elif a.cmd == "validate":
        errs = validate(a.out)
        print("\n".join(errs) if errs else "ok")
        return 1 if errs else 0
    elif a.cmd == "search":
        for r in search(a.db, a.text, a.near, a.radius):
            print(r)
    elif a.cmd == "fingerprint":
        print(fingerprint(a.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
