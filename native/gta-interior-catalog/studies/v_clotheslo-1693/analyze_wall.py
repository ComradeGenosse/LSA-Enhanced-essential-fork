"""Emit derived evidence only. Set X9_RAW to the private extractor JSONL path."""
import hashlib
import json
import sys
import re
from pathlib import Path
from geometry import R, tri, mlo, world, tolocal, P, Q, name
from geometry_math import clip_triangle, ray_hits
import numpy as np


def identity(t):
    return {k: v for k, v in t.items() if k not in ['points', 'local']}


def region(lower, upper):
    groups = {}
    for t in tri:
        a = t['local']
        if (a.max(0) < lower).any() or (a.min(0) > upper).any():
            continue
        area = clip_triangle(a, lower, upper)
        if area < 1e-7:
            continue
        key = (t['file'], t.get('child'), t.get('model'), t.get('geometry'),
               t.get('entityIndex'), t.get('primitive'), t.get('material'))
        g = groups.setdefault(key, {**identity(t), 'ids': set(), 'clippedSurfaceArea': 0})
        g.pop('id', None)
        g['ids'].add(t['id'])
        g['clippedSurfaceArea'] += area
    return [{**g, 'ids': sorted(g['ids'])} for g in groups.values()]


near = [t for t in tri if (t['local'].max(0) > [-12, -10, -1]).all()
        and (t['local'].min(0) < [12, 12, 7]).all()]
arrays = np.array([t['local'] for t in near])


def probe(origin, direction, length):
    return [{**identity(near[i]), 'distance': d,
             'localPoint': (np.array(origin)+np.array(direction)*d).tolist()}
            for i, d in ray_hits(arrays, origin, direction, length)]


# Reference rectangle lies on the actual exterior mesh plane, not its bounding box.
face = next(t for t in tri if t['name'] == 'cs2_01_clothshop' and
            t['kind'] == 'mesh' and t['geometry'] == 3 and t['id'] == 68)
a = face['local']
n = np.cross(a[1]-a[0], a[2]-a[0])
offset = n@a[0]
corners = [[float((offset-n[1]*y-n[2]*z)/n[0]), y, z]
           for y, z in [(-3, .18), (-1.5, .18), (-1.5, 2.48), (-3, 2.48)]]

unsupported = []
for x in R:
    if x['kind'] != 'polys':
        continue
    for p in x['polygons']:
        if p['type'] in ['Triangle', 'Box']:
            continue
        corners_aabb = np.array([[xx, yy, zz] for xx in [p['min'][0], p['max'][0]]
                                 for yy in [p['min'][1], p['max'][1]]
                                 for zz in [p['min'][2], p['max'][2]]])
        local = corners_aabb if name(x['file']) == 'v_clotheslo' else tolocal(corners_aabb)
        if (local.max(0) >= [-7.8, -3, .18]).all() and (local.min(0) <= [-5.5, -1.5, 2.48]).all():
            unsupported.append({'file': x['file'], 'child': x['child'], 'id': p['id'], 'type': p['type']})

references = sorted({t['name'] for t in tri if t['kind'] == 'mesh' and
                     t['file'].endswith('.ydd')})
relevant_names = {'v_clotheslo', 'cs2_01_clothshop', 'cs2_01_clothshop_obja',
                  'cs2_01_clothshop_dec', 'cs2_01_shop_dec2', 'cs2_01_slod1',
                  'cs2_lod_123_slod2', *references}
result = {
    'verdict': 'NO-GO for a simple asset/entity swap or deployment; real interior connection exists but is not isolated',
    'basePr': 319,
    'baseSha': '6a906c77b071b9ee552c17616b2f89b2ad33a3f9',
    'run': next(x for x in R if x['kind'] == 'run'),
    'collisionScan': next(x for x in R if x['kind'] == 'collision_scan'),
    'errors': [x for x in R if x['kind'] in ['error', 'collision_error']],
    'coordinateFrame': {'position': P.tolist(), 'matrixLocalToWorld': Q.tolist(),
                        'mloQuaternionRaw': [0, 0, -.6590842, .7520692],
                        'ordinaryEntityRotation': 'CodeWalker YmapEntityDef.Orientation; inverse of raw rotation'},
    'wall': {'name': 'north-facing side of shop; local negative-X wall',
             'source': identity(face), 'localCorners': corners,
             'worldCorners': world(corners).tolist(),
             'outwardNormalWorld': (-Q[:,0]).tolist(),
             'width': float(np.linalg.norm(np.array(corners[1])-corners[0])), 'height': 2.3},
    'rooms': [{'index': r['index'], 'name': r['name'], 'rawMin': r['min'], 'rawMax': r['max'],
               'attachedEntities': r['AttachedObjects']} for r in mlo['rooms']],
    'portals': [{'index': p['index'], 'from': p['Data']['roomFrom'], 'to': p['Data']['roomTo'],
                 'flags': p['Data']['flags'], 'localCorners': p['points'],
                 'worldCorners': world(p['points']).tolist()} for p in mlo['portals']],
    'targetPlacements': [x for x in R if x['kind'] == 'placement' and x['entity']['name'] in relevant_names],
    'targetArchetypes': [x for x in R if x['kind'] == 'archetype' and x['name'] in relevant_names],
    'assets': [x for x in R if x['kind'] == 'asset'],
    'meshCounts': [{k: x[k] for k in ['file', 'model', 'geometry', 'VerticesCount', 'TrianglesCount']}
                   | ({'item': x['item']} if 'item' in x else {}) for x in R if x['kind'] == 'mesh'],
    'boundSummaries': [{k: x[k] for k in ['file', 'child', 'type', 'min', 'max', 'CompositeFlags1', 'CompositeFlags2']}
                       for x in R if x['kind'] == 'bound'],
    'polygonCounts': [{'file': x['file'], 'child': x['child'], 'count': len(x['polygons']),
                       'types': {typ: sum(p['type'] == typ for p in x['polygons'])
                                 for typ in sorted({p['type'] for p in x['polygons']})}}
                      for x in R if x['kind'] == 'polys'],
    'structuralCollisionOwners': [
        {'file': x['file'], 'child': x['child'],
         'polygons': [{k: p[k] for k in ['id', 'type', 'min', 'max', 'materialIndex', 'material']}
                      for p in x['polygons']
                      if (name(x['file']) == 'cs2_01_5' and x['child'] == 'root/0' and p['id'] == 237)
                      or (name(x['file']) == 'hi@cs2_01_8' and x['child'] == 'root/0' and p['id'] in [3008, 3009])
                      or (name(x['file']) == 'v_clotheslo' and x['child'] == 'root/1' and p['id'] == 241)
                      or (name(x['file']) == 'v_clotheslo' and x['child'] == 'root/0' and p['id'] == 1)]}
        for x in R if x['kind'] == 'polys' and name(x['file']) in ['cs2_01_5', 'hi@cs2_01_8', 'v_clotheslo']],
    'cutPrism': {'min': [-7.8, -3, .18], 'max': [-7.1, -1.5, 2.48],
                 'actualSurfaceIntersections': region(np.array([-7.8, -3, .18]), np.array([-7.1, -1.5, 2.48]))},
    'passagePrism': {'min': [-7.8, -3, .18], 'max': [-5.5, -1.5, 2.48],
                     'actualSurfaceIntersections': region(np.array([-7.8, -3, .18]), np.array([-5.5, -1.5, 2.48]))},
    'unsupportedPrimitiveBroadphaseCandidates': unsupported,
    'rays': [{'originLocal': [-9, y, z], 'directionLocal': [1, 0, 0], 'length': 4,
              'hits': probe([-9, y, z], [1, 0, 0], 4)}
             for y in [-2.9, -2.25, -1.6] for z in [.4, 1.2, 2.2]],
    'floorRays': [{'originLocal': [x, -2.25, 4],
                   'hits': [h for h in probe([x, -2.25, 4], [0, 0, -1], 6) if h['kind'] == 'collision']}
                  for x in [-8.5, -7, -6, -5]],
    'privateRawSha256': hashlib.sha256(Path(__import__('os').environ['X9_RAW']).read_bytes()).hexdigest(),
    'limitations': ['Union of archived variants and collision resolutions, not a runtime loaded scene.',
                    'Only primary MLO entities are transformed; entity-set activation is not proven.',
                    'No runtime culling, capsule traversal, fracture, or restoration evidence.',
                    'No proprietary mesh arrays, indices, texture data or resource payloads are published.'],
}
rendered = json.dumps(result, indent=2)
# Keep scalar numeric arrays on one line so source IDs/corners are reviewable.
rendered = re.sub(r'\[\n((?:\s+-?[0-9][0-9.eE+\-]*,?\n)+)\s*\]',
                  lambda m: '['+' '.join(m.group(1).split())+']', rendered)
Path(sys.argv[1]).write_bytes((rendered+'\n').encode('utf-8'))
print(json.dumps({k: result[k] for k in ['collisionScan', 'errors', 'wall', 'unsupportedPrimitiveBroadphaseCandidates']}, indent=2))
