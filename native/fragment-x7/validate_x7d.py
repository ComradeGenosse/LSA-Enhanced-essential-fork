"""X7.2b independent-section pack: source checks by default, real CodeWalker receipts when requested.

Never asserts a playable hole or GTA pass. Reads assets-x7d/ and pack-x7d/ only; x7c assets are untouched.
"""
import argparse, hashlib, json, struct, xml.etree.ElementTree as ET
from pathlib import Path
from spec import d_variants, cells, manifest, SEC_W, SECTIONS, SHEET_H, W

p=Path(__file__).resolve().parent
assets=p/"assets-x7d"
ap=argparse.ArgumentParser()
ap.add_argument("--require-exports",action="store_true")
args=ap.parse_args()
models=d_variants()
pieces=cells("sec1")
assert len(models)==6 and len(pieces)==1 and SECTIONS==5
assert abs(SEC_W*SECTIONS-W)<1e-9
assert manifest("sec1")["groups"]==2
assert len({v.name for v in models})==6
assert [(v.strength,v.health,v.min_damage_force,v.transmission) for v in models]==[
    (k,k,k/5,0) for k in (1400,1400,1800,1800,2400,2400)]
assert [v.post for v in models]==[False,True]*3
builder=(p/"build_fence_x7.py").read_text(encoding="utf-8")
assert 'v.layout=="sec1"' in builder and "root_rail" in builder and 'OUT=HERE/"assets-x7d"' in builder
converter=(p/"convert_xml_x7.ps1").read_text(encoding="utf-8")
packer=(p/"build_pack_x7.ps1").read_text(encoding="utf-8")
assert "'lsa_x7d'" in converter and "if($manifest.layout -eq 'sec1'){$count=2}" in converter and "'lsa_x7d'" in packer
result={"layout":"sec1","models":[v.name for v in models],"sections":SECTIONS,"section_width_m":round(SEC_W,4),
        "actual_export_validated":False,"gta_result":"NOT_TESTED"}
if args.require_exports:
    actual=json.loads((assets/"models.json").read_text(encoding="utf-8-sig"))
    assert actual["layout"]=="sec1" and actual["allowlist"]==manifest("sec1")["allowlist"]
    assert (assets/"lsa_x6_galvanized.dds").exists()
    conversion=json.loads((assets/"conversion-receipt.json").read_text(encoding="utf-8-sig"))
    pack=json.loads((p/"pack-x7d"/"pack-receipt.json").read_text(encoding="utf-8-sig"))
    assert conversion["archetypes"]==6 and conversion["ytyp"]=="lsa_x7d"
    assert [m["name"] for m in conversion["models"]]==actual["allowlist"]
    assert pack["pack"]=="lsa_fence_x7d" and pack["models"]==actual["allowlist"]
    def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest().upper()
    for model in models:
        root=ET.parse(assets/(model.name+".yft.xml")).getroot()
        groups=root.findall("./Physics/LOD1/Groups/Item")
        bones=root.findall("./Drawable/Skeleton/Bones/Item")
        assert len(groups)==len(bones)==2,model.name
        def value(group,name):return float(group.find(name).get("value"))
        for name in ("Strength","MinDamageForce","DamageHealth"):
            assert value(groups[0],name)==1e7
        for group in groups:
            assert value(group,"ForceTransmissionScaleUp")==0
            assert value(group,"ForceTransmissionScaleDown")==0
        assert value(groups[1],"Strength")==model.strength
        assert value(groups[1],"MinDamageForce")==model.min_damage_force
        assert value(groups[1],"DamageHealth")==model.health
        assert abs(value(groups[1],"Mass")-27.0)<1e-5
        lo=root.find("./Drawable/BoundingBoxMin");hi=root.find("./Drawable/BoundingBoxMax")
        assert abs(float(hi.get("x"))-float(lo.get("x"))-SEC_W)<.001
        expected_height=2.351 if model.post else 2.20+.04/2
        assert abs(float(hi.get("z"))-float(lo.get("z"))-expected_height)<.001
        binary=assets/(model.name+".yft")
        assert struct.unpack_from("<I",binary.read_bytes(),4)[0]==171
        receipt=next(m for m in conversion["models"] if m["name"]==model.name)
        assert receipt["bones"]==2 and receipt["version"]==171
        assert sha(binary)==receipt["sha256"].upper()
    ytyp=assets/"lsa_x7d.ytyp"
    assert sha(ytyp)==conversion["ytypSha256"].upper()
    archetypes=ET.parse(assets/"lsa_x7d.ytyp.xml").findall("./archetypes/Item")
    assert [n.findtext("name") for n in archetypes]==actual["allowlist"]
    assert sha(p/"pack-x7d"/"dlc.rpf")==pack["sha256"].upper()
    result["actual_export_validated"]=True
print(json.dumps(result,indent=2))
