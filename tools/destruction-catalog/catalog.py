"""Offline X8 contract experiment. Reads custom X7 assets; never imports GTA/Blender.

This deliberately supports only the proven upright, five-section fence family.
It is a compiler example, not a runtime loader or a general fracture framework.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ID = re.compile(r"[a-z][a-z0-9_.-]{0,79}\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fields(value, keys, label):
    require(isinstance(value, dict) and set(value) == set(keys.split()),
            f"{label}: expected fields {keys}")


def number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def vector(value, label):
    require(isinstance(value, list) and len(value) == 3 and all(map(number, value)),
            f"{label}: expected three finite numbers")
    return value


def identifier(value, label):
    require(isinstance(value, str) and ID.fullmatch(value), f"{label}: invalid ID")


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"duplicate JSON field: {key}")
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), object_pairs_hook=unique)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def transform(origin, basis, local):
    return [origin[i] + sum(basis[j][i]*local[j] for j in range(3)) for i in range(3)]


def basis_for(placement):
    fields(placement["basis"], "u t v", "basis")
    b = [vector(placement["basis"][k], k) for k in ("u", "t", "v")]
    for i in range(3):
        for j in range(3):
            require(abs(dot(b[i], b[j]) - int(i == j)) < 1e-6,
                    "basis must be orthonormal; scaling/shear unsupported")
    cross = [b[0][1]*b[1][2]-b[0][2]*b[1][1],
             b[0][2]*b[1][0]-b[0][0]*b[1][2],
             b[0][0]*b[1][1]-b[0][1]*b[1][0]]
    require(dot(cross, b[2]) > .999999, "mirrored basis unsupported")
    require(abs(b[2][0])+abs(b[2][1])+abs(b[2][2]-1) < 1e-6,
            "only upright placements supported")
    return b


def compile_catalog(definition, placements, repo=REPO):
    fields(definition, "schema id revision source_model layout section_models", "definition")
    require(type(definition["schema"]) is int and definition["schema"] == 1, "unknown schema")
    identifier(definition["id"], "definition ID")
    identifier(definition["source_model"], "source model")
    require(definition["source_model"] == "prop_fnccorgm_02e", "only the proven source model is supported")
    require(type(definition["revision"]) is int and definition["revision"] > 0, "invalid revision")
    require(definition["layout"] == "x7_sec1", "only x7_sec1 is supported")
    models = definition["section_models"]
    require(isinstance(models, list) and len(models) == 5, "five physical section positions required")
    for model in models:
        identifier(model, "section model")

    # Reuse the authored manifest and XML, rather than making up new dimensions.
    assets = Path(repo)/"native/fragment-x7/assets-x7d"
    manifest_path = assets/"models.json"
    manifest = read_json(manifest_path)
    require(manifest["layout"] == "sec1" and manifest["groups"] == 2, "asset layout drift")
    width = manifest["bounds_m"][0]
    height = manifest["sheet_height_m"]
    require(number(width) and number(height) and width > 0 and height > 0, "invalid asset dimensions")
    entries = {row["name"]: row for row in manifest["models"]}
    hashes = {str(manifest_path.relative_to(repo)).replace("\\", "/"): digest(manifest_path)}
    ytyp_path = assets/"lsa_x7d.ytyp.xml"
    archetypes = {n.findtext("name"): n for n in ET.parse(ytyp_path).findall("./archetypes/Item")}
    hashes[str(ytyp_path.relative_to(repo)).replace("\\", "/")] = digest(ytyp_path)
    for index, model in enumerate(models):
        require(model in manifest["allowlist"] and model in entries, "model outside asset allowlist")
        row = entries[model]
        require(row["strength"] == row["health"] == 1400, "only the observed j1400 recipe is supported")
        require(row["layout"] == "sec1" and row["post"] == (index == 0),
                "post must occupy physical position 0 only")
        require(model in archetypes and archetypes[model].findtext("assetType") == "ASSET_TYPE_FRAGMENT",
                "missing fragment archetype")
        require(archetypes[model].findtext("assetName") == model, "archetype asset name mismatch")
        path = assets/(model+".yft.xml")
        root = ET.parse(path).getroot()
        require(root.findtext("Name") == "pack:/"+model, "XML model name mismatch")
        groups = root.findall("./Physics/LOD1/Groups/Item")
        bones = root.findall("./Drawable/Skeleton/Bones/Item")
        require(len(groups) == len(bones) == 2 and groups[0].findtext("Name") == "root",
                "expected root plus one sheet child")
        for key in ("Strength", "MinDamageForce", "DamageHealth"):
            require(float(groups[0].find(key).get("value")) == 1e7, "root strength drift")
        for key, prop in (("Strength", "strength"), ("MinDamageForce", "min_damage_force"),
                          ("DamageHealth", "health")):
            require(float(groups[1].find(key).get("value")) == row[prop], "child tuning drift")
        lo, hi = root.find("./Drawable/BoundingBoxMin"), root.find("./Drawable/BoundingBoxMax")
        require(abs(float(hi.get("x"))-float(lo.get("x"))-width) < .001, "section width drift")
        require(abs(float(hi.get("x"))+float(lo.get("x"))) < .001
                and abs(float(lo.get("z"))) < .001
                and abs(float(hi.get("z"))-(2.351 if index == 0 else 2.22)) < .001,
                "section origin/height drift")
        hashes[str(path.relative_to(repo)).replace("\\", "/")] = digest(path)

    require(isinstance(placements, list) and placements, "placements must be a nonempty list")
    seen, compiled = set(), []
    for p in placements:
        fields(p, "instance_id definition_id source_origin_world twin_origin_world basis", "placement")
        identifier(p["instance_id"], "instance ID")
        require(p["instance_id"] not in seen, "duplicate instance ID")
        seen.add(p["instance_id"])
        require(p["definition_id"] == definition["id"], "definition mismatch")
        source = vector(p["source_origin_world"], "source origin")
        origin = vector(p["twin_origin_world"], "twin origin")
        b = basis_for(p)
        # Conservative catalog conflict check; native sphere semantics still need local witnesses.
        require(all(math.dist(source, prior["source_origin_world"]) > .30 for prior in compiled),
                "potential overlapping model-hide scopes")
        sections = [{"physical_index": i, "model": model,
                     "origin_world": transform(origin, b, [(i-2)*width, 0, 0])}
                    for i, model in enumerate(models)]
        rays = [{"from": transform(origin, b, [u, -.8, z]),
                 "to": transform(origin, b, [u, .8, z])}
                for u in (-.7, 0, .7) for z in (.4, 1, 1.6)]
        compiled.append({"instance_id": p["instance_id"], "definition_id": definition["id"],
                         "definition_revision": definition["revision"],
                         "source_model": definition["source_model"], "source_origin_world": source,
                         "twin_origin_world": origin, "basis": p["basis"],
                         "sections": sections, "original_witness_rays": rays})
    return {"schema": 1, "status": "OFFLINE_CONTRACT_ONLY_NOT_RUNTIME_INPUT",
            "layout": {"width_m": width*5, "sheet_height_m": height, "section_width_m": width},
            "definition": definition, "asset_input_sha256": dict(sorted(hashes.items())),
            "instances": sorted(compiled, key=lambda p: p["instance_id"])}


def render(value):
    return json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+"\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--definition", type=Path, default=HERE/"fence.definition.json")
    ap.add_argument("--placements", type=Path, default=HERE/"synthetic.placements.json")
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()
    try:
        result = render(compile_catalog(read_json(args.definition), read_json(args.placements)))
    except (ValueError, KeyError, OSError, ET.ParseError, TypeError, AttributeError) as exc:
        ap.exit(2, f"catalog rejected: {exc}\n")
    if args.output:
        args.output.write_text(result, encoding="utf-8", newline="\n")
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
