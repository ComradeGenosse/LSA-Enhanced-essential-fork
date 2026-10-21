"""ASTRA-001 X7 research: offline breakage-zone analysis of committed X2/X3/X6 evidence.

Reads only repository evidence; never touches GTA. Run from the repository root:
    python docs/next-gen-gameplay/astra-001/x7-research/breakage_zone_analysis.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4] if len(sys.argv) < 2 else Path(sys.argv[1]).resolve()
X2 = ROOT / "docs/next-gen-gameplay/astra-001/x2-evidence/final-validation.json"
X6_YFT = ROOT / "native/fragment-x6/assets/lsa_x6_corrugated.yft.xml"
X6_ACC = ROOT / "native/fragment-x6/evidence/acceptance/20261021-212815-cbe52d.jsonl"
X6_C1 = ROOT / "native/fragment-x6/evidence/candidate1/20261021-202948-7806a0.jsonl"

SYM = {"0": ".", "1": "#", "2": "d", "3": "o"}


def read_jsonl(path: Path):
    rows = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def x2_masks():
    """X2 wall: 3.0 x 2.5 m, 6 x 5 chunks of 0.5 m; mask 12 x 10 cells at 0.25 m, row-major from the bottom."""
    data = json.loads(X2.read_text(encoding="utf-8-sig"))
    print("## X2 frozen final pass (strength 500 / min damage force 100 / health 100; outer columns reinforced)\n")
    for trial in data["trials"]:
        geo = trial.get("geometry") or {}
        mask = geo.get("mask")
        if not mask or "explosive=none" in trial["command"]:
            continue
        args = dict(kv.split("=", 1) for kv in trial["command"].split()[1:] if "=" in kv)
        bu, bh = float(args.get("du", 0)), float(args.get("height", 1))
        broken, survived = [], []
        for ci in range(1, 5):  # breakable chunk columns
            for cj in range(5):
                cells = [mask[(2 * cj + dj) * 12 + 2 * ci + di] for di in (0, 1) for dj in (0, 1)]
                gone = sum(c != "1" for c in cells) >= 3
                d = math.hypot(-1.25 + 0.5 * ci - bu, 0.25 + 0.5 * cj - bh)
                (broken if gone else survived).append(round(d, 2))
        print(f"{args['explosive']:>7} x{args['scale']:<5} at u={bu:+.2f} h={bh:.2f}: detached={geo.get('flaggedDetached')} "
              f"clear m2={trial.get('clearAreaM2')}  broken in-plane d max={max(broken) if broken else None} "
              f"survivor d min={min(survived) if survived else None}")
        for j in reversed(range(10)):
            row = "".join(SYM.get(mask[j * 12 + i], "?") for i in range(12))
            print("    " + row[:2] + "|" + row[2:10] + "|" + row[10:])
        print()


def x6_layout():
    import xml.etree.ElementTree as ET
    root = ET.parse(X6_YFT).getroot()
    groups = root.findall("./Physics/LOD1/Groups/Item")
    sheet = groups[1]
    keys = ["Strength", "ForceTransmissionScaleUp", "ForceTransmissionScaleDown", "MinDamageForce", "DamageHealth", "Mass"]
    print("## X6 accepted asset physics (from committed YFT XML)\n")
    print("root:", {k: groups[0].find(k).get("value") for k in keys})
    print("sheet (x30):", {k: sheet.find(k).get("value") for k in keys})
    print("parents:", sorted({g.find("ParentIndex").get("value") for g in groups[1:]}), "(flat: every sheet is a direct child of the root)\n")
    w, h = 2.536, 2.351
    sh = h - 0.22
    cw, ch = w / 6, sh / 5
    cells = [(-w / 2 + (i + 0.5) * cw, (j + 0.5) * ch) for j in range(5) for i in range(6)]
    print("## X6 sheet-piece distances from candidate impact points (in-plane, metres)\n")
    for name, p in [("centre (X6 aim)", (0.0, 1.05)), ("left", (-0.75, 1.05)), ("right-high", (0.7, 1.55)), ("low", (0.0, 0.6))]:
        ds = sorted(math.hypot(x - p[0], z - p[1]) for x, z in cells)
        within = {r: sum(d <= r for d in ds) for r in (0.45, 0.6, 0.75, 0.9, 1.06, 1.26, 1.5)}
        print(f"{name:16} max={ds[-1]:.2f}  pieces within r: {within}")
    print()


def x6_opening(path: Path, label: str):
    rows = [r for r in read_jsonl(path) if r.get("kind") == "x6_opening_mask"]
    print(f"## X6 {label}: post-blast lane mask (0=clear, 1=twin, 2=debris, 3=other; 0.1 m columns from u0)\n")
    for r in rows:
        print(f"    z+{r['dz']:.1f} m  {r['mask']}")
    print()


if __name__ == "__main__":
    x2_masks()
    x6_layout()
    x6_opening(X6_C1, "candidate1 (5 native parts)")
    x6_opening(X6_ACC, "accepted asset (30 native parts)")
