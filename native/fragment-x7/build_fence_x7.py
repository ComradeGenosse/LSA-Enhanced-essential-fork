"""Parameterized X7 native fragment authoring from the X6 mesh recipe.

Blender 5.2.2 + Sollumz 2.9. Source-only --dry-run needs only Python.
No placeholder binaries; conversion and gameplay proof are separate hard gates.
"""
from __future__ import annotations
import argparse, json, shutil, sys, xml.etree.ElementTree as ET
from pathlib import Path
# Blender's --python does not add the script directory to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from spec import a_variants, b_variants, c_variants, d_variants, manifest, seam_z, W, H, SHEET_H

HERE=Path(__file__).resolve().parent
X6=HERE.parent/"fragment-x6"
OUT=HERE/"assets"  # sec1 uses assets-x7d (set in main) so the x7c walk5 assets are never touched

def asserted(src,old,new):
    if src.count(old)!=1:
        raise AssertionError(f"X6 authoring drift; expected once: {old[:90]}, got {src.count(old)}")
    return src.replace(old,new)

def finalize(folder,model,pack):
    """Replicate X6's aggregate bound repair without changing per-piece mesh."""
    import math
    ar=ET.parse(folder/(pack+".ytyp.xml")).getroot().find("./archetypes/Item")
    lo=[float(ar.find("bbMin").get(a)) for a in "xyz"]
    hi=[float(ar.find("bbMax").get(a)) for a in "xyz"]
    center=[(a+b)/2 for a,b in zip(lo,hi)]
    radius=math.sqrt(sum(((b-a)/2)**2 for a,b in zip(lo,hi)))
    p=folder/(model+".yft.xml");tree=ET.parse(p);root=tree.getroot()
    for node in (root,root.find("Drawable")):
        for axis,value in zip("xyz",center): node.find("BoundingSphereCenter").set(axis,str(value))
        node.find("BoundingSphereRadius").set("value",str(radius))
    for tag,values in (("BoundingBoxMin",lo),("BoundingBoxMax",hi)):
        for axis,value in zip("xyz",values): root.find("Drawable/"+tag).set(axis,str(value))
    tree.write(p,encoding="UTF-8",xml_declaration=True)

def build_variant(v,pack,source_only=False):
    # Keep X6's geometry, collision and seeded procedural texture literally in use.
    source=(X6/"build_fence.py").read_text(encoding="utf-8")
    old="out=pathlib.Path(__file__).resolve().parent/'assets';out.mkdir(exist_ok=True)"
    source=asserted(source,old,
         "out=pathlib.Path(__file__).resolve().parent/"+repr(OUT.name)+"/'"+v.name+"';out.mkdir(parents=True,exist_ok=True)")
    source=asserted(source,"'lsa_x6_corrugated'","'"+v.name+"'")
    # second occurrence is asset .blend and should be adapted separately
    source=asserted(source,"'lsa_x6_corrugated.blend'","'"+v.name+".blend'")
    source=asserted(source,"yt.name='lsa_x6'","yt.name='"+pack+"'")
    source=asserted(source,
      "g.strength=35;g.min_damage_force=5;g.damage_health=25;g.force_transmission_scale_up=.25;g.force_transmission_scale_down=.25",
      f"g.strength={v.strength};g.min_damage_force={v.min_damage_force};g.damage_health={v.health};g.force_transmission_scale_up={v.transmission};g.force_transmission_scale_down={v.transmission}")
    if v.layout=="walk5":
        # Five full-height, independently attached sheet strips. Two adjacent
        # released strips make a 1.014 m-wide by 2.131 m-tall possible lane.
        # Only RAGE's native fracture may release them, not scripts.
        source=asserted(source,"CW,CH=W/6,SHEET_H/5","CW,CH=W/5,SHEET_H")
        source=asserted(source,"for j in range(5):\n for i in range(6):",
                        "for j in range(1):\n for i in range(5):")
        source=asserted(source,"),4.5)", "),27.0)") # equal mass per square meter
        source=asserted(source,"if j in (1,4):box","if j==0:box")
        source=asserted(source,"'sheet_chunks':30,'groups':31,'sheet_chunk_mass_kg':4.5",
                        "'sheet_chunks':5,'groups':6,'sheet_chunk_mass_kg':27.0")
    if v.layout=="sec1":
        # X7.2b: ONE independently breakable native prop per strip position. Root = rail (+ end post
        # for the secp variant); one strip child with the same per-strip physics as walk5.
        source=asserted(source,"CW,CH=W/6,SHEET_H/5","CW,CH=W/5,SHEET_H")
        source=asserted(source,"for j in range(5):\n for i in range(6):",
                        "for j in range(1):\n for i in range(1):")
        source=asserted(source,"b.head=(-W/2+(i+.5)*CW,0,(j+.5)*CH)","b.head=(0,0,(j+.5)*CH)")
        source=asserted(source,"x0=-W/2+i*CW;x1=x0+CW","x0=-CW/2;x1=x0+CW")
        source=asserted(source,"seam=-.006 if x<0 else .006","seam=0.0")
        source=asserted(source,"uv.data[li].uv=((v.x+W/2)/W,v.z/H)","uv.data[li].uv=((v.x+CW/2)/W,v.z/H)")
        source=asserted(source,"),4.5)", "),27.0)")
        source=asserted(source,"if j in (1,4):box","if j==0:box")
        post_src=("box('end_post.mesh',(-W/2+.025,0,H/2),(.05,.07,H),S.SollumType.DRAWABLE_MODEL,D,mat,'root')\n"
                  "flags(box('end_post.col',(-W/2+.025,0,H/2),(.05,.07,H),S.SollumType.BOUND_BOX,C,cm,'root'),8)\n")
        rail=("box('root_rail.mesh',(0,0,2.20),(CW,.05,.04),S.SollumType.DRAWABLE_MODEL,D,mat,'root')\n"
              "flags(box('root_rail.col',(0,0,2.20),(CW,.05,.04),S.SollumType.BOUND_BOX,C,cm,'root'),4)\n")
        if v.post:
            post_new=post_src.replace("-W/2+.025","-CW/2+.025")
            source=asserted(source,post_src,rail+post_new)
        else:
            source=asserted(source,post_src,rail)
        source=asserted(source,"a.bb_min=(-W/2,-.07,0);a.bb_max=(W/2,.07,H);a.bs_center=(0,0,H/2);a.bs_radius=1.74",
                        "a.bb_min=(-CW/2,-.07,0);a.bb_max=(CW/2,.07,H);a.bs_center=(0,0,H/2);a.bs_radius=1.2")
        source=asserted(source,"'sheet_chunks':30,'groups':31,'sheet_chunk_mass_kg':4.5",
                        "'sheet_chunks':1,'groups':2,'sheet_chunk_mass_kg':27.0")
    if v.layout=="torn36":
        source=asserted(source,"CW,CH=W/6,SHEET_H/5","CW,CH=W/9,SHEET_H/4")
        source=asserted(source,"for j in range(5):\n for i in range(6):",
                         "for j in range(4):\n for i in range(9):")
        # Vertices of both sides of each piece sample the SAME deterministic seam
        # function. At every shared horizontal edge coordinates are identical.
        source=asserted(source,
          "verts.append((x-arm.bones[name].head_local.x,y+seam,z-arm.bones[name].head_local.z))",
          "verts.append((x-arm.bones[name].head_local.x,y+seam,seam_z(j+(1 if z==z1 else 0),x)-arm.bones[name].head_local.z))")
        source=asserted(source,"),4.5)", "),25*CW*CH)")
        source=asserted(source,"if j in (1,4):box","if j in (1,3):box")
        # Sollumz group properties expose weapon_damage_scale in 2.9; do not
        # silently export other strengths or a fake damaged drawable.
        source=asserted(source,"g.force_transmission_scale_down="+str(v.transmission),
                 "g.force_transmission_scale_down="+str(v.transmission)+";g.weapon_damage_scale=.15")
    # Reuse the X6 exporter; root 1e7 fields remain untouched.
    source=asserted(source,
       "runpy.run_path(str(out.parent/'finalize_bounds.py'))['finalize'](out)",
       "finalize(out,'"+v.name+"','"+pack+"')")
    if source_only:
        import hashlib
        compile(source, str(X6/"build_fence.py"), "exec")
        return hashlib.sha256(source.encode("utf-8")).hexdigest()
    env={"__name__":"__main__","__file__":str(HERE/"build_fence_x7.py"),
         "finalize":finalize,"seam_z":seam_z}
    import bpy
    # Remove archetypes from the previous variant; each export must contain exactly one.
    if hasattr(bpy.context.scene,"ytyps"): bpy.context.scene.ytyps.clear()
    exec(compile(source,str(X6/"build_fence.py"),"exec"),env)
    folder=OUT/v.name
    # X6's CodeWalker XML converter resolves embedded DDS references from the
    # conversion base directory. Retain both the per-model and flat DDS paths.
    import hashlib
    texture=folder/"lsa_x6_galvanized.dds"
    if not texture.exists(): raise RuntimeError("X6 procedural texture missing: "+str(texture))
    flat=OUT/texture.name
    if flat.exists() and hashlib.sha256(flat.read_bytes()).digest()!=hashlib.sha256(texture.read_bytes()).digest():
        raise RuntimeError("Non-identical procedural texture across X7 variants")
    shutil.copy2(texture,flat)
    for suffix in (".yft.xml",".yft"):
        path=folder/(v.name+suffix)
        if path.exists(): shutil.copy2(path,OUT/path.name)
    return folder/(pack+".ytyp.xml")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--layout",choices=("grid6x5","torn36","walk5","sec1"),default="grid6x5")
    ap.add_argument("--session-a",help="analyze_x7.py summary.json from real GTA Session A")
    ap.add_argument("--dry-run",action="store_true")
    blender_args=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else None
    args=ap.parse_args(blender_args)
    tstar=None
    if args.layout=="torn36":
        if not args.session_a: ap.error("torn36 requires validated Session A evidence; no invented T*")
        report=json.loads(Path(args.session_a).read_text(encoding="utf-8"))
        gate=report["session_a_gate"]
        if not gate["pass"]: ap.error("Session A gate is not passed; refuse torn asset export")
        tstar=gate["selected_tstar"]
    global OUT
    if args.layout=="sec1": OUT=HERE/"assets-x7d"
    models=(a_variants() if args.layout=="grid6x5" else
            b_variants(tstar) if args.layout=="torn36" else d_variants() if args.layout=="sec1" else c_variants())
    pack={"grid6x5":"lsa_x7a","torn36":"lsa_x7b","walk5":"lsa_x7c","sec1":"lsa_x7d"}[args.layout]
    if args.dry_run:
        hashes={v.name:build_variant(v,pack,source_only=True) for v in models}
        print(json.dumps({**manifest(args.layout,tstar),"authored_source_sha256":hashes},indent=2));return
    try: import bpy
    except ImportError: ap.error("Actual authoring requires Blender 5.2.2 and Sollumz 2.9")
    OUT.mkdir(exist_ok=True)
    ytyp_xmls=[build_variant(v,pack) for v in models]
    # Merge XML archetype declarations; the binary multi-archetype YTYP
    # is generated by the Windows CodeWalker/Sollumz export step.
    root=ET.Element("CMapTypes");nodes=ET.SubElement(root,"archetypes")
    for path in ytyp_xmls:
        tree=ET.parse(path)
        items=tree.findall("./archetypes/Item")
        if len(items)!=1: raise RuntimeError(f"Unexpected archetypes in {path}")
        nodes.append(items[0])
    ET.SubElement(root,"name").text=pack
    ET.ElementTree(root).write(OUT/(pack+".ytyp.xml"),encoding="UTF-8",xml_declaration=True)
    (OUT/"models.json").write_text(json.dumps(manifest(args.layout,tstar),indent=2)+"\n",encoding="utf-8")
    (OUT/"export-pending.json").write_text(json.dumps({
        "status":"XML generated; Windows GEN9 binary export and reload validation required",
        "layout":args.layout,"tstar":tstar,"models":[v.name for v in models]},indent=2)+"\n")
    print("Authored",len(models),"XML twins; never treat as converted or GTA validated.")

if __name__=="__main__":main()
