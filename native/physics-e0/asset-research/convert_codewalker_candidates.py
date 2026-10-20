#!/usr/bin/env python3
"""Convert private CodeWalker candidate files to separate E0 surface/wall JSON arrays.
No Rockstar files or coordinates are embedded in this source code.
Inputs and output must remain private. GTA runtime comparison is still required.
"""
import argparse
import json
import math
from pathlib import Path

def vector(v, name):
    if not isinstance(v, list) or len(v) != 3 or any(
        isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in v
    ):
        raise ValueError(f"{name}: malformed/nonfinite vector")
    return [round(float(x), 8) for x in v]

def key(e):
    return (e["asset"], e["bound"], e["polygonIndex"])

def convert(candidates, verification):
    if candidates.get("schemaVersion") != 1 or verification.get("scope") != "OFFLINE_CODEWALKER_SINGLE_YBN_ONLY":
        raise ValueError("unrecognized private extraction schema")
    if verification.get("nativeGtaStatus") != "NOT_TESTED":
        raise ValueError("unexpected offline verification status")
    if len(candidates["surfaces"]) != 30 or len(candidates["walls"]) != 10:
        raise ValueError("expected exactly 30 surface and 10 wall samples")
    out = {"schemaVersion": 1, "surfaces": [], "walls": []}
    seen = set()
    for category in ("surfaces", "walls"):
        verified = [x for x in verification[category] if x["matchesTarget"]] if category == "surfaces" else [
            x for x in verification[category] if x["matchesPrimitive"]
        ]
        for i, sample in enumerate(candidates[category], 1):
            a = vector(sample["rayFrom"], "from")
            b = vector(sample["rayTo"], "to")
            if not .05 <= math.dist(a, b) <= 20:
                raise ValueError("ray length not accepted")
            identity = (category, key(sample), tuple(a), tuple(b))
            if identity in seen:
                raise ValueError("duplicate ray")
            seen.add(identity)
            name = sample.get("materialNameFromBaseTable")
            idx = sample.get("materialIndex")
            if not isinstance(name, str) or not name or type(idx) is not int or not 0 <= idx <= 255:
                raise ValueError("missing material name/index")
            supporting = [x for x in verified if key(x) == key(sample)]
            if category == "surfaces":
                supporting = [x for x in supporting if x["hit"]["hit"] and
                    x["hit"]["materialIndex"] == idx and x["targetErrorM"] < .01 and
                    math.dist(vector(x["hit"]["position"], "hit"), vector(sample["point"], "point")) < .01]
                thickness = 0.0
            else:
                supporting = [x for x in supporting if x["forward"]["hit"] and x["reverse"]["hit"] and
                    x["forward"]["materialIndex"] == idx and x["reverse"]["materialIndex"] == idx and
                    math.isclose(x["measuredOfflineRayThicknessM"],
                        sample["encodedPrimitiveThicknessM"], abs_tol=.01)]
                thickness = float(supporting[0]["measuredOfflineRayThicknessM"])
                if not 0 < thickness <= 20:
                    raise ValueError("invalid wall thickness")
            if not supporting:
                raise ValueError(f"{category}[{i}]: no matching CodeWalker ray evidence")
            label = f"{'mat' if category=='surfaces' else 'wall'}-{i:02d}-{name[:31]}-p{sample['polygonIndex']}"
            out[category].append({
                "label": label, "ax": a[0], "ay": a[1], "az": a[2],
                "bx": b[0], "by": b[1], "bz": b[2],
                "expectedMaterial": name, "materialIndex": idx,
                "expectedThicknessM": round(float(thickness), 8)
            })
    return out

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("candidates", type=Path)
    p.add_argument("verification", type=Path)
    p.add_argument("output", type=Path)
    a = p.parse_args()
    result = convert(json.loads(a.candidates.read_text(encoding="utf-8-sig")),
                     json.loads(a.verification.read_text(encoding="utf-8-sig")))
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, indent=2, allow_nan=False)+"\n", encoding="utf-8")
    print(f"Wrote private E0 samples: {len(result['surfaces'])} surfaces / {len(result['walls'])} walls. No GTA verification claimed.")

if __name__ == "__main__":
    main()
