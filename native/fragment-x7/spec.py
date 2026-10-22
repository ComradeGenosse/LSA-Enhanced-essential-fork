"""Frozen ASTRA-001 doc 16, sections 6-8. Pure Python; no GTA/Blender dependency."""
from __future__ import annotations
from dataclasses import asdict, dataclass
import hashlib, json
from pathlib import Path

W, H, SHEET_H, PITCH = 2.536, 2.351, 2.131, 2.536 / 20
LEVELS = (300, 550, 1000, 1800, 3200, 5600, 10000)
POINTS = {"P0": (0.0, 1.05), "P1": (0.0, 0.80),
          "P2": (-0.70, 1.10), "P3": (0.65, 1.60)}

@dataclass(frozen=True)
class Variant:
    name: str
    layout: str
    strength: float
    min_damage_force: float
    health: float
    transmission: float
    weapon_scale: float = 1.0
    source: str = "ASTRA doc16 section7"

def a_variants():
    rows = [Variant("lsa_x7a_ctl", "grid6x5", 35, 5, 25, .25),
            Variant("lsa_x7a_sx", "grid6x5", 1e7, 5, 25, 0),
            Variant("lsa_x7a_hx", "grid6x5", 35, 1e7, 1e7, 0)]
    rows += [Variant(f"lsa_x7a_j{k}", "grid6x5", k, k/5, k, 0) for k in LEVELS]
    rows += [Variant(f"lsa_x7a_j{k}f", "grid6x5", k, k/5, k, .25) for k in (1000, 3200)]
    assert len(rows) == 12 and len({r.name for r in rows}) == 12
    return rows

def b_variants(tstar: int):
    if tstar not in LEVELS:
        raise ValueError("T* must be an observed LOCAL level from the frozen ladder")
    values = (tstar / 1.8, float(tstar), tstar * 1.8)
    return [Variant(f"lsa_x7b_torn_{round(k)}", "torn36", k, k/5, k, 0, .15,
                    source=f"Session A observed T*={tstar}; not yet runtime verified")
            for k in values]

def c_variants():
    """One small experimental pack: full-height strips for physical player traversal.

    j1000 is the measured LOCAL candidate; j550 is a modest existing
    threshold comparison. Neither is a claim of walkability or acceptance.
    """
    return [Variant(f"lsa_x7c_walk5_j{k}", "walk5", k, k/5, k, 0,
                    source="X7.1 walkable-geometry experiment; GTA UNTESTED")
            for k in (1000, 550)]

def cells(layout):
    """Shared authored rectangle basis, row-major order. Torn mesh uses shared jag functions."""
    dims = {"grid6x5": (6, 5), "torn36": (9, 4), "walk5": (5, 1)}
    nx, nz = dims[layout]
    return [(-W/2+i*W/nx, -W/2+(i+1)*W/nx,
             j*SHEET_H/nz, (j+1)*SHEET_H/nz)
            for j in range(nz) for i in range(nx)]

def seam_z(j: int, x: float, layout="torn36"):
    """Continuous inter-row seam, used verbatim by the pieces on both sides."""
    import math
    assert 0 <= j <= 4
    base = j * SHEET_H / 4
    if j in (0, 4) or layout != "torn36":
        return base
    # All offsets <= 0.020 m, phase varies by row and corrugation.
    return base + .011*math.sin((x+W/2)*2*math.pi/PITCH + j*.83) + .007*math.sin((x+W/2)*7.7+j*1.67)

def manifest(layout="grid6x5", tstar=None):
    variants = (a_variants() if layout == "grid6x5" else
                b_variants(tstar) if layout == "torn36" else
                c_variants() if layout == "walk5" else
                (_ for _ in ()).throw(ValueError("Unknown layout")))
    out = {
       "schema": 1, "layout": layout, "models": [asdict(v) for v in variants],
       "allowlist": [v.name for v in variants], "bounds_m": [W,.14,H],
       "sheet_height_m": SHEET_H, "groups": 1+len(cells(layout)),
       "root": {"strength": 10000000, "min_damage_force": 10000000, "health": 10000000},
       "physics_authority": "RAGE native only",
       "export_status": "source only; check assets/conversion-receipt.json for actual conversion"
    }
    out["layout_fingerprint"] = hashlib.sha256(
       json.dumps(cells(layout), separators=(",",":")).encode()).hexdigest()
    return out

if __name__ == "__main__":
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument("--layout",choices=("grid6x5","torn36","walk5"),default="grid6x5")
    ap.add_argument("--tstar",type=int);ap.add_argument("--output")
    args=ap.parse_args()
    m=manifest(args.layout,args.tstar)
    value=json.dumps(m,indent=2,sort_keys=True)+"\n"
    if args.output: Path(args.output).write_text(value,encoding="utf-8")
    else: print(value)
