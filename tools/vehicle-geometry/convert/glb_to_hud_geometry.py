"""Extract compact HUD geometry from a RPFView GLB export (stdlib only).

This consumes a user-provided GLB; it does not read or modify GTA archives.
Coordinate transform verified for RPFView buffalo_hi: GTA X=glTF X, GTA Y=-glTF Z,
GTA Z=glTF Y. GTA front is +Y, left is -X.
"""
from __future__ import annotations
import argparse, json, math, struct
from pathlib import Path

COMPONENTS = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}


def read_glb(path):
    raw = Path(path).read_bytes()
    magic, version, total = struct.unpack_from("<4sII", raw)
    if magic != b"glTF" or version != 2 or total != len(raw):
        raise ValueError("invalid GLB 2 header/length")
    offset, doc, binary = 12, None, None
    while offset < len(raw):
        size, kind = struct.unpack_from("<I4s", raw, offset); offset += 8
        chunk = raw[offset:offset+size]; offset += size
        if len(chunk) != size: raise ValueError("truncated GLB chunk")
        if kind == b"JSON": doc = json.loads(chunk.decode("utf-8"))
        elif kind == b"BIN\0": binary = chunk
    if doc is None or binary is None: raise ValueError("GLB requires JSON and BIN chunks")
    if doc.get("asset", {}).get("version") != "2.0": raise ValueError("expected glTF 2.0")
    return doc, binary


def accessor(doc, binary, index):
    a = doc["accessors"][index]
    if "sparse" in a: raise ValueError("sparse accessors are unsupported")
    view = doc["bufferViews"][a["bufferView"]]
    fmt, width = COMPONENTS[a["componentType"]]
    ncomp = {"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16}[a["type"]]
    stride = view.get("byteStride", width*ncomp)
    start = view.get("byteOffset",0)+a.get("byteOffset",0)
    out=[]
    for i in range(a["count"]):
        out.append(struct.unpack_from("<"+fmt*ncomp,binary,start+i*stride))
    return out


def mat4_mul(a,b):
    return [sum(a[r*4+k]*b[k*4+c] for k in range(4)) for r in range(4) for c in range(4)]


def node_matrix(node):
    if "matrix" in node:
        m=node["matrix"]
        return [m[c*4+r] for r in range(4) for c in range(4)]
    t=node.get("translation",[0,0,0]); s=node.get("scale",[1,1,1]); q=node.get("rotation",[0,0,0,1]); x,y,z,w=q
    return [(1-2*(y*y+z*z))*s[0],2*(x*y-z*w)*s[1],2*(x*z+y*w)*s[2],t[0],
            2*(x*y+z*w)*s[0],(1-2*(x*x+z*z))*s[1],2*(y*z-x*w)*s[2],t[1],
            2*(x*z-y*w)*s[0],2*(y*z+x*w)*s[1],(1-2*(x*x+y*y))*s[2],t[2],0,0,0,1]


def iter_primitives(doc,binary):
    materials=[m.get("name",f"material_{i}") for i,m in enumerate(doc.get("materials",[]))]
    nodes=doc.get("nodes",[]); parents={}
    for i,n in enumerate(nodes):
        for c in n.get("children",[]): parents.setdefault(c,[]).append(i)
    roots=[i for i,n in enumerate(nodes) if not parents.get(i)]
    world={}
    def visit(i,parent):
        m=mat4_mul(parent,node_matrix(nodes[i])); world[i]=m
        for c in nodes[i].get("children",[]): visit(c,m)
    ident=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
    for r in roots: visit(r,ident)
    for ni,node in enumerate(nodes):
        if "mesh" not in node: continue
        mesh=doc["meshes"][node["mesh"]]
        label=node.get("name") or mesh.get("name") or f"node_{ni}"
        for pi,p in enumerate(mesh.get("primitives",[])):
            if p.get("mode",4)!=4: continue
            positions=accessor(doc,binary,p["attributes"]["POSITION"])
            m=world.get(ni,ident)
            verts=[]
            for x,y,z,*_ in positions:
                w=m[12]*x+m[13]*y+m[14]*z+m[15]
                xx=m[0]*x+m[1]*y+m[2]*z+m[3]; yy=m[4]*x+m[5]*y+m[6]*z+m[7]; zz=m[8]*x+m[9]*y+m[10]*z+m[11]
                verts.append((xx/w,yy/w,zz/w))
            indices=accessor(doc,binary,p["indices"]) if "indices" in p else [(i,) for i in range(len(verts))]
            ids=[v[0] for v in indices]
            mi=p.get("material",-1); mat=materials[mi] if 0<=mi<len(materials) else "unknown"
            yield {"node":label,"mesh":mesh.get("name",label),"material":mat,"vertices":verts,"indices":ids}


def tri_cells(a,b,c,step,origin):
    pts=[((p[0]-origin[0])/step,(p[1]-origin[1])/step) for p in (a,b,c)]
    xmin=max(0,math.floor(min(p[0] for p in pts))); xmax=math.ceil(max(p[0] for p in pts))
    ymin=max(0,math.floor(min(p[1] for p in pts))); ymax=math.ceil(max(p[1] for p in pts))
    (ax,ay),(bx,by),(cx,cy)=pts; den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
    if abs(den)<1e-12:return
    for y in range(ymin,ymax):
        for x in range(xmin,xmax):
            px,py=x+.5,y+.5
            u=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/den
            v=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/den
            w=1-u-v
            if min(u,v,w)>=-1e-9: yield (x,y)


def loops_from_cells(cells):
    edges=set()
    for x,y in cells:
        candidates=[((x,y),(x+1,y),(x,y-1)),((x+1,y),(x+1,y+1),(x+1,y)),((x+1,y+1),(x,y+1),(x,y+1)),((x,y+1),(x,y),(x-1,y))]
        for a,b,neighbor in candidates:
            if neighbor not in cells: edges.add((a,b))
    starts={}
    for a,b in edges: starts.setdefault(a,[]).append(b)
    loops=[]
    while edges:
        a,b=next(iter(edges)); edges.remove((a,b)); ring=[a,b]; prev=a; cur=b
        while cur!=ring[0]:
            choices=[n for n in starts.get(cur,[]) if (cur,n) in edges]
            if not choices: break
            # Deterministic turn preference, then coordinate.
            def turnkey(n):
                dx1,dy1=cur[0]-prev[0],cur[1]-prev[1]; dx2,dy2=n[0]-cur[0],n[1]-cur[1]
                cross=dx1*dy2-dy1*dx2; dot=dx1*dx2+dy1*dy2
                return (0 if (cross,dot)==(0,1) else 1 if cross>0 else 2 if cross<0 else 3,n)
            nxt=min(choices,key=turnkey); edges.remove((cur,nxt)); prev,cur=cur,nxt; ring.append(cur)
        if len(ring)>=4 and ring[-1]==ring[0]: loops.append(ring[:-1])
    return loops


def area(r):return sum(r[i][0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*r[i][1] for i in range(len(r)))/2


def rdp_open(points,eps):
    if len(points)<3:return points
    a,b=points[0],points[-1]; dx=b[0]-a[0];dy=b[1]-a[1]; den=dx*dx+dy*dy
    best=-1; idx=0
    for i,p in enumerate(points[1:-1],1):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(den or 1)))
        d=math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy))
        if d>best:best=d;idx=i
    if best<=eps:return [a,b]
    return rdp_open(points[:idx+1],eps)[:-1]+rdp_open(points[idx:],eps)


def simplify_closed(r,eps):
    if len(r)<5:return r
    # Anchor at lexicographic minimum and its farthest point so closed RDP is stable.
    k=min(range(len(r)),key=lambda i:r[i]); p=r[k]; j=max(range(len(r)),key=lambda i:(r[i][0]-p[0])**2+(r[i][1]-p[1])**2)
    a=r[k:]+r[:k+1]; m=(j-k)%len(r); b=r[(k+m)%len(r):]+r[:(k+m)%len(r)+1]
    out=rdp_open(a[:m+1],eps)[:-1]+rdp_open(b[:len(r)-m+1],eps)[:-1]
    return out or r


def self_intersects(r):
    def orient(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    n=len(r)
    for i in range(n):
        a,b=r[i],r[(i+1)%n]
        for j in range(i+1,n):
            if j in (i,(i+1)%n) or (j+1)%n in (i,(i+1)%n):continue
            c,d=r[j],r[(j+1)%n]
            if orient(a,b,c)*orient(a,b,d)<0 and orient(c,d,a)*orient(c,d,b)<0:return True
    return False


def point_in_poly(x,y,ring):
    inside=False
    for i,a in enumerate(ring):
        b=ring[(i+1)%len(ring)]
        if ((a[1]>y)!=(b[1]>y)) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    return inside
def convert(path, step=.025, tolerance=.045):
    if step<=0 or tolerance<=0:raise ValueError("step and tolerance must be positive")
    doc,binary=read_glb(path); primitives=list(iter_primitives(doc,binary))
    if not primitives:raise ValueError("no triangle primitives found")
    points=[v for p in primitives for v in p["vertices"]]
    # RPFView named LF/RF wheels verify x<0=left and negative glTF Z=front.
    all_bounds=[[min(p[i] for p in points),max(p[i] for p in points)] for i in range(3)]
    loX,hiX=all_bounds[0]; loY,hiY=-all_bounds[2][1],-all_bounds[2][0]
    origin=(loX, -hiY); # projected grid Y follows GTA +Y (front)
    nx=math.ceil((hiX-loX)/step)+1; ny=math.ceil((hiY-loY)/step)+1
    allcells=set(); glass=set(); parts=[]; wheel_pts={}
    for p in primitives:
        name=(p["node"]+" "+p["mesh"]).lower()
        iswheel="wheel_" in name
        verts=p["vertices"]
        if iswheel:
            key=next((k for k in ("lf","rf","lr","rr") if "wheel_"+k in name),None)
            if key:wheel_pts.setdefault(key,[]).extend(verts)
        parts.append({"node":p["node"],"mesh":p["mesh"],"material":p["material"],"triangleCount":len(p["indices"])//3,"classification":"wheel" if iswheel else ("glass-material part" if "glass" in p["material"].lower() else "unclassified exterior/interior part")})
        if iswheel:continue
        target=glass if "glass" in p["material"].lower() else allcells
        ids=p["indices"]
        for q in range(0,len(ids)-2,3):
            try:a,b,c=(verts[ids[q]],verts[ids[q+1]],verts[ids[q+2]])
            except IndexError as e:raise ValueError("index outside POSITION accessor") from e
            for cell in tri_cells((a[0],-a[2]),(b[0],-b[2]),(c[0],-c[2]),step,origin):
                if 0<=cell[0]<nx and 0<=cell[1]<ny:target.add(cell)
    rings=[]
    for ring in loops_from_cells(allcells):
        world=[(round(origin[0]+x*step,5),round(origin[1]+y*step,5)) for x,y in ring]
        simp=simplify_closed(world,tolerance)
        if not self_intersects(simp):rings.append(simp)
    if not rings:raise ValueError("rasterized body projection produced no valid contour")
    rings.sort(key=lambda r:abs(area(r)),reverse=True); contour=rings[0]
    # Normalize winding to CCW in GTA XY. Front at normalized Y 0; rear at 1.
    if area([(p[0],(hiY-p[1])/(hiY-loY)) for p in contour])<0:contour.reverse()
    # Compare simplified contour to rasterized high-LOD body occupancy at cell centers.
    poly_cells=set()
    for cy in range(ny):
        for cx in range(nx):
            px=origin[0]+(cx+.5)*step; py=origin[1]+(cy+.5)*step
            if point_in_poly(px,py,contour):poly_cells.add((cx,cy))
    intersection=len(allcells & poly_cells); union=len(allcells | poly_cells)
    contour_iou=intersection/union if union else 0.0
    minx,maxx=loX,hiX; rear,front=loY,hiY; length=front-rear
    def norm(p):return {"x":round((p[0]-(loX+hiX)/2)/(hiX-loX),6),"y":round((front-p[1])/length,6)}
    wheel_out={}
    for k,v in sorted(wheel_pts.items()):
        cx=(min(x[0] for x in v)+max(x[0] for x in v))/2; cy=(min(-x[2] for x in v)+max(-x[2] for x in v))/2
        wheel_out[k]={"center":{"x":round(cx,5),"y":round(cy,5)},"hudNormalized":{"x":round((cx-(loX+hiX)/2)/(hiX-loX),6),"y":round((front-cy)/length,6)},"bounds":{"x":[round(min(x[0] for x in v),5),round(max(x[0] for x in v),5)],"y":[round(min(-x[2] for x in v),5),round(max(-x[2] for x in v),5)]}}
    # Reproduce the existing 48-point VH3 layout in this model coordinate frame.
    probe_specs=[]
    def probe(region,x,y,z): probe_specs.append({"id":f"vh3_{len(probe_specs):02d}","region":region,"x":round(x,5),"hudXNormalized":round((x-(loX+hiX)/2)/(hiX-loX),6),"yNormalized":round(y,5),"z":round(z,5)})
    for end,yy in (("front",.04),("rear",.96)):
        for fx in (.2,.5,.8):
            for fz in (.2,.49,.78): probe(end,loX+(hiX-loX)*fx,yy,all_bounds[1][0]+(all_bounds[1][1]-all_bounds[1][0])*fz)
    for side,fx in (("left",.04),("right",.96)):
        for yy in (.14,.38,.62,.86):
            for fz in (.2,.49,.78): probe(side,loX+(hiX-loX)*fx,yy,all_bounds[1][0]+(all_bounds[1][1]-all_bounds[1][0])*fz)
    for yy in (.24,.50,.76):
        for fx in (.32,.68): probe("roof",loX+(hiX-loX)*fx,yy,all_bounds[1][1]*.96)
    associations=[]
    halfwidth=(hiX-loX)/2
    for i,p in enumerate(contour):
        px=norm(p)["x"]; py=norm(p)["y"]
        nearest=min(probe_specs,key=lambda q:(px-q["hudXNormalized"])**2+(py-q["yNormalized"])**2)
        associations.append({"vertexId":f"body_{i:02d}","nearestProbeId":nearest["id"],"probeRegion":nearest["region"],"distanceNormalized":round(math.hypot(px-nearest["hudXNormalized"],py-nearest["yNormalized"]),5)})    # Glass projection rings retained by material, represented as bounding rectangles when fragmented.
    gl_rings=[]
    for r in loops_from_cells(glass):
        if abs(area(r))*step*step < .002:continue
        pts=[(origin[0]+x*step,origin[1]+y*step) for x,y in r]
        simple=simplify_closed(pts,tolerance)
        if len(simple)>=3 and not self_intersects(simple):
            if area([(p[0],(front-p[1])/length) for p in simple])<0:simple.reverse()
            gl_rings.append([{"id":f"window_{len(gl_rings):02d}_{idx:02d}",**norm(p)} for idx,p in enumerate(simple)])
    return {"schemaVersion":"vh6.vehicle-geometry.v1","model":"buffalo","source":{"format":"RPFView GLB 2.0 export","lod":"High","gameAsset":"x64e.rpf/levels/gta5/vehicles.rpf/buffalo_hi.yft","meshClassification":"wheels identified by source node names; remaining material/mesh nodes retained as ambiguous; no semantic body panels inferred"},"coordinateSystem":{"source":"RPFView glTF, Y-up","transform":"GTA local X=glTF X; GTA local Y=-glTF Z; GTA local Z=glTF Y","gtaFront":"+Y","hudConvention":"front=normalized Y 0; rear=normalized Y 1; left=negative X"},"bounds":{"x":all_bounds[0],"y":[round(rear,6),round(front,6)],"z":[all_bounds[1][0],all_bounds[1][1]]},"dimensions":{"width":round(hiX-loX,5),"length":round(length,5),"aspectWidthToLength":round((hiX-loX)/length,5)},"contour":{"coordinateUnits":"normalized HUD XY; X centered and scaled by full width, Y front=0 rear=1","winding":"counterclockwise","vertices":[{"id":f"body_{i:02d}",**norm(p)} for i,p in enumerate(contour)],"rasterStepMeters":step,"simplificationToleranceMeters":tolerance,"discardedComponents":len(rings)-1},"windowRegions":{"classification":"material-name projection only; not semantic cabin polygons","materialMatchedNodeCount":sum("glass" in p["material"].lower() for p in primitives),"rings":gl_rings},"wheels":wheel_out,"deformationMapping":{"source":"VH3 VehicleDeformationGrid.Build 48-point layout","probes":probe_specs,"vertexAssociations":associations,"panelBoundaries":"Not inferred: source drawable names/materials do not identify hood, trunk, doors or fenders."},"sourceParts":parts,"validation":{"contourSelfIntersection":False,"contourVertexCount":len(contour),"projectionCellCount":len(allcells),"glassProjectionCellCount":len(glass),"rasterContourIoU":round(contour_iou,6)}}


def write_svg(data,path):
    pts=data["contour"]["vertices"]; w,h=600,900; margin=30
    width=data["dimensions"]["width"]; length=data["dimensions"]["length"]
    scale=min((w-2*margin)/width,(h-2*margin)/length)
    def xy(p):return (w/2+p["x"]*width*scale,h/2+(p["y"]-.5)*length*scale)
    poly=" ".join(f"{x:.1f},{y:.1f}" for x,y in map(xy,pts))
    cabins=[]
    for r in data["windowRegions"]["rings"]:
        cabins.append("<polygon points=\""+" ".join(f"{x:.1f},{y:.1f}" for x,y in map(xy,r))+"\" fill=\"#48a9d8\" fill-opacity=\".35\" stroke=\"#78d4ff\" stroke-width=\"2\"/>")
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="100%" height="100%" fill="#111820"/><text x="300" y="24" text-anchor="middle" fill="white" font-family="sans-serif">Buffalo extracted contour — front ↑</text><polygon points="{poly}" fill="#617584" stroke="#e7f0f4" stroke-width="3"/>{"".join(cabins)}'
    for key,v in data["wheels"].items():
        x,y=xy(v["hudNormalized"]);svg+=f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="#ffb347"/><text x="{x+10:.1f}" y="{y:.1f}" fill="white" font-family="sans-serif" font-size="13">{key.upper()}</text>'
    svg+='</svg>';Path(path).write_text(svg,encoding="utf-8")


def main():
    ap=argparse.ArgumentParser();ap.add_argument("input");ap.add_argument("--json",required=True);ap.add_argument("--svg");ap.add_argument("--step",type=float,default=.025);ap.add_argument("--tolerance",type=float,default=.045);a=ap.parse_args()
    d=convert(a.input,a.step,a.tolerance);Path(a.json).write_text(json.dumps(d,indent=2)+chr(10),encoding="utf-8")
    if a.svg:write_svg(d,a.svg)
    print(json.dumps({"vertices":d["validation"]["contourVertexCount"],"triangles":sum(p["triangleCount"] for p in d["sourceParts"]),"wheels":sorted(d["wheels"]),"dimensions":d["dimensions"]},indent=2))
if __name__=="__main__":main()
