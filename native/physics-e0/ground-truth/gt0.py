"""GT0: offline-only GTA Enhanced collision provenance and catalog checks.

No RPH, GTA, proprietary files, network or game installation are required.
Coordinates in input/output are PRIVATE: never commit scene/ray/catalog outputs.
"""
from __future__ import annotations

import collections
import hashlib
import json
import math
from pathlib import Path

import jsonschema

FILTER_MATRIX = (
    (17, 7, "baseline_existing_e0"),
    (17, 0, "world_objects_include_transparent"),
    (17, 4, "world_objects_ignore_no_collision"),
    (81, 0, "world_objects_glass_include_all"),
    (81, 4, "world_objects_glass_ignore_no_collision"),
)
ANOMALY_BASELINE = {
    "material_misses": [2, 6],
    "wall_different_entities": [3, 4],
    "wall_thickness_error_m": {"3": 0.09509277515625, "4": 0.25473022703125},
    "inside_solid_hits": 0,
    "inside_solid_total": 10,
    "material_matches": 28,
    "material_samples": 30,
    "walls_within_1cm": 8,
    "wall_samples": 10,
}
SAFE_REASON_CODES = frozenset((
    "UNKNOWN_IDENTITY", "SOURCE_PRECEDENCE", "MISSING_LIVE_EVIDENCE",
    "RAY_MISS", "MATERIAL_MISMATCH", "MULTIPLE_COLLIDERS",
    "THICKNESS_MISMATCH", "MISSING_SCREENSHOT", "INSIDE_SOLID_MISS",
    "UNVERIFIED_MOD", "REJECTED_SOURCE", "OTHER",
))


class GT0Error(ValueError):
    """Explicit input/provenance failure; never silently promote a candidate."""


def load_json(path):
    with Path(path).open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def write_json(path, result):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2, allow_nan=False, sort_keys=True) + "\n",
                      encoding="utf-8")


def vec(v, name="vector"):
    if not isinstance(v, list) or len(v) != 3 or any(
        type(x) not in (int, float) or not math.isfinite(x) for x in v
    ):
        raise GT0Error(f"{name}: expected three finite coordinates")
    return tuple(float(x) for x in v)


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def scale(a, scalar):
    return tuple(x * scalar for x in a)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def unit(a):
    n = math.sqrt(dot(a, a))
    if n <= 1e-10:
        raise GT0Error("zero-length axis/ray")
    return scale(a, 1.0 / n)


def mat(m):
    if not isinstance(m, list) or len(m) != 4 or any(
        not isinstance(row, list) or len(row) != 4 or
        any(type(x) not in (int, float) or not math.isfinite(x) for x in row)
        for row in m
    ):
        raise GT0Error("matrix must be 4x4 finite row-vector affine")
    if any(abs(m[i][3]) > 1e-8 for i in range(3)) or abs(m[3][3] - 1) > 1e-8:
        raise GT0Error("non-affine or transposed matrix; specify row-vector GTA transforms")
    return m


def transform(v, matrices, is_direction=False):
    p = vec(v, "position/direction") if isinstance(v, list) else v
    for raw in matrices:
        m = mat(raw)
        p = tuple(sum(p[i] * m[i][j] for i in range(3)) +
                  (0.0 if is_direction else m[3][j]) for j in range(3))
    return p


def geom_world(item):
    g = item.get("geometry")
    if not isinstance(g, dict):
        raise GT0Error("missing primitive geometry")
    frame = item.get("coordinateFrame")
    if frame not in ("WORLD_STATIC_YBN", "LOCAL_PLACED", "LOCAL_MLO", "EMBEDDED"):
        raise GT0Error("unknown source coordinate frame")
    chain = item.get("transformChain", [])
    if not isinstance(chain, list):
        raise GT0Error("invalid transform chain")
    if frame == "WORLD_STATIC_YBN" and chain:
        raise GT0Error("already world-space static YBN cannot be transformed again")
    if frame != "WORLD_STATIC_YBN" and not chain:
        raise GT0Error("local collider lacks placement transform")
    kind = g.get("kind")
    if kind == "TRIANGLE":
        points = g.get("vertices")
        if not isinstance(points, list) or len(points) != 3:
            raise GT0Error("triangle must have three vertices")
        verts = [transform(vec(x), chain) for x in points]
        if math.sqrt(dot(cross(sub(verts[1], verts[0]),
                               sub(verts[2], verts[0])),
                         cross(sub(verts[1], verts[0]),
                               sub(verts[2], verts[0])))) < 1e-9:
            raise GT0Error("degenerate triangle")
        return {"kind": kind, "vertices": verts}
    if kind == "BOX":
        center = transform(vec(g.get("center"), "box center"), chain)
        half = g.get("halfAxes")
        if not isinstance(half, list) or len(half) != 3:
            raise GT0Error("box needs three half-axis vectors")
        axes = [transform(vec(h, "half axis"), chain, is_direction=True) for h in half]
        lengths = [math.sqrt(dot(a, a)) for a in axes]
        if min(lengths) < 1e-6:
            raise GT0Error("degenerate box")
        normalized = [scale(a, 1 / l) for a, l in zip(axes, lengths)]
        if max(abs(dot(normalized[i], normalized[j]))
               for i, j in ((0, 1), (0, 2), (1, 2))) > 0.005:
            raise GT0Error("skewed or sheared box must be decomposed, not assumed")
        return {"kind": kind, "center": center,
                "axes": normalized, "halfLengths": lengths}
    raise GT0Error(f"unsupported collision primitive kind: {kind}")


def bounds(g):
    if g["kind"] == "TRIANGLE":
        corners = g["vertices"]
    else:
        c, a, lengths = g["center"], g["axes"], g["halfLengths"]
        corners = [
            add(c, add(add(scale(a[0], i * lengths[0]),
                           scale(a[1], j * lengths[1])),
                       scale(a[2], k * lengths[2])))
            for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)
        ]
    return ([min(p[i] for p in corners) for i in range(3)],
            [max(p[i] for p in corners) for i in range(3)])


def slab(a, direction, maxdist, lo, hi):
    entry, leave = 0.0, maxdist
    for i in range(3):
        if abs(direction[i]) <= 1e-12:
            if a[i] < lo[i] - 1e-9 or a[i] > hi[i] + 1e-9:
                return None
            continue
        t1, t2 = (lo[i] - a[i]) / direction[i], (hi[i] - a[i]) / direction[i]
        entry = max(entry, min(t1, t2))
        leave = min(leave, max(t1, t2))
        if entry > leave + 1e-9:
            return None
    return entry, leave


def hit_primitive(a, direction, length, g):
    """Offline geometric intersections; does NOT emulate GTA start-inside semantics."""
    if slab(a, direction, length, *bounds(g)) is None:
        return None
    if g["kind"] == "TRIANGLE":
        p0, p1, p2 = g["vertices"]
        e1, e2 = sub(p1, p0), sub(p2, p0)
        h = cross(direction, e2)
        determinant = dot(e1, h)
        if abs(determinant) <= 1e-9:
            return None
        inv = 1 / determinant
        s = sub(a, p0)
        u = inv * dot(s, h)
        q = cross(s, e1)
        v = inv * dot(direction, q)
        t = inv * dot(e2, q)
        if u < -1e-8 or v < -1e-8 or u + v > 1 + 1e-8 or t < -1e-8 or t > length + 1e-8:
            return None
        normal = unit(cross(e1, e2))
        if dot(normal, direction) > 0:
            normal = scale(normal, -1)
        return {"distanceM": t, "point": add(a, scale(direction, t)),
                "normal": normal, "startsInside": False}
    center, axes, half = g["center"], g["axes"], g["halfLengths"]
    rel = sub(a, center)
    entry, leave = -math.inf, math.inf
    entry_normal, exit_normal = None, None
    inside = True
    for axis, extent in zip(axes, half):
        pos, velocity = dot(rel, axis), dot(direction, axis)
        if abs(pos) >= extent - 1e-8:
            inside = False
        if abs(velocity) < 1e-12:
            if abs(pos) > extent + 1e-8:
                return None
            continue
        near, far = (-extent - pos) / velocity, (extent - pos) / velocity
        nnear, nfar = scale(axis, -1), axis
        if near > far:
            near, far, nnear, nfar = far, near, nfar, nnear
        if near > entry:
            entry, entry_normal = near, nnear
        if far < leave:
            leave, exit_normal = far, nfar
        if entry > leave + 1e-8:
            return None
    t, normal = (leave, exit_normal) if inside else (entry, entry_normal)
    if t < -1e-8 or t > length + 1e-8 or normal is None:
        return None
    return {"distanceM": max(t, 0.0),
            "point": add(a, scale(direction, max(t, 0.0))),
            "normal": normal, "startsInside": inside}


def validate_scene(scene):
    """Validate *candidate* active-world input without claiming runtime completeness."""
    if not isinstance(scene, dict) or scene.get("sceneSchemaVersion") != 1:
        raise GT0Error("unsupported scene schema")
    coverage = scene.get("coverage")
    if not isinstance(coverage, dict) or any(
        type(coverage.get(key)) is not bool for key in
        ("sourceSetComplete", "includesPlaced", "includesEmbedded", "precedenceEstablished")
    ):
        raise GT0Error("explicit coverage booleans required; never assume completeness")
    if not isinstance(scene.get("colliders"), list):
        raise GT0Error("colliders must be an array")
    seen = set()
    for item in scene["colliders"]:
        if not isinstance(item, dict):
            raise GT0Error("invalid collider")
        ident = item.get("colliderId")
        if not isinstance(ident, str) or not ident or ident in seen:
            raise GT0Error("missing or duplicate collider identity")
        seen.add(ident)
        if item.get("activation") not in ("PROVEN_ACTIVE", "POSSIBLY_ACTIVE", "PROVEN_INACTIVE"):
            raise GT0Error("activation must specify evidence confidence")
        src = item.get("source")
        if not isinstance(src, dict) or any(not src.get(k) for k in
                                               ("assetId", "boundPath", "primitiveId", "variantId")):
            raise GT0Error("collider lacks source primitive/version provenance")
        if type(item.get("materialIndex")) is not int or not 0 <= item["materialIndex"] <= 255:
            raise GT0Error("bad material index")
        geom_world(item)
    for prop in scene.get("spawnableCandidates", []):
        if not isinstance(prop, dict) or type(prop.get("modelHash")) is not int or not (
            0 <= prop["modelHash"] <= 0xFFFFFFFF
        ):
            raise GT0Error("spawnable discovery requires numeric model hash")
        if not prop.get("source") or prop.get("status") != "CANDIDATE_ONLY":
            raise GT0Error("spawnables require source and CANDIDATE_ONLY status")


def scene_trace(scene, rays):
    """Report ALL plausible hits; never output a confirmed runtime identity."""
    validate_scene(scene)
    if not isinstance(rays, list) or len(rays) > 1000:
        raise GT0Error("bounded nonempty rays array required")
    coverage = scene["coverage"]
    complete = all(coverage[k] for k in
                   ("sourceSetComplete", "includesPlaced", "includesEmbedded", "precedenceEstablished"))
    responses = []
    for ray in rays:
        ray_id = ray.get("rayId")
        if not isinstance(ray_id, str) or not ray_id:
            raise GT0Error("ray missing identifier")
        a, b = vec(ray.get("start"), "ray start"), vec(ray.get("end"), "ray end")
        diff = sub(b, a)
        length = math.sqrt(dot(diff, diff))
        if not 0.05 <= length <= 100:
            raise GT0Error("ray length outside offline diagnostics bound [0.05, 100]m")
        direction = scale(diff, 1 / length)
        results = []
        for item in scene["colliders"]:
            if item["activation"] == "PROVEN_INACTIVE":
                continue
            h = hit_primitive(a, direction, length, geom_world(item))
            if h is not None:
                results.append({
                    "colliderId": item["colliderId"],
                    "source": item["source"],
                    "activation": item["activation"],
                    "materialIndex": item["materialIndex"],
                    "distanceM": h["distanceM"],
                    "hitPoint": h["point"],
                    "normal": h["normal"],
                    "startsInside": h["startsInside"],
                })
        results.sort(key=lambda x: (x["distanceM"], x["colliderId"]))
        contenders = [x for x in results if results and
                      x["distanceM"] <= results[0]["distanceM"] + 0.02]
        ambiguous = (not complete or len(contenders) != 1 or
                     (results and results[0]["activation"] != "PROVEN_ACTIVE"))
        if not results:
            outcome = "NO_CANDIDATE_HIT"
        elif ambiguous:
            outcome = "AMBIGUOUS_OFFLINE"
        else:
            outcome = "UNIQUE_OFFLINE_CANDIDATE_NOT_LIVE_CONFIRMED"
        responses.append({
            "rayId": ray_id,
            "outcome": outcome,
            "sourceSetComplete": complete,
            "coverage": coverage,
            "nearFirstHitColliderIds": [x["colliderId"] for x in contenders],
            "hits": results,  # Private geometric data, never public.
            "caveat": "Offline candidates only. No native GTA material, active asset or hit identity verified.",
        })
    return {"gt0SchemaVersion": 1, "visibility": "PRIVATE_LOCAL_ONLY", "results": responses}


def plan_filter_tests(catalog):
    """Preserve original geometry and E0 baseline. Produce future GTA run plan only."""
    if catalog.get("visibility") != "PRIVATE_LOCAL_ONLY":
        raise GT0Error("private catalog required")
    plan = []
    for record in catalog.get("records", []):
        if not isinstance(record, dict) or "sampleId" not in record:
            raise GT0Error("bad source record")
        for ray in record.get("rays", []):
            if ray.get("purpose") != "PRIMARY":
                continue
            start, end = vec(ray.get("start")), vec(ray.get("end"))
            for flags, options, purpose in FILTER_MATRIX:
                plan.append({
                    "sampleId": record["sampleId"], "sourceRayId": ray["rayId"],
                    "experimentId": f"{record['sampleId']}/{ray['rayId']}/{flags}-{options}",
                    "start": start, "end": end, "traceFlags": flags,
                    "optionFlags": options, "variant": purpose,
                    "baselineImmutable": True, "executionStatus": "NOT_RUN",
                })
    return {"gt0SchemaVersion": 1, "visibility": "PRIVATE_LOCAL_ONLY",
            "policy": "Never overwrite E0.2/E0.3 primary observations or auto-accept new hits",
            "plan": plan, "baseline": ANOMALY_BASELINE}


def discover_spawnable_candidates(scene, max_results=1000):
    """Optional catalog input (Durty/CodeWalker/manual), never a live GTA proof."""
    validate_scene(scene)
    if not 1 <= max_results <= 1000:
        raise GT0Error("bounded discovery output required")
    seen, out = set(), []
    for prop in scene.get("spawnableCandidates", []):
        if prop["modelHash"] in seen:
            continue
        seen.add(prop["modelHash"])
        out.append({"modelHash": prop["modelHash"], "source": prop["source"],
                    "category": prop.get("category", "OTHER"),
                    "collisionResourceId": prop.get("collisionResourceId"),
                    "status": "CANDIDATE_ONLY",
                    "needs": ["RUNTIME_MODEL_EXISTENCE", "SPAWN_OWNERSHIP",
                              "NATIVE_RAY_MATERIAL", "LIVE_IDENTITY", "CLEANUP"]})
        if len(out) >= max_results:
            break
    return {"gt0SchemaVersion": 1, "visibility": "PRIVATE_LOCAL_ONLY",
            "candidates": out, "note": "Model name/hash or catalog presence is not collision proof."}


def validate_catalog(catalog, schema):
    """Validate JSON Schema AND conservative GT0 domain-specific identity gates."""
    errors = []
    validator = jsonschema.Draft202012Validator(schema,
                  format_checker=jsonschema.FormatChecker())
    for err in sorted(validator.iter_errors(catalog), key=lambda e: str(e.json_path)):
        errors.append(f"{err.json_path}: {err.message}")
    if errors:
        return errors
    ids, observations = set(), set()
    for i, r in enumerate(catalog["records"]):
        key = r["sampleId"]
        if (key, r["revision"]) in ids:
            errors.append(f"record {i}: duplicate ID/revision")
        ids.add((key, r["revision"]))
        rays = {ray["rayId"]: ray for ray in r["rays"]}
        if len(rays) != len(r["rays"]):
            errors.append(f"record {i}: duplicate ray IDs")
        for ray in r["rays"]:
            if not 0.05 <= math.dist(ray["start"], ray["end"]) <= 100:
                errors.append(f"record {i}: bad ray span")
        for obs in r["observations"]:
            obs_id = obs["observationId"]
            if obs_id in observations:
                errors.append(f"record {i}: duplicate observation ID {obs_id}")
            observations.add(obs_id)
            if obs["rayId"] not in rays:
                errors.append(f"record {i}: observation references missing ray")
            if (obs["hit"] and obs["shapeTestState"] != 2) or (
                not obs["hit"] and obs["result"] == "MATCH"
            ):
                errors.append(f"record {i}: impossible shape verdict")
            if obs["hit"] and obs["hitPoint"] is None:
                errors.append(f"record {i}: positive hit with no point")
        if r["verification"]["status"] != "CONFIRMED":
            continue
        prefix = f"record {i} ({key}):"
        def need(condition, reason):
            if not condition:
                errors.append(f"{prefix} {reason}")
        v, ev, identity, source = (r["verification"], r["evidence"],
                                  r["identity"], r["source"])
        success = [o for o in r["observations"] if
                   o["result"] == "MATCH" and o["hit"] and
                   o["shapeTestState"] == 2 and o["destinationCollisionReady"]]
        need(len(success) >= 3, "requires 3 completed matching live observations")
        need(len({o["sessionId"] for o in success}) >= 2, "requires two independent sessions")
        need(len(ev["negativeControlObservationIds"]) > 0, "negative control is missing")
        need(identity["uniqueOfflineHitCandidate"] is True and
             identity["activeSourceIndependentlyVerified"] is True and
             source["liveWinnerStatus"] == "INDEPENDENTLY_ESTABLISHED",
             "unique source and active predecessor must be independently verified")
        need(r["environment"]["archiveWinningEvidenceId"] is not None,
             "actual archive selection evidence absent")
        need(bool(r["environment"]["modFingerprintId"]), "mod fingerprint absent")
        views = {x["view"] for x in ev["screenshots"] if x["overlayReadable"]}
        need({"CONTEXT", "CLOSE_UP"} <= views, "requires readable context and close-up screenshots")
        need(all(o["hitPositionErrorM"] is not None and
                 o["hitPositionErrorM"] <= .02 and
                 (o["normalErrorDeg"] is None or o["normalErrorDeg"] <= 10)
                 for o in success), "hit position/normal deviation exceeds preregistered gate")
        native_hash = r["material"]["expectedNativeHash"]
        need(native_hash is not None and all(o["materialHash"] == native_hash for o in success),
             "material hash unverified or mismatched")
        if v["thicknessQualified"]:
            need(r["expected"]["thicknessM"] is not None, "no source thickness reference")
            need(all(o["thicknessErrorM"] is not None and
                     abs(o["thicknessErrorM"]) <= .01 for o in success),
                 "thickness uncertainty exceeds 1cm")
            need(all(o["opposingEntityHandle"] == o["entityHandle"] and
                     o["entityHandle"] is not None and o["entityHandle"] != 0 for o in success),
                 "external pair did not resolve to the same nonzero entity handle")
            # Equal handles are necessary in this basic test but NEVER sufficient for
            # single-primitive identity: independent source gate above still applies.
    return errors


def public_export(catalog):
    """Deny-by-default public aggregate only; discard arbitrary private strings."""
    if catalog.get("visibility") != "PRIVATE_LOCAL_ONLY":
        raise GT0Error("refusing to export catalog without private designation")
    counts = collections.Counter(r["verification"]["status"] for r in catalog["records"])
    return {
        "reportType": "E0_GT0_SANITIZED_COUNTS_ONLY",
        "schemaVersion": 1,
        "total": len(catalog["records"]),
        "statusCounts": {s: counts[s] for s in ("CONFIRMED", "AMBIGUOUS", "REJECTED")},
        "baseline": ANOMALY_BASELINE,
        "privacy": "No asset names, hashes, XYZ, screenshots, freeform notes or sample IDs exported",
    }
