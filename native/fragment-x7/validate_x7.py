"""Cloud-safe X7 source checks; optional strict assertions for real Blender/CodeWalker exports."""
import argparse, hashlib, json, re, struct
from pathlib import Path
import xml.etree.ElementTree as ET
from spec import a_variants, manifest, W, H
p=Path(__file__).resolve().parent
assets=p/"assets"
ap=argparse.ArgumentParser()
ap.add_argument("--require-exports",action="store_true")
args=ap.parse_args()
def read(path): return path.read_text(encoding="utf-8")
driver=read(p/"WpsBreachLabX7.3.cs")
x6=read(p.parent/"fragment-x6"/"WpsBreachLabX6.3.cs")
assert 'const string Ver = "X7-0.1"' in driver
commit=driver.split('long X7Commit(Astra.X7.ImpactSectionSelector.Selection selected)')[1].split('void X7Prepare')[0]
assert 'X7ActivateSelective()' in commit
assert 'x7SelPos = new HashSet<int> { selected.FirstIndex, selected.SecondIndex }' in commit
assert 'x7_section_preflight_failed' in commit
assert 'CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS' in commit
assert not any(k in commit for k in ("Yield(","Row(","Request(","Wait("))
shot=driver.split('void X7Shot(')[1].split('bool X7FindOpening')[0]
assert 'X7Commit(bestSelection)' in shot and 'X7Mask(label,aimU,aimV)' in shot
assert 'ImpactSectionSelector.TryPredictAndSelect(' in shot
assert 'readyCount == 1' in shot and 'beforeShotHandles.Contains(p.Handle)' in shot
assert 'x7_live_impact_requires_five_sections_no_preselection' in shot
assert 'for (int f = 0; f < 60; f++) Yield();' in shot
assert 'x7_fallback_forbidden' in shot
assert 'float shotPu = F(a, "pu", Math.Abs(aimU) < .05f ? x7Pu : aimU);' in shot
assert '"back", x7Back, "pu", shotPu' in shot
assert 'centre.X, centre.Y, centre.Z, 1.5f))' in shot
assert 'centre.X, centre.Y, centre.Z, 6f))' not in shot
assert 'vStart=T.V0+.16f' in shot
assert 'Classify(T,u,T.V0+.175f)==1' in shot
assert 'T.V0+2.131f-vStart' in driver, "dense mask must exclude non-sheet upper empty band"
for forbidden in ("DetachFragmentPart", "BREAK_OBJECT_FRAGMENT_CHILD", "DAMAGE_OBJECT_FRAGMENT_CHILD",
                  "World.AddExplosion(", ".Delete(", "APPLY_FORCE"):
    assert forbidden not in shot,forbidden
for marker in ('World.GetNearbyProps(x7HidePos, 8f)','SET_DISABLE_FRAG_DAMAGE',
               'SET_DISABLE_BREAKING', 'X7SetDormant(true)', 'gone = false; goneFrame = -1;',
               'Classify(T,uStart+i*pitch,vStart+j*pitch)', 'model_not_in_pack_allowlist'):
    assert marker in driver,marker
assert 'x7Model=requested;' in driver
assert driver.count('case "x7prepare"')==1
assert all(driver.count('"'+v.name+'"')>=1 for v in a_variants())
assert 'x7Shot' in driver or 'X7Shot' in driver
# Check frozen X6 code remains committed and X7 builder only reads it.
builder=read(p/"build_x7.py")
assert '(folder.parent/\'fragment-x6\'/\'WpsBreachLabX6.3.cs\').read_text' in builder
assert 'write_text' in builder
assert all(v.name in driver for v in a_variants())
result={"scope":"cloud source-only unless real exports present",
        "models":len(a_variants()),"driver_sha256":hashlib.sha256(driver.encode()).hexdigest(),
        "native_commit_asserted":True,"no_scripted_shot_detach_or_blast":True,
        "x2_to_x6_modified_by_x7":False,"real_exports_validated":False}
if (assets/"models.json").exists():
    m=json.loads((assets/"models.json").read_text())
    assert m["layout"] in ("grid6x5","torn36","walk5")
    assert m["allowlist"]==manifest(m["layout"],m.get("tstar"))["allowlist"]
    models=a_variants() if m["layout"]=="grid6x5" else []
    if m["layout"]=="grid6x5":
        if args.require_exports: assert (assets/"lsa_x6_galvanized.dds").exists(), "CodeWalker DDS texture reference missing"
        fingerprints=[]
        for v in models:
            xml=assets/(v.name+".yft.xml")
            if not xml.exists():
                if args.require_exports: raise AssertionError("Real XML missing: "+str(xml))
                break
            root=ET.parse(xml).getroot()
            groups=root.findall('./Physics/LOD1/Groups/Item')
            bones=root.findall('./Drawable/Skeleton/Bones/Item')
            assert len(groups)==len(bones)==31,(v.name,len(groups),len(bones))
            def val(g,k):return float(g.find(k).get("value"))
            assert val(groups[0],"Strength")==1e7
            for k in ("Strength","MinDamageForce","DamageHealth"):
                assert val(groups[0],k)==1e7
            for g in groups:
                assert val(g,"ForceTransmissionScaleUp")==v.transmission
                assert val(g,"ForceTransmissionScaleDown")==v.transmission
            for g in groups[1:]:
                assert val(g,"Strength")==v.strength
                assert val(g,"MinDamageForce")==v.min_damage_force
                assert val(g,"DamageHealth")==v.health
                assert val(g,"Mass")==4.5
            lo=root.find('./Drawable/BoundingBoxMin')
            hi=root.find('./Drawable/BoundingBoxMax')
            assert abs(float(hi.get('x'))-float(lo.get('x'))-W)<.001
            assert abs(float(hi.get('z'))-float(lo.get('z'))-H)<.001
            # Hash actual vertex/index arrays, not merely a blueprint signature.
            arrays=[ET.tostring(n,encoding='utf-8') for n in root.iter()
                    if n.tag in ('VertexBuffer','IndexBuffer','Bounds')]
            assert arrays,("No vertex/index arrays available in export",v.name)
            assert len(root.findall('.//DrawableModelsHigh/Item/Geometries/Item'))<=128
            fingerprints.append(hashlib.sha256(b''.join(arrays)).hexdigest())
            if args.require_exports:
                yft=assets/(v.name+".yft")
                assert yft.exists() and struct.unpack_from('<I',yft.read_bytes(),4)[0]==171
        if len(fingerprints)==12:
            assert len(set(fingerprints))==1,"X7a geometry or bound arrays changed by model"
            frozen=ET.parse(p.parent/"fragment-x6"/"assets"/"lsa_x6_corrugated.yft.xml").getroot()
            frozen_arrays=[ET.tostring(n,encoding='utf-8') for n in frozen.iter()
                           if n.tag in ('VertexBuffer','IndexBuffer','Bounds')]
            assert fingerprints[0]==hashlib.sha256(b''.join(frozen_arrays)).hexdigest(),"X7a drift from frozen X6 geometry/collision"
            result["real_exports_validated"]=True
            result["geometry_fingerprint"]=fingerprints[0]
if args.require_exports:
    assert result["real_exports_validated"]
    converted=json.loads((assets/"conversion-receipt.json").read_text(encoding="utf-8-sig"))
    packed=json.loads((p/"pack"/"pack-receipt.json").read_text(encoding="utf-8-sig"))
    expected=manifest()["allowlist"]
    assert packed["models"]==expected and packed["pack"]=="lsa_fence_x7a"
    assert [v["name"] for v in converted["models"]]==expected
    assert converted["archetypes"]==12
    def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest().upper()
    for v in converted["models"]:
        assert v["bones"]==31 and v["version"]==171
        assert digest(assets/(v["name"]+".yft"))==v["sha256"].upper()
    assert digest(assets/"lsa_x7a.ytyp")==converted["ytypSha256"].upper()
    assert digest(p/"pack"/"dlc.rpf")==packed["sha256"].upper()
    archetypes=ET.parse(assets/"lsa_x7a.ytyp.xml").findall('./archetypes/Item')
    assert [v.findtext('name') for v in archetypes]==expected
print(json.dumps(result,indent=2))
