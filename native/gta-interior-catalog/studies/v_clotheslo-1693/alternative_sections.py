"""Read-only fixed-section checks against reviewed private #320 geometry.

Outputs derived identities, measures and coordinates, never mesh payloads.
This is offline feasibility, not an exported patch or runtime acceptance.
"""
import hashlib
import json
import os
from pathlib import Path

import numpy as np
from scipy.spatial import ConvexHull
import geometry as g
from geometry_math import box_faces, clip_triangle, ray_hits


def entity_set_triangles(path):
    """Include every archived set alternative; do not assume its activation."""
    rows = [json.loads(line) for line in Path(path).open()]
    if any(r['kind'] in ('error','collision_error') for r in rows):
        raise ValueError('incomplete entity-set extraction')
    triangles, coverage, solids, unsupported = [], [], [], []
    for mlo in g.mlos:
        for entity_set in mlo['sets']:
            for index, en in enumerate(entity_set['entities']):
                name = en['name']
                q = np.array(en['rot']); q[:3] *= -1
                def transform(points):
                    return (np.asarray(points)*[en['scaleXY'], en['scaleXY'], en['scaleZ']])@g.rot(q).T+en['pos']
                meshes = [r for r in rows if r['kind']=='mesh' and g.name(r['file'])==name]
                bounds = [r for r in rows if r['kind']=='polys' and g.name(r['file'])==name]
                leaves = [r for r in rows if r['kind']=='bound' and g.name(r['file'])==name
                          and r['type'] not in ('BoundComposite','BoundGeometry','BoundGeometryBVH')]
                coverage.append({'definition':mlo['file'],'set':entity_set['Name'],
                                 'entityIndex':index,'name':name,'meshGroups':len(meshes),
                                 'polygonGroups':len(bounds),'leafTypes':sorted({b['type'] for b in leaves})})
                for bound in leaves:
                    pts = np.array([[a,b,c] for a in [bound['min'][0],bound['max'][0]]
                                    for b in [bound['min'][1],bound['max'][1]]
                                    for c in [bound['min'][2],bound['max'][2]]])
                    matrix = np.array([[bound['transform'][f'M{i}{j}'] for j in range(1,5)] for i in range(1,5)])
                    pts = transform((np.c_[pts,np.ones(8)]@matrix)[:,:3])
                    ident = {'kind':'collision','file':bound['file'],'name':name,
                             'entityIndex':index,'set':entity_set['Name'],'definition':mlo['file'],
                             'child':bound['child'],'primitive':bound['type'],'id':-1}
                    if bound['type'] != 'BoundBox':
                        unsupported.append((ident,pts))
                        continue
                    solids.append((ident,pts))
                    for ids in ConvexHull(pts).simplices:
                        triangles.append({**ident,'local':pts[ids]})
                for mesh in meshes:
                    points = transform(mesh['points'])
                    for pid, ids in enumerate(np.asarray(mesh['indices']).reshape(-1,3)):
                        triangles.append({'kind':'mesh','file':mesh['file'],'name':name,
                                          'entityIndex':index,'set':entity_set['Name'],
                                          'definition':mlo['file'],'model':mesh['model'],
                                          'geometry':mesh['geometry'],'id':pid,'local':points[ids]})
                for bound in bounds:
                    for polygon in bound['polygons']:
                        if polygon['type'] not in ('Triangle','Box'):
                            raise ValueError('unhandled set collision primitive: '+name)
                        points = transform(polygon['points'])
                        faces = box_faces(points) if polygon['type']=='Box' else [points]
                        for face in faces:
                            triangles.append({'kind':'collision','file':bound['file'],'name':name,
                                              'entityIndex':index,'set':entity_set['Name'],
                                              'definition':mlo['file'],'child':bound['child'],
                                              'primitive':polygon['type'],'id':polygon['id'],'local':face})
    if any(r['meshGroups'] == 0 for r in coverage):
        raise ValueError('missing entity-set mesh; clearance is unproven')
    return triangles, coverage, solids, unsupported


def intersections(triangles, low, high):
    groups = {}
    for t in triangles:
        a = t['local']
        if (a.max(0) < low).any() or (a.min(0) > high).any():
            continue
        area = clip_triangle(a, low, high)
        if area < 1e-7:
            continue
        key = (t['kind'], t['file'], t.get('entityIndex'), t.get('child'),
               t.get('model'), t.get('geometry'), t.get('primitive'), t.get('material'),
               t.get('set'), t.get('definition'))
        v = groups.setdefault(key, {k: v for k, v in t.items()
                                    if k not in ('points', 'local', 'id')})
        v.setdefault('ids', set()).add(t['id'])
        v['clippedSurfaceArea'] = v.get('clippedSurfaceArea', 0.) + area
    return [{**v, 'ids': sorted(v['ids'])} for v in groups.values()]


def inspect(low, high):
    contained, unsupported = [], []
    center = (np.array(low)+high)/2
    for x in g.R:
        if x['kind'] != 'polys':
            continue
        for p in x['polygons']:
            ident = {'file': x['file'], 'child': x['child'], 'id': p['id'], 'type': p['type']}
            if p['type'] == 'Box':
                pts = np.asarray(p['points'])
                pts = pts if g.name(x['file']) == 'v_clotheslo' else g.tolocal(pts)
                pts = np.unique(np.concatenate(box_faces(pts)), axis=0)
                if (pts.max(0) < low).any() or (pts.min(0) > high).any():
                    continue
                eq = ConvexHull(pts).equations
                if np.max(eq[:, :3]@center+eq[:, 3]) < 0:
                    contained.append(ident)
            elif p['type'] != 'Triangle':
                pts = np.array([[a,b,c] for a in [p['min'][0],p['max'][0]]
                                for b in [p['min'][1],p['max'][1]]
                                for c in [p['min'][2],p['max'][2]]])
                pts = pts if g.name(x['file']) == 'v_clotheslo' else g.tolocal(pts)
                if (pts.max(0) >= low).all() and (pts.min(0) <= high).all():
                    unsupported.append(ident)
    return {'low': low, 'high': high, 'surfaceIntersections': intersections(g.tri, low, high),
            'centerInsideBoxes': contained, 'unsupportedBroadphase': unsupported}


def main():
    evidence = json.loads(Path(__file__).with_name('evidence.json').read_text())
    raw_hash = hashlib.sha256(Path(os.environ['X9_RAW']).read_bytes()).hexdigest()
    if raw_hash != evidence['privateRawSha256']:
        raise ValueError('requires reviewed #320 raw digest')
    face = next(t for t in g.tri if t['name'] == 'v_51_windows03' and
                t['model'] == 0 and t['geometry'] == 1 and t['id'] == 0)
    x = float(face['local'][:,0].mean())
    corners = [[x,y,z] for y,z in [(-5.25,.26),(-3.75,.26),(-3.75,2.56),(-5.25,2.56)]]
    regions = {
        'opening': ([6.95,-5.25,.26],[7.65,-3.75,2.56]),
        'approach': ([7.65,-4.95,.28],[9,-4.25,2.13]),
        'landing': ([6.05,-4.95,.28],[6.75,-4.25,2.13]),
        'turnToShop': ([6.05,-4.95,.28],[6.75,-.4,2.13]),
    }
    results = {label: inspect(*bounds) for label,bounds in regions.items()}
    set_path = os.environ.get('X9_SET_RAW')
    if not set_path:
        raise ValueError('X9_SET_RAW must identify the optional entity-set extraction')
    set_triangles, set_coverage, set_solids, set_unsupported = entity_set_triangles(set_path)
    nve = next(m for m in g.mlos if m['file'].startswith('onigiri'))
    primary_differences = []
    for base_en, nve_en in zip(g.mlo['entities'], nve['entities']):
        base_d, nve_d = base_en['entity'], nve_en['entity']
        fields = ('name','pos','rot','scaleXY','scaleZ')
        if any(base_d[k] != nve_d[k] for k in fields):
            primary_differences.append({'index':base_en['index'],'baseName':base_d['name'],
                                        'nveName':nve_d['name'],
                                        'positionDelta':float(np.linalg.norm(np.array(base_d['pos'])-nve_d['pos']))})
    for label,(low,high) in regions.items():
        results[label]['entitySetIntersections'] = intersections(set_triangles,low,high)
        center = (np.array(low)+high)/2
        results[label]['entitySetContainingBoxes'] = []
        for ident,pts in set_solids:
            eq = ConvexHull(pts).equations
            if np.max(eq[:,:3]@center+eq[:,3]) < 0:
                results[label]['entitySetContainingBoxes'].append(ident)
        results[label]['entitySetUnsupportedBroadphase'] = [ident for ident,pts in set_unsupported
            if (pts.max(0)>=low).all() and (pts.min(0)<=high).all()]
    # Downward actual polygon rays for ground, sill and interior floor.
    nearby = [t for t in g.tri if t['kind'] == 'collision' and
              (t['local'].max(0) >= [5.5,-5.5,-1]).all() and
              (t['local'].min(0) <= [9.5,-3.5,4]).all()]
    arrays = np.array([t['local'] for t in nearby])
    floors = []
    for xx in [8.5,7.4,6.4]:
        origin = [xx,-4.6,4]
        hits = []
        for i,distance in ray_hits(arrays,origin,[0,0,-1],5):
            t = nearby[i]
            hits.append({'file':t['file'],'child':t['child'],'id':t['id'],
                         'heightLocal':4-distance})
        floors.append({'originLocal':origin,'hits':hits})
    out = {'rawSha256':raw_hash,'coordinateFrame':evidence['coordinateFrame'],
           'openingReference':{k:v for k,v in face.items() if k not in ('local','points')},
           'openingLocalCorners':corners,'openingWorldCorners':g.world(corners).tolist(),
           'playerEnvelope':{'width':.7,'height':1.85,'feetLocalZ':.28,
                             'method':'conservative rectangular swept volume, includes box containment'},
           'regions':results,'floorRays':floors,
           'portals':evidence['portals'],
           'entitySetRawSha256':hashlib.sha256(Path(set_path).read_bytes()).hexdigest(),
           'entitySetCoverage':set_coverage,
           'nvePrimaryTransformDifferences':primary_differences,
           'nveClearanceCertified':False,
           'limitations':['primary entities use #320 transform adapter; entity-set alternatives checked separately',
                          'fragment root drawable and PhysicsLOD1 bounds inspected; runtime fragment state unverified',
                          'archive variants/resolutions are a union, not a loaded profile',
                          'primary mesh adapter uses base MLO transforms; NVE transform differences prevent NVE clearance certification',
                          'coarser district mesh, runtime streaming and exported resource round-trip unverified']}
    print(json.dumps(out,indent=2))


if __name__ == '__main__':
    main()
