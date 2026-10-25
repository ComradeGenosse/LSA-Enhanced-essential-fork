#!/usr/bin/env python3
"""VH9 PRIVATE preview: connected UV triangles over an owner's local VH8 PNG.

Usage (from repository root):
  python tools/vehicle-deformation/vh9_connected_mesh.py \
    --sprite C:/private/buffalo-shaded.png --geometry C:/private/buffalo.json \
    --before C:/private/baseline.csv --after C:/private/damaged.csv \
    --out C:/private/vh9-buffalo-damaged.png
Synthetic illustration (never treated as real GTA measurements):
  ... --synthetic front-left --out C:/private/vh9-synthetic.png

No Rockstar game source or derived sprites are bundled with this tool.
No GTA DLL, native reads, or FrameRender changes. Bad evidence fails closed.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Probe:
    x: float  # normalized full-width X, centered on 0
    y: float  # normalized length Y; 0 is GTA front, 1 is rear
    dx: float # normalized lateral displacement
    dy: float # normalized length displacement, positive toward rear
    region: str
    meters: float


def load_geometry(path: Path, model: str | None = None) -> dict:
    if path.stat().st_size > 262144:
        raise ValueError('Geometry exceeds 256 KiB')
    obj = json.loads(path.read_text(encoding='utf-8-sig'))
    if obj.get('schemaVersion') != 'vh6.vehicle-geometry.v1':
        raise ValueError('Unsupported VH8 geometry schema')
    if model is not None and obj.get('model', '').lower() != model.lower():
        raise ValueError('Geometry model does not match VH3 capture')
    cs = obj.get('coordinateSystem', {})
    if cs.get('gtaFront') != '+Y':
        raise ValueError('Unexpected GTA model orientation')
    dims = obj['dimensions']
    w, l = float(dims['width']), float(dims['length'])
    if not (0.8 < w < 6.0 and 1.5 < l < 18.0):
        raise ValueError('Invalid model dimensions')
    verts = obj['contour']['vertices']
    if not (6 <= len(verts) <= 64):
        raise ValueError('Invalid exterior contour')
    for v in verts:
        x, y = float(v['x']), float(v['y'])
        if not (math.isfinite(x) and math.isfinite(y) and -.65 <= x <= .65 and -.06 <= y <= 1.06):
            raise ValueError('Nonfinite or out-of-bounds contour')
    return obj


def _read_capture(path: Path) -> list[dict]:
    with path.open(newline='', encoding='utf-8-sig') as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 48:
        raise ValueError(f'{path.name}: expected 48 VH3 probes')
    try:
        rows.sort(key=lambda r: int(r['index']))
        if [int(r['index']) for r in rows] != list(range(48)):
            raise ValueError('Non-unique probe indices')
    except (KeyError, TypeError) as e:
        raise ValueError('Invalid probe index') from e
    return rows


def read_real_probes(before: Path, after: Path, geo: dict) -> tuple[list[Probe], dict]:
    a, b = _read_capture(before), _read_capture(after)
    for field in ('capture_id', 'model', 'handle'):
        if a[0][field] != b[0][field]:
            raise ValueError(f'VH3 {field} mismatch')
    if a[0]['phase'] != 'baseline' or b[0]['phase'] != 'damaged':
        raise ValueError('VH3 files must be baseline then damaged')
    if a[0]['model'].lower() != geo['model'].lower():
        raise ValueError('Model does not match local asset')
    for field in ('min_x', 'min_y', 'max_x', 'max_y', 'min_z', 'max_z'):
        if abs(float(a[0][field]) - float(b[0][field])) > .001:
            raise ValueError('VH3 bounds changed between captures')
    minx, maxx = float(a[0]['min_x']), float(a[0]['max_x'])
    miny, maxy = float(a[0]['min_y']), float(a[0]['max_y'])
    width, length = maxx-minx, maxy-miny
    if not (.8 < width < 6 and 1.5 < length < 18):
        raise ValueError('Invalid native bounds')
    dw, dl = float(geo['dimensions']['width']), float(geo['dimensions']['length'])
    if abs(dw / width - 1) > .32 or abs(dl / length - 1) > .32:
        raise ValueError('Native/asset dimensions disagree')
    out = []
    comparable, changed = 0, 0
    for ar, br in zip(a, b):
        if ar['region'] != br['region']:
            raise ValueError('VH3 probe region changed')
        for axis in ('sample_x', 'sample_y', 'sample_z'):
            if abs(float(ar[axis]) - float(br[axis])) > .001:
                raise ValueError('VH3 sample coordinates changed')
        if ar.get('valid') != '1' or br.get('valid') != '1':
            continue
        try:
            vals = [float(row[key]) for row in (ar, br) for key in ('dx','dy','dz')]
            sx, sy = float(ar['sample_x']), float(ar['sample_y'])
        except (ValueError, KeyError):
            continue
        if not all(map(math.isfinite, vals + [sx, sy])):
            continue
        comparable += 1
        dxm, dym, dzm = (vals[3]-vals[0], vals[4]-vals[1], vals[5]-vals[2])
        mag = math.sqrt(dxm*dxm + dym*dym + dzm*dzm)
        if mag > 1.0:
            raise ValueError('Implausible VH3 displacement (>1m)')
        if mag >= .025:
            changed += 1
        if mag >= .025 and (abs(dxm) + abs(dym)) >= .012:
            out.append(Probe((sx-(minx+maxx)*.5)/width,
                             (maxy-sy)/length, dxm/width, -dym/length,
                             str(ar['region']), mag))
    evidence = {'kind':'real_vh3', 'comparable':comparable, 'changed':changed,
                'usable_xy':len(out), 'model':geo['model']}
    if comparable < 36 or changed < 3 or len(out) < 3:
        raise ValueError('Insufficient measured VH3 evidence: '+json.dumps(evidence))
    return out, evidence


def synthetic_probes(which: str) -> tuple[list[Probe], dict]:
    # Visual regression/demo ONLY. Coordinates and vectors are invented.
    impacts = {'front-left':(-.35,.09,.035,.052),
               'side':(-.43,.48,.045,.004),
               'rear':(.10,.93,-.006,-.052)}
    tx, ty, vx, vy = impacts[which]
    data = []
    for x in np.linspace(-.43,.43,8):
        for y in np.linspace(.07,.93,6):
            fall = math.exp(-.5*((x-tx)/.12)**2-.5*((y-ty)/.14)**2)
            if fall > .09:
                data.append(Probe(float(x),float(y),vx*fall,vy*fall,'synthetic',.25*fall))
    return data, {'kind':'synthetic_not_gta', 'comparable':48, 'changed':len(data),
                  'usable_xy':len(data), 'impact':which}


def poly_pixels(points: list[dict], width: int, height: int) -> np.ndarray:
    # VH8 rasterizer puts 5% padding around model bounds on each side.
    # Convert full-bounds normalized positions into that private PNG frame.
    return np.array([[((float(v['x'])+.55)/1.1)*(width-1),
                      ((float(v['y'])+.05)/1.1)*(height-1)]
                     for v in points], dtype=np.float32)


def field(mesh: np.ndarray, probes: list[Probe], geometry: dict,
          width: int, height: int) -> np.ndarray:
    xy = np.empty_like(mesh)
    xy[:,0] = mesh[:,0]/(width-1)*1.1-.55
    xy[:,1] = mesh[:,1]/(height-1)*1.1-.05
    pos = np.array([[p.x,p.y] for p in probes], dtype=np.float32)
    delta = np.array([[p.dx,p.dy] for p in probes], dtype=np.float32)
    # Weighted, non-normalizing interpolation decays to zero far from impact.
    # This avoids the previous broad whole-body distortion.
    distance = (xy[:,None,:]-pos[None,:,:]) / np.array([.12,.14])
    influence = np.exp(-.5*np.sum(distance*distance, axis=2))
    magnitude = influence.sum(axis=1)
    motion = (influence @ delta) / np.maximum(1.0,magnitude[:,None])
    contour = poly_pixels(geometry['contour']['vertices'],width,height)
    # Do not move the transparent surround or dramatically change car bounds.
    inside = np.array([cv2.pointPolygonTest(contour,(float(x),float(y)),False)>=0
                       for x,y in mesh],dtype=bool)
    motion[~inside] = 0
    # Retain rigid glazing and wheel regions as actual anchors, not fake dents.
    window = geometry.get('windowRegions',{})
    for ring in window.get('rings',[])[:8]:
        if len(ring) < 3:continue
        polygon = poly_pixels(ring,width,height)
        rigid = np.array([cv2.pointPolygonTest(polygon,(float(x),float(y)),False)>=0
                          for x,y in mesh],dtype=bool)
        motion[rigid] *= .24
    for name in ('lf','rf','lr','rr'):
        try:
            p=geometry['wheels'][name]['hudNormalized']
            x,y=float(p['x']),float(p['y'])
        except (KeyError, TypeError):
            continue
        rad = ((xy[:,0]-x)/.07)**2 + ((xy[:,1]-y)/.045)**2
        motion *= (1 - .68*np.exp(-.5*rad))[:,None]
    # Hard bound local movement: no whole-car translation or huge shears.
    norm = np.linalg.norm(motion,axis=1)
    motion *= np.minimum(1., .075/np.maximum(norm,1e-8))[:,None]
    pixel = np.column_stack((motion[:,0]*(width-1)/1.1,
                             motion[:,1]*(height-1)/1.1))
    return pixel.astype(np.float32)


def connected_grid(width: int,height: int) -> tuple[np.ndarray,np.ndarray]:
    nx = max(16,min(48,round(width/19)))
    ny = max(24,min(100,round(height/20)))
    xs=np.linspace(0,width-1,nx+1,dtype=np.float32)
    ys=np.linspace(0,height-1,ny+1,dtype=np.float32)
    xx,yy=np.meshgrid(xs,ys)
    verts=np.column_stack((xx.ravel(),yy.ravel()))
    tris=[]
    for iy in range(ny):
        for ix in range(nx):
            a=iy*(nx+1)+ix;b=a+1;c=a+nx+1;d=c+1
            tris.extend(((a,b,d),(a,d,c)))
    return verts,np.asarray(tris,dtype=np.int32)


def signed_areas(vertices:np.ndarray,tris:np.ndarray) -> np.ndarray:
    v=vertices[tris]
    a,b,c=v[:,0],v[:,1],v[:,2]
    return .5*((b[:,0]-a[:,0])*(c[:,1]-a[:,1])-
               (b[:,1]-a[:,1])*(c[:,0]-a[:,0]))


def safety(src:np.ndarray,dst:np.ndarray,tris:np.ndarray,
           max_ratio:float=1.52) -> tuple[bool,str]:
    a0,a1=signed_areas(src,tris),signed_areas(dst,tris)
    if (np.any(~np.isfinite(a1)) or np.any(a1 <= a0*.32) or
        np.any(a1 >= a0*1.75)):
        return False,'foldover_or_bad_triangle_area'
    t0,t1=src[tris],dst[tris]
    for axis0,axis1 in ((0,1),(1,2),(2,0)):
        original=np.linalg.norm(t0[:,axis0]-t0[:,axis1],axis=1)
        updated=np.linalg.norm(t1[:,axis0]-t1[:,axis1],axis=1)
        if np.any(updated > original*max_ratio) or np.any(updated < original/max_ratio):
            return False,'bad_edge_stretch'
    return True,'pass'


def solve(geometry:dict,probes:list[Probe],width:int,height:int) -> tuple[np.ndarray,np.ndarray,dict]:
    if not probes:
        raise ValueError('No probe displacement to solve')
    src,tris=connected_grid(width,height)
    motion=field(src,probes,geometry,width,height)
    if np.max(np.linalg.norm(motion,axis=1)) < .3:
        raise ValueError('No measurable motion after geometry constraints')
    for strength in (1.,.8,.6,.4,.25):
        dst=src+motion*strength
        valid,reason=safety(src,dst,tris)
        if valid:
            return src,dst,{'triangles':len(tris),'vertices':len(src),
                            'strength':strength,'safety':'pass',
                            'max_pixel_shift':round(float(np.max(np.linalg.norm(motion*strength,axis=1))),2)}
    raise ValueError('Refusing mesh deformation: '+reason)


def warp_image(image:np.ndarray,src:np.ndarray,dst:np.ndarray,tris:np.ndarray) -> np.ndarray:
    h,w=image.shape[:2]
    # Inverse texture mapping: shared triangle vertices => seamless connected UVs.
    # Each pixel is assigned from the ORIGINAL source texture, never from a
    # previously warped tile. Black/transparent gaps outside the image stay clear.
    yy,xx=np.mgrid[0:h,0:w]
    mapx=xx.astype(np.float32);mapy=yy.astype(np.float32)
    for indices in tris:
        d=dst[indices];s=src[indices]
        x0=max(0,int(math.floor(float(np.min(d[:,0])))))
        x1=min(w-1,int(math.ceil(float(np.max(d[:,0])))))
        y0=max(0,int(math.floor(float(np.min(d[:,1])))))
        y1=min(h-1,int(math.ceil(float(np.max(d[:,1])))))
        if x0>x1 or y0>y1:continue
        x,y=np.meshgrid(np.arange(x0,x1+1),np.arange(y0,y1+1))
        denom=((d[1,1]-d[2,1])*(d[0,0]-d[2,0])+
               (d[2,0]-d[1,0])*(d[0,1]-d[2,1]))
        if abs(denom)<.0001:raise ValueError('Degenerate triangle during mapping')
        u=((d[1,1]-d[2,1])*(x-d[2,0])+(d[2,0]-d[1,0])*(y-d[2,1]))/denom
        v=((d[2,1]-d[0,1])*(x-d[2,0])+(d[0,0]-d[2,0])*(y-d[2,1]))/denom
        mask=(u>=-1e-5)&(v>=-1e-5)&(u+v<=1.00001)
        samplex=s[2,0]+u*(s[0,0]-s[2,0])+v*(s[1,0]-s[2,0])
        sampley=s[2,1]+u*(s[0,1]-s[2,1])+v*(s[1,1]-s[2,1])
        mapx[y0:y1+1,x0:x1+1][mask]=samplex[mask]
        mapy[y0:y1+1,x0:x1+1][mask]=sampley[mask]
    return cv2.remap(image,mapx,mapy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,
                     borderValue=(0,0,0,0))


def render(sprite:Path,geometry:Path,output:Path,
           before:Path|None=None,after:Path|None=None,synthetic:str|None=None) -> dict:
    if sprite.stat().st_size>4194304:raise ValueError('Sprite larger than 4MiB')
    with Image.open(sprite) as im:
        if im.width<128 or im.height<256 or im.width*im.height>3000000:
            raise ValueError('Invalid sprite dimensions')
        rgba=np.asarray(im.convert('RGBA'))
    geo=load_geometry(geometry)
    if synthetic:
        probes,evidence=synthetic_probes(synthetic)
    elif before is not None and after is not None:
        probes,evidence=read_real_probes(before,after,geo)
    else:
        raise ValueError('Provide matching --before and --after, or --synthetic')
    h,w=rgba.shape[:2]
    src,dst,report=solve(geo,probes,w,h)
    _,triangles=connected_grid(w,h)
    output.parent.mkdir(parents=True,exist_ok=True)
    dstimg=warp_image(rgba,src,dst,triangles)
    Image.fromarray(dstimg,'RGBA').save(output)
    result={**evidence,**report,'output':str(output),'renderer':'connected_shared_uv_triangles',
            'in_game_enabled':False}
    output.with_suffix('.vh9.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sprite',type=Path,required=True)
    parser.add_argument('--geometry',type=Path,required=True)
    parser.add_argument('--before',type=Path)
    parser.add_argument('--after',type=Path)
    parser.add_argument('--synthetic',choices=['front-left','side','rear'])
    parser.add_argument('--out',type=Path,required=True)
    opts=parser.parse_args()
    if opts.synthetic and (opts.before or opts.after):
        parser.error('Synthetic mode and VH3 captures are mutually exclusive')
    if not opts.synthetic and not (opts.before and opts.after):
        parser.error('Both VH3 CSV captures are required for real deformation')
    print(json.dumps(render(opts.sprite,opts.geometry,opts.out,
                            opts.before,opts.after,opts.synthetic),indent=2))


if __name__=='__main__':
    main()
