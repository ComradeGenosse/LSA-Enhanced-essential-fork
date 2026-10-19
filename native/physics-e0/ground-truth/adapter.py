"""Import the EXISTING private CodeWalker candidate format without inventing mesh data.

The analyzer currently exports centers, normals, boxes and source paths but
NOT triangle vertices. Only reconstructable boxes are accepted as ray-castable
geometry; triangles and unextracted embedded/placed collision are omissions,
not fabricated faces. Never upload derived scene outputs to public Git.
"""
from __future__ import annotations

import hashlib

from gt0 import GT0Error, vec, write_json


def adapt_codewalker_candidates(private_candidates):
    if private_candidates.get("schemaVersion") != 1:
        raise GT0Error("unknown CodeWalker candidate schema")
    pool = private_candidates.get("candidatePool", {})
    surfaces = pool.get("surfaces", private_candidates.get("surfaces", []))
    walls = pool.get("walls", private_candidates.get("walls", []))
    if not isinstance(surfaces, list) or not isinstance(walls, list):
        raise GT0Error("invalid private candidate arrays")
    seen, colliders, unmodeled = set(), [], []
    for sample in surfaces + walls:
        path, bound, polygon = (sample.get("asset"), sample.get("bound"),
                                sample.get("polygonIndex"))
        if not isinstance(path, str) or not isinstance(bound, str) or type(polygon) is not int:
            raise GT0Error("candidate has no source asset/bound/primitive index")
        key = (path, bound, polygon)
        if key in seen:
            continue
        seen.add(key)
        if sample.get("primitive") != "Box" or not all(
            key in sample for key in ("center", "axes", "dimensionsM")
        ):
            unmodeled.append({"sourceId": hashlib.sha256(repr(key).encode()).hexdigest()[:16],
                              "reasonCode": "PRIMITIVE_VERTICES_NOT_EXPORTED"})
            continue
        axes = [vec(a, "CodeWalker box axis") for a in sample["axes"]]
        dims = sample["dimensionsM"]
        if len(axes) != 3 or not isinstance(dims, list) or len(dims) != 3:
            raise GT0Error("box axes/dimensions invalid")
        if any(type(d) not in (int, float) or not 0 < d < 100 for d in dims):
            raise GT0Error("box dimensions invalid")
        collider_id = hashlib.sha256(repr(key).encode()).hexdigest()[:20]
        colliders.append({
            "colliderId": collider_id,
            "coordinateFrame": "WORLD_STATIC_YBN",
            "transformChain": [],
            "source": {
                "assetId": path,
                "boundPath": bound,
                "primitiveId": f"polygonIndex:{polygon}",
                "variantId": path,
                "sourceKeySha256": hashlib.sha256(repr(key).encode()).hexdigest(),
            },
            "activation": "POSSIBLY_ACTIVE",
            "materialIndex": sample["materialIndex"],
            "geometry": {
                "kind": "BOX",
                "center": list(vec(sample["center"])),
                "halfAxes": [[axis[i] * dims[j] / 2 for i in range(3)]
                             for j, axis in enumerate(axes)],
            },
        })
    return {
        "sceneSchemaVersion": 1,
        "visibility": "PRIVATE_LOCAL_ONLY",
        "sourceFormat": "CODEWALKER_CANDIDATE_POOL_BOUNDED_WORLD_YBN",
        "coverage": {
            "sourceSetComplete": False,
            "includesPlaced": False,
            "includesEmbedded": False,
            "precedenceEstablished": False,
            "notes": [
                "Only candidate-pool box primitives are reconstructable from this input.",
                "Triangles have center/normal/area but no source vertices; omitted.",
                "YMAP/YTYP/embedded collision and active mod precedence not resolved.",
                "No candidate is PROVEN_ACTIVE without independent runtime/source evidence.",
            ],
        },
        "colliders": colliders,
        "unmodeledSources": unmodeled,
        "spawnableCandidates": [],
    }
