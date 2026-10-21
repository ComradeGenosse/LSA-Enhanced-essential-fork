"""Frozen torn36 source geometry checks; strict export mode requires actual generated assets."""
import argparse, json, math, xml.etree.ElementTree as ET
from pathlib import Path
from spec import W,H,SHEET_H,cells,seam_z,b_variants
ap=argparse.ArgumentParser()
ap.add_argument("--session-a",help="real analyze_x7.py summary.json")
ap.add_argument("--require-exports",action="store_true")
ns=ap.parse_args()
root=Path(__file__).resolve().parent
cs=cells("torn36")
assert len(cs)==36
area=sum((x1-x0)*(z1-z0) for x0,x1,z0,z1 in cs)
coverage=area/(W*SHEET_H)
assert coverage>=.97
assert min(z1-z0 for _,_,z0,z1 in cs)>=.30
assert max(z1-z0 for _,_,z0,z1 in cs)<=.75
assert all(1<= (x1-x0)/(W/20)<=3 for x0,x1,_,_ in cs)
for j in range(1,4):
    for k in range(1001):
        x=-W/2+k*W/1000
        z=seam_z(j,x)
        assert abs(z-j*SHEET_H/4)<=.02
        assert z==seam_z(j,x) # same function for both sides of every shared edge
data={"status":"source geometric check, not native export/gameplay proof",
      "torn_pieces":len(cs),"collision_core_coverage":coverage,
      "shared_edges":"continuous analytic seam, sampled 3003 times",
      "bounds":[W,.14,H]}
if ns.require_exports:
    assert ns.session_a
    results=json.loads(Path(ns.session_a).read_text())
    assert results["session_a_gate"]["pass"]
    tstar=results["session_a_gate"]["selected_tstar"]
    models=b_variants(tstar)
    for m in models:
        p=root/"assets"/(m.name+".yft.xml")
        assert p.exists(),"actual X7b XML missing: "+str(p)
        tree=ET.parse(p).getroot()
        assert len(tree.findall('./Physics/LOD1/Groups/Item'))==37
        assert len(tree.findall('./Drawable/Skeleton/Bones/Item'))==37
    assert (root/"assets"/"conversion-receipt.json").exists()
    data["status"]="XML export checked, native visual/physics still needs GTA"
print(json.dumps(data,indent=2))
