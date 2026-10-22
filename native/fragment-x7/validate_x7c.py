"""X7.1 walk5: source checks by default, real CodeWalker receipts when requested.

The source-only checks do NOT assert a playable hole or a GTA pass.
"""
import argparse, hashlib, json, struct, xml.etree.ElementTree as ET
from pathlib import Path
from spec import c_variants, cells, manifest, W, SHEET_H

p=Path(__file__).resolve().parent
assets=p/"assets"
ap=argparse.ArgumentParser()
ap.add_argument("--require-exports",action="store_true")
args=ap.parse_args()
models=c_variants()
pieces=cells("walk5")
assert len(models)==4 and len(pieces)==5
assert all(abs(z0)<1e-9 and abs(z1-SHEET_H)<1e-9 for _,_,z0,z1 in pieces)
assert 2*(pieces[0][1]-pieces[0][0])>=.9
assert manifest("walk5")["groups"]==6
assert len({v.name for v in models})==4
assert [(v.strength,v.health,v.min_damage_force,v.transmission) for v in models]==[
    (1000,1000,200,0),(550,550,110,0),(1800,1800,360,0),(3200,3200,640,0)]
builder=(p/"build_fence_x7.py").read_text(encoding="utf-8")
assert 'v.layout=="walk5"' in builder
for marker in ("CW,CH=W/5,SHEET_H", "for j in range(1)", "for i in range(5)", "),27.0)"):
    assert marker in builder,marker
converter=(p/"convert_xml_x7.ps1").read_text(encoding="utf-8")
installer=(p/"test-install-x7.ps1").read_text(encoding="utf-8")
packer=(p/"build_pack_x7.ps1").read_text(encoding="utf-8")
assert "'lsa_x7c'" in converter and "{37}else{6}" in converter
assert "'x7c'" in installer and "'lsa_x7c'" in packer
result={"layout":"walk5","models":[v.name for v in models],
        "pieces":len(pieces),"adjacent_width_m":round(2*W/5,4),
        "actual_export_validated":False,"gta_traversal":"NOT_TESTED"}
if args.require_exports:
    actual=json.loads((assets/"models.json").read_text(encoding="utf-8-sig"))
    assert actual["layout"]=="walk5" and actual["allowlist"]==manifest("walk5")["allowlist"]
    assert (assets/"lsa_x6_galvanized.dds").exists()
    conversion=json.loads((assets/"conversion-receipt.json").read_text(encoding="utf-8-sig"))
    pack=json.loads((p/"pack"/"pack-receipt.json").read_text(encoding="utf-8-sig"))
    assert conversion["archetypes"]==4 and conversion["ytyp"]=="lsa_x7c"
    assert [m["name"] for m in conversion["models"]]==actual["allowlist"]
    assert pack["pack"]=="lsa_fence_x7c" and pack["models"]==actual["allowlist"]
    def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest().upper()
    for model in models:
        xml=assets/(model.name+".yft.xml")
        root=ET.parse(xml).getroot()
        groups=root.findall("./Physics/LOD1/Groups/Item")
        bones=root.findall("./Drawable/Skeleton/Bones/Item")
        assert len(groups)==len(bones)==6,model.name
        def value(group,name):return float(group.find(name).get("value"))
        for name in ("Strength","MinDamageForce","DamageHealth"):
            assert value(groups[0],name)==1e7
        for group in groups:
            assert value(group,"ForceTransmissionScaleUp")==0
            assert value(group,"ForceTransmissionScaleDown")==0
        for group in groups[1:]:
            assert value(group,"Strength")==model.strength
            assert value(group,"MinDamageForce")==model.min_damage_force
            assert value(group,"DamageHealth")==model.health
            assert abs(value(group,"Mass")-27.0)<1e-5
        lo=root.find("./Drawable/BoundingBoxMin")
        hi=root.find("./Drawable/BoundingBoxMax")
        assert abs(float(hi.get("x"))-float(lo.get("x"))-W)<.001
        assert abs(float(hi.get("z"))-float(lo.get("z"))-2.351)<.001
        binary=assets/(model.name+".yft")
        assert struct.unpack_from("<I",binary.read_bytes(),4)[0]==171
        receipt=next(m for m in conversion["models"] if m["name"]==model.name)
        assert receipt["bones"]==6 and receipt["version"]==171
        assert sha(binary)==receipt["sha256"].upper()
    ytyp=assets/"lsa_x7c.ytyp"
    assert sha(ytyp)==conversion["ytypSha256"].upper()
    archetypes=ET.parse(assets/"lsa_x7c.ytyp.xml").findall("./archetypes/Item")
    assert [n.findtext("name") for n in archetypes]==actual["allowlist"]
    assert sha(p/"pack"/"dlc.rpf")==pack["sha256"].upper()
    result["actual_export_validated"]=True
print(json.dumps(result,indent=2))
