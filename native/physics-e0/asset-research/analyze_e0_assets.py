"""Derive auditable, unverified game ray candidates from CodeWalker YBN XML.

Standard library only. No live-game claims; no proprietary payloads in Git.
Box decoding follows upstream BoundGeometry.RayIntersect's four-vertex formula.
"""
import argparse
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path


def add(a, b): return tuple(x + y for x, y in zip(a, b))
def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def mul(a, k): return tuple(x * k for x in a)
def dot(a, b): return sum(x * y for x, y in zip(a, b))
def norm(a): return math.sqrt(dot(a, a))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def unit(a): return mul(a, 1/norm(a))
def vec(e): return tuple(float(e.attrib[k]) for k in ('x', 'y', 'z'))


IDENTITY = [[int(i == j) for j in range(4)] for i in range(4)]


def matrix(e):
    text = e.findtext('CompositeTransform')
    if text is None: return IDENTITY
    v = list(map(float, text.split()))
    if len(v) != 16: raise ValueError('Invalid CompositeTransform')
    return [v[i:i+4] for i in range(0, 16, 4)]


def transform(p, chain):
    for m in chain:
        p = tuple(sum(p[i]*m[i][j] for i in range(3)) + m[3][j] for j in range(3))
    return p


def materials(path):
    rows = []
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        tok = line.split()
        if len(tok) >= 20 and re.fullmatch(r'[A-Z][A-Z0-9_]*', tok[0]):
            rows.append(tok[0])
    if rows[:2] != ['DEFAULT', 'CONCRETE']: raise ValueError('Unexpected material table ordering')
    return rows


def primitives(root, asset):
    def walk(e, chain=(), address='Bounds'):
        chain = (matrix(e),) + chain
        verts = e.findtext('Vertices')
        if verts:
            center = vec(e.find('GeometryCenter'))
            points = [transform(add(tuple(map(float, row.split(','))), center), chain)
                      for row in verts.splitlines() if row.strip()]
            mats = e.findall('Materials/Item')
            for i, poly in enumerate(e.find('Polygons')):
                mi = int(poly.attrib['m'])
                mt = int(mats[mi].find('Type').attrib['value'])
                flags = mats[mi].findtext('Flags')
                ref = dict(asset=asset, bound=address, polygonIndex=i,
                           primitive=poly.tag, materialSlot=mi, materialIndex=mt, flags=flags)
                if poly.tag == 'Triangle':
                    a,b,c = [points[int(poly.attrib[k]) & 0x7fff] for k in ('v1','v2','v3')]
                    n = cross(sub(b,a), sub(c,a)); area=norm(n)/2
                    if area > 0.05:
                        yield dict(ref, center=mul(add(add(a,b),c), 1/3), normal=unit(n), area=area)
                elif poly.tag == 'Box':
                    p1,p2,p3,p4 = [points[int(poly.attrib[k])] for k in ('v1','v2','v3','v4')]
                    a1=mul(sub(add(p3,p4),add(p1,p2)), .5)
                    axes=[a1, sub(p3,add(p1,a1)), sub(p4,add(p1,a1))]
                    lengths=list(map(norm, axes))
                    if min(lengths) < .001: continue
                    axes=list(map(unit,axes))
                    # Reject skewed encodings rather than infer a rectangular wall.
                    if max(abs(dot(axes[j],axes[k])) for j,k in ((0,1),(0,2),(1,2))) > .005: continue
                    center=mul(add(add(p1,p2),add(p3,p4)), .25)
                    yield dict(ref,center=center,axes=axes,dimensionsM=lengths)
        for i, child in enumerate(e.findall('Children/Item')):
            yield from walk(child,chain,address+f'/Children/Item[{i}]')
    yield from walk(root.find('Bounds'))


def main():
    ap=argparse.ArgumentParser();ap.add_argument('staging',type=Path);args=ap.parse_args()
    stage=args.staging
    manifest=json.loads((stage/'manifest.json').read_text(encoding='utf-8-sig'))
    for asset in manifest['assets']:
        assert hashlib.sha256((stage/asset['file']).read_bytes()).hexdigest()==asset['sha256'], asset['file']
        if asset.get('xml'):
            assert hashlib.sha256((stage/asset['xml']).read_bytes()).hexdigest()==asset['xmlSha256']
    table_path=stage/'assets/common.rpf/data/materials/materials.dat'
    table=materials(table_path)
    allp=[]
    for asset in manifest['assets']:
        if re.search(r'\\(?:hi@|ma@)?(?:hei_)?dt1_19_0\.ybn$', asset['originalPath']) and asset.get('xml'):
            allp.extend(primitives(ET.parse(stage/asset['xml']).getroot(), asset['originalPath']))
    surfaces=[]; walls=[]
    for p in allp:
        p['materialNameFromBaseTable']=table[p['materialIndex']] if p['materialIndex']<len(table) else None
        if p['primitive']=='Triangle':
            surfaces.append(dict(p,point=p['center']))
        else:
            for j,(axis,length) in enumerate(zip(p['axes'],p['dimensionsM'])):
                surfaces.append(dict(p,point=add(p['center'],mul(axis,length/2)),normal=axis,faceAxis=j))
            dims=p['dimensionsM'];axes=p['axes']
            j=min(range(3),key=lambda i:dims[i])
            hard = p['materialNameFromBaseTable'] in {'CONCRETE','CONCRETE_DUSTY','BRICK','STONE','MARBLE','METAL_SOLID_SMALL','METAL_SOLID_MEDIUM','METAL_SOLID_LARGE','METAL_HOLLOW_SMALL','METAL_HOLLOW_MEDIUM','METAL_HOLLOW_LARGE','WOOD_SOLID_SMALL','WOOD_SOLID_MEDIUM','WOOD_SOLID_LARGE','WOOD_HOLLOW_SMALL','WOOD_HOLLOW_MEDIUM','WOOD_HOLLOW_LARGE'}
            if hard and .05 <= dims[j] <= 1.5 and abs(axes[j][2])<.15 and max(dims)>=1.5 and sorted(dims)[1]>=.8:
                n=axes[j];d=dims[j];c=p['center']
                walls.append(dict(p,normal=n,encodedPrimitiveThicknessM=d,
                                  faceA=add(c,mul(n,-d/2)),faceB=add(c,mul(n,d/2)),
                                  rayFrom=add(c,mul(n,-d/2-.5)),rayTo=add(c,mul(n,d/2+.5)),
                                  insidePoint=c,measurementStatus='OFFLINE_BOX_DIMENSION_MEASURED',
                                  wallIdentityAndAccessibility='UNVERIFIED_CANDIDATE'))
    # Prefer base region sources to avoid silently mixing mutually exclusive IPL variants.
    def rank(p): return (not p['asset'].startswith('x64i.rpf'),p['asset'],p['bound'],p['polygonIndex'])
    surfaces.sort(key=rank);walls.sort(key=rank)
    chosen=[];used=set();types=set()
    def distinct(p, pool, field, distance):
        return all(norm(sub(p[field],q[field]))>distance for q in pool)
    for diverse in (True,False):
        for p in surfaces:
            key=(p['asset'],p['bound'],p['polygonIndex'],p.get('faceAxis'))
            if key in used or (diverse and p['materialIndex'] in types): continue
            if not distinct(p,chosen,'point',.75): continue
            p=dict(p,rayFrom=add(p['point'],mul(p['normal'],.5)),rayTo=add(p['point'],mul(p['normal'],-.1)),
                   status='UNVERIFIED_GAME_RAY_CANDIDATE',geometryStatus='DECODED_SOURCE_PRIMITIVE')
            chosen.append(p);used.add(key);types.add(p['materialIndex'])
            if len(chosen)==200: break
        if len(chosen)==200: break
    wallsel=[]
    walltypes=set()
    for diverse in (True,False):
        for p in walls:
            if diverse and p['materialIndex'] in walltypes: continue
            if distinct(p,wallsel,'center',2):
                wallsel.append(p);walltypes.add(p['materialIndex'])
            if len(wallsel)==100: break
        if len(wallsel)==100: break
    out=dict(schemaVersion=1,coordinateSystem='Original GTA coordinates, Z up, nominal metres',
             status='CANDIDATES_ONLY_NOT_E0_ACCEPTANCE',
             method='Vertices + GeometryCenter, then row-vector CompositeTransform chain. Box dimensions follow CodeWalker BoundGeometry.RayIntersect. Ray offsets are proposed probe design, not observations.',
             limitations=['No engine raycasts performed.','No loaded IPL/DLC/mod precedence established.',
                          'Box thickness excludes collision margin and adjacent/overlapping primitives.',
                          'Wall-like dimensions do not establish building-wall identity, walk-up access, or unobstructed ray.',
                          '30 surfaces does not imply 30 distinct material types.',
                          'Material names use base materials.dat row ordering; other tables and mod override are retained for comparison.',
                          'Triangle normals follow source winding; face visibility and blocking remain unverified.'],
             materialTable=dict(file='assets/common.rpf/data/materials/materials.dat',rows=len(table)),
             counts=dict(decodedPrimitives=len(allp),uniqueMaterialIndicesAvailable=len({p['materialIndex'] for p in allp}),
                         surfaceCandidates=min(30,len(chosen)),surfaceMaterialTypes=len({p['materialIndex'] for p in chosen[:30]}),wallCandidates=min(10,len(wallsel)),wallMaterialTypes=len({p['materialIndex'] for p in wallsel[:10]})),
             surfaces=chosen[:30],walls=wallsel[:10],candidatePool=dict(surfaces=chosen,walls=wallsel))
    (stage/'candidates.json').write_text(json.dumps(out,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps(out['counts']))


if __name__=='__main__': main()
