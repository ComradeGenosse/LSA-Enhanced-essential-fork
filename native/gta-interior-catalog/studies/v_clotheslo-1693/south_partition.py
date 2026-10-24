"""X9 south glazed façade: fail-closed, BASE hipster in-memory partition replay.

Uses reviewed #322 evidence as the *exact* owner/primitive authorization boundary.
No game-asset writer, clone/rebind, loader changes, or runtime deployment.
Do not mistake archived BASE-profile selection for an observed active GTA profile.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

import numpy as np

from cut_verifier import area, digest, identity, partition, verify, verify_partition
from scipy.spatial import ConvexHull

HERE = Path(__file__).resolve().parent
PROFILE = "base-hipster"
LOW = np.array([6.95, -5.25, 0.26], dtype=float)
HIGH = np.array([7.65, -3.75, 2.56], dtype=float)
EXPECTED_SOURCE_COUNT = 497680

# Git blob SHA pins the complete reviewed #322 intersection inventory, including
# source paths and primitive IDs. Re-review evidence before accepting additions.
REVIEWED_ALTERNATIVE_BLOB = "ae9153a0f1d55765538dc8e9f742c54a786006d7"
REVIEWED_RAW_SHA256 = "6825722e87abf39489f04ec8e8a48726f00fc085e30445a1c6d16b4d4ecc05cb"
REVIEWED_SET_SHA256 = "5b224827985e633f6b83f2efec974cc38153900e8937d9826809ef97e346b594"

# Expected *groups*, not names-only authorization. The pinned evidence supplies
# the immutable full path/entity/model/geometry/child/material and exact IDs.
# 5 window sub-geometries + reflection + 2 decoration + 1 near LOD +
# 2 coarse LOD + 2 collision boxes = 13 approved groups.
APPROVED_OWNERS = {
    "v_51_windows03": ("x64h.rpf\\levels\\gta5\\interiors\\v_int_51.rpf\\v_51_windows03.ydr", 5),
    "v_51_reflectproxy": ("x64h.rpf\\levels\\gta5\\interiors\\v_int_51.rpf\\v_51_reflectproxy.ydr", 1),
    "cs2_01_shop_dec2": ("x64r.rpf\\levels\\gta5\\_hills\\country_02\\cs2_01.rpf\\cs2_01_shop_dec2.ydr", 2),
    "1814693341": ("x64r.rpf\\levels\\gta5\\_hills\\country_02\\country_02.rpf\\cs2_01_clotheslow_slod_children.ydd", 1),
    "cs2_01_clotheslow_slod": ("x64r.rpf\\levels\\gta5\\_hills\\country_02\\country_02.rpf\\cs2_lod_123_slod2_children.ydd", 2),
    "v_clotheslo": ("x64h.rpf\\levels\\gta5\\interiors\\v_int_51.rpf\\v_clotheslo.ybn", 1),
    "cs2_01_5": ("x64r.rpf\\levels\\gta5\\_hills\\country_02\\cs2_01.rpf\\cs2_01_5.ybn", 1),
}
PROTECTED_WEED = "prop_weeddead_nxg02"


def git_blob_sha(data):
    return hashlib.sha1(("blob %d" % len(data)).encode() + bytes([0]) + data).hexdigest()


def load_reviewed():
    path = HERE / "alternative-evidence.json"
    data = path.read_bytes()
    if git_blob_sha(data) != REVIEWED_ALTERNATIVE_BLOB:
        raise ValueError("south evidence changed: new source/owner review required")
    evidence = json.loads(data)
    if (evidence["rawSha256"] != REVIEWED_RAW_SHA256 or
            evidence["entitySetRawSha256"] != REVIEWED_SET_SHA256):
        raise ValueError("south source digests do not match #322")
    if (not np.allclose(evidence["regions"]["opening"]["low"], LOW, rtol=0, atol=1e-10) or
            not np.allclose(evidence["regions"]["opening"]["high"], HIGH, rtol=0, atol=1e-10)):
        raise ValueError("opening prism differs from #322")
    if evidence["nveClearanceCertified"] is not False:
        raise ValueError("NVE status changed: separate actual-transform review required")
    return evidence


def reviewed_permissions(evidence, profile):
    if profile != PROFILE:
        raise ValueError("unsupported profile; only pinned base-hipster is eligible")
    region = evidence["regions"]["opening"]
    if region["unsupportedBroadphase"] or region["entitySetUnsupportedBroadphase"]:
        raise ValueError("unaccounted collision type intersects the opening")
    sets = {r["set"] for r in evidence["entitySetCoverage"]}
    if not {"clotheslowcheap", "clotheslowhipster"} <= sets:
        raise ValueError("incomplete optional-set evidence")
    # Cheap has posters *in the aperture*, so do not silently enable it.
    posters = region["entitySetIntersections"]
    if not posters or any(r["name"] != "v_51_posters" or r["set"] != "clotheslowcheap"
                          for r in posters):
        raise ValueError("unexpected optional-set intersection; profile must be revisited")
    for label in ("landing", "turnToShop"):
        r = evidence["regions"][label]
        fields = ("surfaceIntersections", "centerInsideBoxes", "unsupportedBroadphase",
                  "entitySetIntersections", "entitySetContainingBoxes",
                  "entitySetUnsupportedBroadphase")
        if any(r[field] for field in fields):
            raise ValueError("clearance regression in " + label)

    allowed, protected = set(), set()
    approved_counts = {name: 0 for name in APPROVED_OWNERS}
    protected_groups = 0
    for group in region["surfaceIntersections"]:
        name = group["name"]
        if name in APPROVED_OWNERS:
            expected_file, _ = APPROVED_OWNERS[name]
            if group["file"] != expected_file:
                raise ValueError("wrong layer/asset for " + name)
            if name in ("v_clotheslo", "cs2_01_5"):
                if (group.get("child") != "root/0" or group.get("primitive") != "Box"
                        or group["ids"] != ([98] if name == "v_clotheslo" else [209])):
                    raise ValueError("collision primitive mismatch for " + name)
            elif group["kind"] != "mesh":
                raise ValueError("unexpected non-mesh visual owner: " + name)
            approved_counts[name] += 1
            target = allowed
        elif name == PROTECTED_WEED:
            if (group["file"] != "x64f.rpf\\levels\\gta5\\props\\vegetation\\v_bush.rpf\\prop_weeddead_nxg02.ydr"
                    or group["kind"] != "mesh"):
                raise ValueError("unexpected vegetation source")
            protected_groups += 1
            target = protected
        else:
            raise ValueError("unreviewed obstacle/owner in south cut prism: " + name)
        if not group["ids"] or len(set(group["ids"])) != len(group["ids"]):
            raise ValueError("invalid source primitive IDs")
        for primitive_id in group["ids"]:
            k = digest({"owner": identity(group), "id": primitive_id})
            if k in allowed or k in protected:
                raise ValueError("duplicate identity in reviewed evidence")
            target.add(k)
    if protected_groups != 3 or any(
            approved_counts[name] != count for name, (_, count) in APPROVED_OWNERS.items()):
        raise ValueError("owner inventory/groups differ from reviewed #322 data")
    if not allowed or not protected or allowed & protected:
        raise ValueError("empty/overlapping permissions")
    return allowed, protected, approved_counts


def collect_records(triangles):
    """Preserve full source inventory, grouping box faces back into solids."""
    records, boxes, seen = [], {}, set()
    for t in triangles:
        key = digest({"owner": identity(t), "id": t["id"]})
        if t.get("primitive") == "Box":
            boxes.setdefault(key, [t, []])[1].extend(t["local"].tolist())
            continue
        if key in seen:
            raise ValueError("duplicate triangle identity")
        seen.add(key)
        records.append({"key": key, "type": "Triangle",
                        "points": t["local"].tolist(), "owner": identity(t)})
    for key, (t, faces) in boxes.items():
        if key in seen:
            raise ValueError("box/triangle identity collision")
        seen.add(key)
        records.append({"key": key, "type": "Box",
                        "points": np.unique(faces, axis=0).tolist(), "owner": identity(t)})
    return records


def audit_mutations(records, candidate, allowed, protected):
    """Challenge the strict comparator using actual source/candidate records."""
    import copy
    predicates = {
        "authorizedTriangle": lambda r: r['key'] in allowed and r['type']=='Triangle',
        "normalCollision": lambda r: r['key'] in allowed and r['owner']['name']=='cs2_01_5',
        "interiorCollision": lambda r: r['key'] in allowed and r['owner']['name']=='v_clotheslo',
        "weeds": lambda r: r['key'] in protected,
        "counter": lambda r: r['owner']['name']=='v_51_counter',
        "display": lambda r: r['owner']['name'].startswith('v_51_clothing'),
        "floor": lambda r: r['owner']['name']=='v_clotheslo' and np.max(np.array(r['points'])[:,2]) < .20,
        "sill": lambda r: r['owner']['name']=='v_51_v_clotheslo' and
                            np.max(np.array(r['points'])[:,2]) < .26 and
                            np.min(np.array(r['points'])[:,0]) > 7,
        "highCollision": lambda r: 'hi@' in r['owner'].get('file',''),
        "nveAlternative": lambda r: r['owner'].get('file','').startswith('onigiri'),
    }
    results = {}
    def reject(label, bad):
        try:
            verify_partition(candidate, bad)
        except ValueError:
            results[label] = True
        else:
            raise ValueError('strict mutation accepted: '+label)
    for label, predicate in predicates.items():
        record = next((r for r in records if predicate(r)), None)
        if record is None:
            raise ValueError('missing real audit witness: '+label)
        key = record['key']
        bad = dict(candidate)
        bad[key] = copy.deepcopy(candidate[key])
        field = 'remainder' if bad[key]['remainder'] else 'opening'
        if field == 'remainder':
            bad[key][field][0][0][0] += .01
        else:
            bad[key][field][0][0] += .01
        reject(label, bad)
    key = next(iter(candidate))
    for label in ('missingRecord','extraRecord','materialOwnerDigest'):
        bad = dict(candidate)
        if label=='missingRecord': del bad[key]
        elif label=='extraRecord': bad['unexpected-record'] = candidate[key]
        else: bad[key] = {**candidate[key], 'source':'changed owner/material'}
        reject(label, bad)
    return results


def evaluate(records, allowed, protected, audit=False):
    source_keys = {r["key"] for r in records}
    if len(source_keys) != len(records) or not allowed | protected <= source_keys:
        raise ValueError("missing/duplicate real geometry identities")
    candidate = {}
    measures = {name: {"cutCount": 0, "removedMeasure": 0.0}
                for name in APPROVED_OWNERS}
    groups = {}
    preservation = {kind: {'records':0,'preservedMeasure':0.} for kind in ('Triangle','Box')}
    max_error = {kind: 0. for kind in ('Triangle','Box')}
    weed_intersection = 0.0
    for r in records:
        authorized = r["key"] in allowed
        value = partition(r, authorized, LOW, HIGH)
        candidate[r["key"]] = value
        if authorized:
            if value["openingMeasure"] <= 1e-7:
                raise ValueError("reviewed primitive has no positive cut: " + r["key"])
            group = measures[r["owner"]["name"]]
            group["cutCount"] += 1
            group["removedMeasure"] += value["openingMeasure"]
            owner = r['owner']
            key = digest(owner)
            g = groups.setdefault(key, {'owner':owner,'type':r['type'],
                'unit':'m2' if r['type']=='Triangle' else 'm3', 'sourceKeys':[],
                'originalMeasure':0.,'removedMeasure':0.,'preservedMeasure':0.})
            original = area(np.array(r['points'])) if r['type']=='Triangle' else ConvexHull(r['points']).volume
            g['sourceKeys'].append(r['key'])
            g['originalMeasure'] += float(original)
            g['removedMeasure'] += float(value['openingMeasure'])
            g['preservedMeasure'] += float(value['preservedMeasure'])
            max_error[r['type']] = max(max_error[r['type']], abs(float(original)-value['openingMeasure']-value['preservedMeasure']))
        elif value["protectedIntersection"] > 1e-7:
            if r["key"] not in protected:
                raise ValueError("new protected obstruction in aperture: " + r["owner"]["name"])
            weed_intersection += value["protectedIntersection"]
        if not authorized:
            if value['opening'] or value['remainder'] != [r['points']] or value['source'] != digest(r):
                raise ValueError('protected source changed: '+r['key'])
            preservation[r['type']]['records'] += 1
            preservation[r['type']]['preservedMeasure'] += float(value['preservedMeasure'])
    verify(records, candidate, allowed, LOW, HIGH)
    report = {"sourceRecords": len(records), "authorizedIdentities": len(allowed),
            "protectedVegetationIdentities": len(protected),
            "preservedWeedSurfaceArea": weed_intersection,
            "cutOwners": measures, "candidateDigest": digest(candidate),
            "cutGroups":list(groups.values()), "protectedInventory":preservation,
            "maximumConservationError":max_error,
            "partitionVerified": True, "deployment": "BLOCKED"}
    if audit:
        report['strictMutationChecks'] = audit_mutations(records, candidate, allowed, protected)
    return report


def run_private(profile, raw_path, set_path, audit=False):
    evidence = load_reviewed()
    allowed, protected, _ = reviewed_permissions(evidence, profile)
    if hashlib.sha256(Path(raw_path).read_bytes()).hexdigest() != REVIEWED_RAW_SHA256:
        raise ValueError("primary private geometry digest differs from #320/#322")
    if hashlib.sha256(Path(set_path).read_bytes()).hexdigest() != REVIEWED_SET_SHA256:
        raise ValueError("private entity-set geometry digest differs from #322")
    # The primary reader includes archive alternatives. Only the pinned BASE
    # owner paths are authorized; all other resources remain untouched.
    os.environ["X9_RAW"] = str(raw_path)
    import geometry as g
    records = collect_records(g.tri)
    if len(records) != EXPECTED_SOURCE_COUNT:
        raise ValueError("source inventory count differs; review extraction first")
    report = evaluate(records, allowed, protected, audit=audit)
    report.update({"profile": PROFILE, "sourceSha256": REVIEWED_RAW_SHA256,
                   "entitySetSha256": REVIEWED_SET_SHA256,
                   "portal": "2 (existing; runtime flags/visibility NOT VERIFIED)",
                   "nveClearance": "NOT VERIFIED", "resourceExport": "NOT RUN",
                   "instanceIsolation": "NOT RUN", "gta": "NOT RUN"})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True,
                        help="Exactly base-hipster; other profiles fail closed")
    parser.add_argument("--raw", required=True, type=Path,
                        help="Private reviewed #320 focused.jsonl")
    parser.add_argument("--set-raw", required=True, type=Path,
                        help="Private reviewed #322 entity-set focused.jsonl")
    parser.add_argument('--audit', action='store_true', help='run strict mutation checks on real candidate records')
    args = parser.parse_args()
    print(json.dumps(run_private(args.profile, args.raw, args.set_raw, audit=args.audit), indent=2))


if __name__ == "__main__":
    main()
