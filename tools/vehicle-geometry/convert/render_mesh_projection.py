import json, math
from pathlib import Path
from glb_to_hud_geometry import read_glb, iter_primitives, tri_cells

PALETTE={"vehicle_paint1":"#718494","vehicle_vehglass":"#31b5e8","vehicle_vehglass_inner":"#7fd8f0","vehicle_tire":"#15191e","vehicle_lightsemissive":"#f4c95d","vehicle_mesh":"#9aa8b2","vehicle_interior2":"#52616d","vehicle_shuts":"#64717b"}

def write_mesh_projection(glb,out,step=.04):
    doc,binary=read_glb(glb); prims=list(iter_primitives(doc,binary)); pts=[v for p in prims for v in p["vertices"]]
    xmin=min(v[0] for v in pts); xmax=max(v[0] for v in pts); ys=[-v[2] for v in pts]; ymin=min(ys); ymax=max(ys)
    origin=(xmin,ymin); nx=math.ceil((xmax-xmin)/step)+1;ny=math.ceil((ymax-ymin)/step)+1; cells={}
    for p in prims:
        ids=p["indices"];v=p["vertices"];color=PALETTE.get(p["material"],"#89959e")
        for i in range(0,len(ids)-2,3):
            a,b,c=(v[ids[i]],v[ids[i+1]],v[ids[i+2]])
            for cell in tri_cells((a[0],-a[2]),(b[0],-b[2]),(c[0],-c[2]),step,origin):
                if 0<=cell[0]<nx and 0<=cell[1]<ny:cells[cell]=color
    W,H=700,930;m=35;scale=min((W-2*m)/(xmax-xmin),(H-2*m)/(ymax-ymin)); px=lambda x:m+(x-xmin)*scale; py=lambda y:m+(ymax-y)*scale
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="#111820"/><text x="350" y="22" text-anchor="middle" fill="white" font-family="sans-serif" font-size="16">Stock Buffalo High LOD — top-down mesh projection</text>']
    for (x,y),color in cells.items():parts.append(f'<rect x="{px(xmin+x*step):.2f}" y="{py(ymin+y*step):.2f}" width="{step*scale+.2:.2f}" height="{step*scale+.2:.2f}" fill="{color}"/>')
    parts.append(f'<text x="350" y="{H-10}" text-anchor="middle" fill="#d6e0e5" font-family="sans-serif">Front ↑ • GTA-local left = negative X • material-colored projection</text></svg>')
    Path(out).write_text("".join(parts),encoding="utf-8")

if __name__=="__main__":
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument("glb");ap.add_argument("out");a=ap.parse_args();write_mesh_projection(a.glb,a.out)
