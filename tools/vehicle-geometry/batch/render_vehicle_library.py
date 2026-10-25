#!/usr/bin/env python3
"""VH8: private, repeatable GTA Enhanced GLB -> local LSA HUD assets.

Install: python -m pip install numpy opencv-python-headless trimesh pillow
Run: python render_vehicle_library.py --source C:/gta-vehicle-exports --dest C:/lsa-local-library
Expected source: <model>.glb, <model>_hi.yft.glb or <model>/mesh/*.glb.
All Rockstar-derived outputs remain in --dest, OUTSIDE git.
"""
import argparse, hashlib, json, math, re, time
from pathlib import Path
import cv2
import numpy as np
import trimesh
from PIL import Image

NAME=re.compile(r"^[a-z][a-z0-9_]{0,31}$")
PALETTE={
    "paint":(105,139,168),"glass":(37,72,98),"mesh":(65,77,91),
    "shuts":(54,65,79),"tire":(26,30,34),"interior":(40,44,52),
    "light":(198,198,200),"detail":(103,110,115),"badges":(206,208,200),
    "license":(225,220,201),"dash":(51,63,78)
}
def classify(name, wheel):
    if wheel:return "tire"
    for k in ("paint","glass","tire","shuts","light","detail","interior",
              "badges","license","dash","mesh"):
        if k in name:return k
    return "mesh"

def source_files(root):
    for p in sorted(root.rglob("*.glb")):
        filename=p.name.lower()
        # Prefer the exported highest detail file; never silently import _lod1.
        if any(x in filename for x in ("_med", "_low", "_verylow", "_lod1", "_lod2")):
            continue
        name=(filename.removesuffix("_hi.yft.glb").removesuffix(".yft.glb")
              .removesuffix("_hi.glb").removesuffix(".glb"))
        if NAME.fullmatch(name):yield name,p

def find_wheel(name):
    name=name.lower()
    for key in ("lf","rf","lr","rr"):
        if re.search(r"(?:^|[_\-])wheel_"+key+r"(?:[_\-]|$)",name):
            return key
    return None

def normpoint(px,py,bounds,frame):
    xlo,xhi,zlo,zhi=bounds
    world_x=xlo+(px+.5)/frame["sx"]
    world_z=zlo+(py+.5)/frame["sy"]
    # glTF -Z = GTA front; pixel row 0 = front.
    return {"x":round((world_x-(xlo+xhi)/2)/(xhi-xlo),6),
            "y":round((world_z-zlo)/(zhi-zlo),6)}

def vertices_from_contour(image,limit,eps,frame,bounds):
    rings,_=cv2.findContours(image,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not rings:raise ValueError("No visible projected triangles")
    rings=sorted(rings,key=cv2.contourArea,reverse=True)
    result=[]
    for item in rings:
        if cv2.contourArea(item)<max(24,0.0005*image.size):continue
        for tolerance in np.linspace(eps,14,100):
            poly=cv2.approxPolyDP(item,float(tolerance),True)[:,0,:]
            if len(poly)<=limit:break
        if len(poly)<3 or len(poly)>limit:continue
        pts=[normpoint(float(x),float(y),bounds,frame) for x,y in poly]
        result.append(pts)
    return result

def process(model,source,dest,limit_triangles=180000,preview=True):
    started=time.time()
    scene=trimesh.load(str(source),force="scene",process=False)
    if not scene.graph.nodes_geometry:raise ValueError("No mesh nodes in GLB")
    parts=[];bounds=[];wheel_positions={};ntris=0
    for node in scene.graph.nodes_geometry:
        transform,geometry_name=scene.graph[node]
        mesh=scene.geometry[geometry_name]
        if not len(mesh.faces):continue
        verts=trimesh.transform_points(mesh.vertices,transform)
        wheel=find_wheel(str(node)+"_"+str(geometry_name))
        if wheel:
            wheel_positions[wheel]=verts.mean(axis=0)
        bounds.append(verts)
        ntris+=len(mesh.faces)
        if ntris>limit_triangles:raise ValueError("Triangle budget exceeded")
        material=getattr(getattr(mesh.visual,"material",None),"name","") or ""
        n=np.asarray(mesh.face_normals) @ np.linalg.inv(transform[:3,:3]).T
        uv=getattr(mesh.visual,"uv",None)
        image=getattr(getattr(mesh.visual,"material",None),"image",None)
        tex=np.asarray(image.convert("RGB")) if image is not None else None
        parts.append((verts,np.asarray(mesh.faces),n,
                      str(material).lower(),wheel,uv,tex))
    if set(wheel_positions)!={"lf","rf","lr","rr"}:
        raise ValueError("Required named four wheels absent: "+str(sorted(wheel_positions)))
    points=np.concatenate(bounds)
    xlo,xhi=np.min(points[:,0]),np.max(points[:,0])
    zlo,zhi=np.min(points[:,2]),np.max(points[:,2])
    ylo,yhi=np.min(points[:,1]),np.max(points[:,1])
    width=xhi-xlo;length=zhi-zlo
    if not (0.8<width<5 and 1.5<length<14):raise ValueError("Invalid car bounds")
    if not(wheel_positions["lf"][0]<0<wheel_positions["rf"][0] and
           wheel_positions["lr"][0]<0<wheel_positions["rr"][0] and
           wheel_positions["lf"][2]<wheel_positions["lr"][2] and
           wheel_positions["rf"][2]<wheel_positions["rr"][2]):
        raise ValueError("GLB wheel orientation inconsistent with GTA")
    # Bounded RGBA texture, respects original width:length proportions.
    scale=min(512/(width*1.10),1840/(length*1.10))
    W=int(math.ceil(width*scale*1.10));H=int(math.ceil(length*scale*1.10))
    if W<128 or H<256:raise ValueError("Rendered sprite below minimum dimensions")
    xmin=xlo-width*.05;zmin=zlo-length*.05
    sx=scale;sy=scale
    screen={"sx":sx,"sy":sy}
    render_bounds=(xmin,xmin+W/sx,zmin,zmin+H/sy)
    polygons=[]
    for verts,faces,normals,material,wheel,uv,tex in parts:
        xy=np.column_stack(((verts[:,0]-xmin)*sx,(verts[:,2]-zmin)*sy)).astype(np.float32)
        for i,face in enumerate(faces):
            pts=xy[face]
            if abs(np.cross(pts[1]-pts[0],pts[2]-pts[0]))*.5<.04:continue
            polygons.append((float(max(verts[face,1])),pts,normals[i],
                             material,wheel,uv[face] if uv is not None else None,tex))
    polygons.sort(key=lambda t:t[0])
    rgba=np.zeros((H,W,4),dtype=np.uint8)
    glass=np.zeros((H,W),dtype=np.uint8)
    for _,pts,n,material,wheel,uv,tex in polygons:
        label=classify(material,wheel)
        shade=float(np.clip(.55+max(0,n[1])*.34+n[0]*.08-n[2]*.11,.32,1.09))
        rgb=np.asarray(PALETTE[label])*shade
        if tex is not None and uv is not None and label not in ("paint","badges"):
            u=float(np.mean(uv[:,0]))%1;v=float(np.mean(uv[:,1]))%1
            rgb=rgb*.60+tex[min(tex.shape[0]-1,int((1-v)*tex.shape[0])),
                             min(tex.shape[1]-1,int(u*tex.shape[1]))]*.40*shade
        color=np.uint8(np.clip(rgb,0,255))
        polygon=np.round(pts).astype(np.int32)
        cv2.fillConvexPoly(rgba,polygon,
                           (int(color[0]),int(color[1]),int(color[2]),255),
                           lineType=cv2.LINE_AA)
        if label=="glass":cv2.fillConvexPoly(glass,polygon,255)
    if not np.any(rgba[:,:,3]):raise ValueError("No rendered triangles")
    mask=cv2.morphologyEx((rgba[:,:,3]>0).astype(np.uint8)*255,
                         cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    rings=vertices_from_contour(mask,64,1.1,screen,render_bounds)
    if not rings or len(rings[0])<6:raise ValueError("No valid exterior outline")
    outline=rings[0]
    glass_rings=vertices_from_contour(glass,96,1.7,screen,render_bounds)[:8]
    def obj(points,prefix):
        return [{"id":f"{prefix}_{i:02d}",**p} for i,p in enumerate(points)]
    def wheel(k):
        xyz=wheel_positions[k]
        # true model-local GTA X=glTF X, GTA Y=-glTF Z
        return {"hudNormalized":{"x":round(float((xyz[0]-(xlo+xhi)/2)/width),6),
                                 "y":round(float((xyz[2]-zlo)/length),6)},
                "center":{"x":round(float(xyz[0]),5),
                          "y":round(float(-xyz[2]),5)}}
    result={
        "schemaVersion":"vh6.vehicle-geometry.v1",
        "model":model,
        "source":{"format":"RPFView GLB 2.0 source render","lod":"High",
                  "gameAsset":"local GTA Enhanced export","meshClassification":"material labels, not semantic body panels"},
        "coordinateSystem":{"source":"RPFView glTF Y-up",
                            "transform":"GTA X=glTF X; GTA Y=-glTF Z; GTA Z=glTF Y",
                            "gtaFront":"+Y",
                            "hudConvention":"front=normalized Y 0; rear=normalized Y 1; left=negative X"},
        "bounds":{"x":[float(xlo),float(xhi)],"y":[float(-zhi),float(-zlo)],"z":[float(ylo),float(yhi)]},
        "dimensions":{"width":round(float(width),5),
                      "length":round(float(length),5),
                      "aspectWidthToLength":round(float(width/length),6)},
        "contour":{"coordinateUnits":"normalized HUD XY; X centered and scaled by full width, Y front=0 rear=1",
                   "winding":"projection-derived",
                   "vertices":obj(outline,"body"),"rasterStepMeters":round(float(1/scale),6),
                   "simplificationToleranceMeters":round(float(1.1/scale),6)},
        "windowRegions":{"classification":"material-derived, not exact glass/window topology",
                         "rings":[obj(r,"window"+str(i)) for i,r in enumerate(glass_rings)]},
        "wheels":{k:wheel(k) for k in ("lf","rf","lr","rr")},
        "deformationMapping":{"source":"Existing VH5 48-probe vehicle-local capture",
                              "probes":[],"vertexAssociations":[]},
        "sourceParts":[],
        "validation":{"contourSelfIntersection":False,
                      "contourVertexCount":len(outline),
                      "meshTriangles":ntris,"glassRingCount":len(glass_rings)}
    }
    dest.mkdir(parents=True,exist_ok=True)
    png=dest/(model+"-shaded.png")
    cv2.imwrite(str(png),cv2.cvtColor(rgba,cv2.COLOR_RGBA2BGRA))
    (dest/(model+".json")).write_text(json.dumps(result,indent=2)+"\n",encoding="utf8")
    return {"model":model,"status":"ok","triangles":ntris,"outline":len(outline),
            "glassRings":len(glass_rings),"pixels":[W,H],
            "inputSha256":hashlib.sha256(source.read_bytes()).hexdigest(),
            "seconds":round(time.time()-started,1)}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source",type=Path,required=True,help="Root holding exported GLBs")
    ap.add_argument("--dest",type=Path,required=True,help="PRIVATE local output directory")
    ap.add_argument("--models",help="Comma-separated specific model names; omit for all")
    ap.add_argument("--max-models",type=int,default=20,help="Limit per run; default 20")
    ap.add_argument("--triangle-limit",type=int,default=180000)
    args=ap.parse_args()
    if not args.source.is_dir():ap.error("Source must be a directory")
    if args.dest.resolve()==args.source.resolve():ap.error("Output must differ from input")
    if args.max_models<1 or args.max_models>200:ap.error("max-models must be 1..200")
    wanted=set(args.models.lower().split(",")) if args.models else None
    reports=[];seen=set()
    for model,path in source_files(args.source):
        if wanted and model not in wanted or model in seen:continue
        seen.add(model)
        try:
            report=process(model,path,args.dest,args.triangle_limit)
            print("PASS",model,report["outline"],"points",report["pixels"],flush=True)
        except Exception as error:
            report={"model":model,"status":"failed","reason":str(error)[:200]}
            print("FAIL",model,report["reason"],flush=True)
        reports.append(report)
        if len(reports)>=args.max_models:break
    args.dest.mkdir(parents=True,exist_ok=True)
    (args.dest/"_vh8-batch-manifest.json").write_text(json.dumps({
        "schemaVersion":"vh8.local-vehicle-batch.v1",
        "proprietaryPayloadPublicDistribution":False,
        "results":reports},indent=2)+"\n",encoding="utf8")
    print(f"Finished: {sum(r['status']=='ok' for r in reports)}/{len(reports)} models")
    if not reports or not any(r["status"]=="ok" for r in reports):raise SystemExit(2)

if __name__=="__main__":main()
