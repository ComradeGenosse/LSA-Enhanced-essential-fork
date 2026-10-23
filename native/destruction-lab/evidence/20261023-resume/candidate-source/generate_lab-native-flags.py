#!/usr/bin/env python3
"""Deterministic CodeWalker CMapData/YMAP source for a two-fence X8 lab.

Creates *map entity* definitions, never script-spawned props. No GTA calls.
Local site qualification and CodeWalker binary conversion are separate gates.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

MAP_NAME = "lsa_destruction_lab"
MODEL = "prop_fnccorgm_02e"
MODEL_HASH = 1185366416
# Two deliberately isolated lanes. Do not place additional scenery in the lanes.
LANES = (("A", -15.0, 0.0, 0.0), ("B", 15.0, 0.0, 90.0))
ENTITY_RADIUS = 3.0
STREAM_MARGIN = 110.0


def finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("%s must be numeric" % name)
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("%s must be finite" % name)
    return number


def fmt(value):
    """Stable human-readable decimals; avoid -0 and locale dependence."""
    if abs(value) < 0.0000005:
        value = 0.0
    return "%.6f" % value


def create_plan(site, fixture=False):
    """Site input is a proposed origin, NOT proof of collision/ground suitability."""
    if not isinstance(site, dict):
        raise ValueError("Site must be a JSON object")
    for key in ("x", "y", "z", "heading"):
        if key not in site:
            raise ValueError("Missing site.%s" % key)
    x, y, z, heading = (finite_number(site[k], k) for k in ("x", "y", "z", "heading"))
    if not (-10000 < x < 10000 and -10000 < y < 10000 and -100 < z < 1600):
        raise ValueError("Site outside conservative GTA world limits")
    if not (0 <= heading < 360):
        raise ValueError("Heading must be [0, 360)")
    if not fixture:
        # This is a declaration by the local operator, never a substitute for
        # verifying every placed object's basis, terrain and collision in GTA.
        if site.get("surveyed") is not True or not isinstance(site.get("evidence"), str):
            raise ValueError("A proposed real site requires surveyed=true and an evidence ID")
        if not re.fullmatch(r"[A-Za-z0-9_.:/-]{5,128}", site["evidence"]):
            raise ValueError("Evidence ID is missing or unsafe")
    theta = math.radians(heading)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    placements = []
    for ident, dx, dy, offset in LANES:
        px = x + dx * cos_t - dy * sin_t
        py = y + dx * sin_t + dy * cos_t
        yaw = (heading + offset) % 360.0
        # CodeWalker's map entity quaternion is inverted relative to an
        # ordinary heading quaternion (matches exported .ymap.xml examples).
        half = math.radians(yaw) / 2.0
        quat = [0.0, 0.0, -math.sin(half), math.cos(half)]
        placements.append(dict(id=ident, model=MODEL, hash=MODEL_HASH,
                               x=round(px, 6), y=round(py, 6), z=round(z, 6),
                               heading=round(yaw, 6), quaternion=quat))
    separation = math.dist((placements[0]["x"], placements[0]["y"]),
                           (placements[1]["x"], placements[1]["y"]))
    if separation < 20.0:
        raise ValueError("Lab lanes overlap")
    return dict(schema=1, name=MAP_NAME,
                classification="OFFLINE_FIXTURE_NOT_DEPLOYABLE" if fixture else "PROPOSED_UNVERIFIED_IN_GTA",
                evidence="synthetic-test-only" if fixture else site["evidence"],
                requirements=["CodeWalker binary conversion and reload", "GTA streaming identity at both sites",
                              "source 9/9 and dormant twin 0/9", "18 clear approach rays each",
                              "walkable ground and no overlap with ambient collision",
                              "verify quaternion/native heading and valid shooter origins",
                              "hash-verified stopped-game installation and restoration"],
                placements=placements)


def child(parent, tag, attrs=None, value=None):
    node = ET.SubElement(parent, tag, attrs or {})
    if value is not None:
        node.text = str(value)
    return node


def render_xml(plan):
    positions = plan["placements"]
    root = ET.Element("CMapData")
    child(root, "name", value=MAP_NAME)
    child(root, "parent")
    child(root, "flags", {"value": "0"})  # unscripted, automatically streamed
    child(root, "contentFlags", {"value": "1"})
    for kind, radius in (("entities", ENTITY_RADIUS), ("streaming", ENTITY_RADIUS + STREAM_MARGIN)):
        for suffix, f in (("Min", min), ("Max", max)):
            attrs = {}
            for key in ("x", "y", "z"):
                vals = [p[key] for p in positions]
                bound = f(vals) + (-radius if suffix == "Min" else radius)
                attrs[key] = fmt(bound)
            child(root, kind + "Extents" + suffix, attrs)
    entities = child(root, "entities")
    for p in positions:
        ent = child(entities, "Item", {"type": "CEntityDef"})
        child(ent, "archetypeName", value=MODEL)
        child(ent, "flags", {"value": "1572864"})  # vanilla destructible placement; not Static Entity
        child(ent, "guid", {"value": "0"})
        child(ent, "position", {k: fmt(p[k]) for k in ("x", "y", "z")})
        child(ent, "rotation", dict(zip(("x", "y", "z", "w"), (fmt(v) for v in p["quaternion"]))))
        for tag, val in (("scaleXY", 1), ("scaleZ", 1), ("parentIndex", -1),
                         ("lodDist", 100), ("childLodDist", 0)):
            child(ent, tag, {"value": str(val)})
        child(ent, "lodLevel", value="LODTYPES_DEPTH_ORPHANHD")
        child(ent, "numChildren", {"value": "0"})
        child(ent, "priorityLevel", value="PRI_REQUIRED")
        child(ent, "extensions")
        for tag, value in (("ambientOcclusionMultiplier", 255), ("artificialAmbientOcclusion", 255),
                           ("tintValue", 0)):
            child(ent, tag, {"value": str(value)})
    for tag, attrs in (("containerLods", {"itemType": "rage__fwContainerLodDef"}),
                       ("boxOccluders", {"itemType": "BoxOccluder"}),
                       ("occludeModels", {"itemType": "OccludeModel"}),
                       ("physicsDictionaries", {})):
        child(root, tag, attrs)
    inst = child(root, "instancedData")
    child(inst, "ImapLink")
    child(inst, "PropInstanceList", {"itemType": "rage__fwPropInstanceListDef"})
    child(inst, "GrassInstanceList", {"itemType": "rage__fwGrassInstanceListDef"})
    child(root, "timeCycleModifiers", {"itemType": "CTimeCycleModifier"})
    child(root, "carGenerators", {"itemType": "CCarGenerator"})
    light = child(root, "LODLightsSOA")
    for tag in ("direction", "falloff", "falloffExponent", "timeAndStateFlags", "hash",
                "coneInnerAngle", "coneOuterAngleOrCapExt", "coronaIntensity"):
        child(light, tag, {"itemType": "FloatXYZ"} if tag == "direction" else {})
    distant = child(root, "DistantLODLightsSOA")
    child(distant, "position", {"itemType": "FloatXYZ"})
    child(distant, "RGBI")
    child(distant, "numStreetLights", {"value": "0"})
    child(distant, "category", {"value": "0"})
    block = child(root, "block")
    child(block, "version", {"value": "0"})
    child(block, "flags", {"value": "0"})
    child(block, "name", value=MAP_NAME)
    child(block, "exportedBy", value="LSA Destruction Lab deterministic generator")
    child(block, "owner")
    child(block, "time")  # intentionally fixed for byte-identical rebuilds
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


def registration_text(plan):
    lines = [
        "# NOT A SCRIPT. Operator must first install/stream map and verify both native sources.",
        "# Audit native pivots/headings before using verified=1; do not blindly replay commands.",
        "x8enable enable=1 approved=1",
    ]
    for p in plan["placements"]:
        lines.append("x8register id={id} rev=1 hash={hash} tx={x} ty={y} tz={z} heading={heading} scale=1 updot=1 verified=1".format(**p))
    lines += ["x8status", "x8audit id=A", "x8audit id=B",
              "# Qualify ground and shooter positions separately; only then x8prepare / x8shot.",
              "# One X8 native lease at a time. Do not test B until A is fully restored 9/9."]
    return "\n".join(lines) + "\n"


def emit(plan, output_dir):
    dest = Path(output_dir)
    dest.mkdir(parents=True, exist_ok=True)
    xml = render_xml(plan)
    parsed = ET.fromstring(xml)
    assert len(parsed.find("entities")) == 2
    meta = dict(plan)
    meta["sourceSha256"] = hashlib.sha256(xml.encode("utf-8")).hexdigest()
    outputs = {
        MAP_NAME + ".ymap.xml": xml,
        "placements.json": json.dumps(meta, sort_keys=True, indent=2) + "\n",
        "p2-operator-commands.txt": registration_text(plan),
    }
    if "FIXTURE" in plan["classification"]:
        outputs["NOT_DEPLOYABLE.txt"] = "Synthetic offline fixture. Never install these coordinates in GTA.\n"
    for name, data in outputs.items():
        # Preserve exact LF bytes on Windows too: SHA receipts must match.
        (dest / name).write_bytes(data.encode("utf-8"))
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--site", type=Path, help="local operator survey JSON; NOT independently game-verified")
    mode.add_argument("--fixture", action="store_true", help="synthetic offline fixture, never deploy")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.fixture:
        site = {"x": 100, "y": 200, "z": 50, "heading": 0}
    else:
        site = json.loads(args.site.read_text(encoding="utf-8"))
    plan = create_plan(site, fixture=args.fixture)
    emit(plan, args.output)
    print("%s: %s; 2 map fence placements" % (MAP_NAME, plan["classification"]))


if __name__ == "__main__":
    main()
