#!/usr/bin/env python3
"""X9 offline masonry five-column authoring PLAN, not a deployable GTA asset.

No GTA binaries, meshes, scripts or live commands are generated. A local
operator must prove the source and convert the authored fragments separately.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
GATES = (
    "installedModelAndCodeWalkerReload",
    "genuineWorldSourceAtTwoSites",
    "sourceBoundsAndPivotMeasured",
    "sourceCollisionNineOfNine",
    "noForeignOrResidualYbnCollision",
    "lodAndOcclusionIsolated",
    "walkAndFiringLanesClear",
    "neighborHideScopeIsolated",
)


def number(raw, label, low, high):
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError(label + ": expected numeric measurement")
    n = float(raw)
    if not math.isfinite(n) or not (low <= n <= high):
        raise ValueError(label + ": missing, nonfinite or outside conservative range")
    return n


def names():
    obj = json.loads((HERE / "candidates.json").read_text(encoding="utf-8"))
    if obj.get("classification") != "PUBLIC_MODEL_NAMES_ONLY_NOT_GTA_ENHANCED_QUALIFIED":
        raise ValueError("candidate provenance drift")
    return {x["model"] for x in obj["candidateModels"] if x["role"] == "candidate"}


def create_plan(data, *, fixture=False):
    if not isinstance(data, dict) or data.get("schema") != 1:
        raise ValueError("x9 schema 1 required")
    model = data.get("sourceModel")
    if not isinstance(model, str) or model not in names():
        raise ValueError("unknown or unsuitable masonry source model")
    dim = data.get("dimensions")
    if not isinstance(dim, dict):
        raise ValueError("source dimensions missing")
    width = number(dim.get("widthM"), "widthM", 2.7, 4.2)
    height = number(dim.get("heightM"), "heightM", 1.8, 2.6)
    thick = number(dim.get("thicknessM"), "thicknessM", 0.15, 0.45)
    # Five native section roots: reuse X7/X8 physical 0..4 and impact pair.
    section_width = width / 5
    hole_width = 2 * section_width
    if hole_width < 1.0:
        raise ValueError("two-section walking lane under 1.0 m")
    evidence = data.get("localQualification")
    if not isinstance(evidence, dict):
        raise ValueError("local qualification block required")
    evidence_id = evidence.get("evidenceId", "")
    if not isinstance(evidence_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:/-]{8,128}", evidence_id):
        raise ValueError("unsafe/missing evidence identifier")
    observed = evidence.get("gates")
    if not isinstance(observed, dict) or set(observed) != set(GATES):
        raise ValueError("all explicit qualification gates required")
    if any(type(observed[g]) is not bool for g in GATES):
        raise ValueError("qualification gates must be booleans")
    if not fixture and not all(observed[g] for g in GATES):
        raise ValueError("unqualified installed/world candidate; no authoring plan")
    # Stable plan uses no coordinates, world handles, engine archetype registration,
    # generator hot-path patches or asset bytes; no false GTA readiness claim.
    sections = []
    for idx in range(5):
        u0 = -width / 2 + idx * section_width
        u1 = u0 + section_width
        sections.append({
            "physicalIndex": idx,
            "localU0M": round(u0, 6),
            "localU1M": round(u1, 6),
            "localV0M": 0.0,
            "localV1M": round(height, 6),
            "thicknessM": round(thick, 6),
            "nativeRoot": "REQUIRES_LOCAL_AUTHORED_MASONRY_FRAGMENT",
            "sourceArt": "NOT_INCLUDED",
        })
    out = {
        "schema": 1,
        "status": "OFFLINE_FIXTURE_NOT_DEPLOYABLE" if fixture else "OPERATOR_ATTESTED_PLAN_NOT_DEPLOYABLE",
        "sourceModel": model,
        "sourceEvidence": evidence_id,
        "operatorGateAttestations": {k: observed[k] for k in GATES},
        "generator": "x9-5-column-v1",
        "selectedPairMapping": "REUSE_X7_0_TO_4_PHYSICAL_INDEX_ONLY",
        "sectionRootCount": 5,
        "maxOpeningWidthM": round(hole_width, 6),
        "dimensions": {"widthM": width, "heightM": height, "thicknessM": thick},
        "sections": sections,
        "mustProveLocally": [
            "3D section seams and visual match",
            "five independent YFT/GEN9 native roots and collision; bounds/LOD",
            "distinct masonry model from X8's fence recipe; no fallback to fence",
            "source model hide and zero remaining world collision",
            "actual impact selection and RPG native separation",
            "physical player passage and 9/9 world restoration",
            "owned cleanup and stopped-game filesystem rollback",
        ],
    }
    digest = hashlib.sha256(json.dumps(out, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    out["planSha256"] = digest
    return out


def fixture_proposal():
    return {
        "schema": 1,
        "sourceModel": "prop_wallbrick_01",
        "dimensions": {"widthM": 3.0, "heightM": 2.0, "thicknessM": 0.25},
        "localQualification": {"evidenceId": "SYNTHETIC_ONLY",
                               "gates": {k: False for k in GATES}}
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--fixture", action="store_true")
    g.add_argument("--proposal", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    a = parser.parse_args()
    proposal = fixture_proposal() if a.fixture else json.loads(a.proposal.read_text(encoding="utf-8"))
    plan = create_plan(proposal, fixture=a.fixture)
    a.output.mkdir(parents=True, exist_ok=False)
    (a.output / "masonry-plan.json").write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (a.output / "NOT_DEPLOYABLE.txt").write_text(
        "X9 geometry plan only. No GTA assets, no approved native collision, "
        "no X8 runtime masonry registration, no gameplay acceptance.\n", encoding="utf-8")
    print(a.output / "masonry-plan.json")


if __name__ == "__main__":
    main()
