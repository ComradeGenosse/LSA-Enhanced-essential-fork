"""Offline partition oracle. No game resource serialization or installation.

Polygons retain winding. Convex collision cells retain volume (new cap surfaces
are implicit in halfspaces). Output contains derived measures/digests only.
"""
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np
from scipy.spatial import ConvexHull, QhullError

LOW = np.array([-7.8, -3., .18])
HIGH = np.array([-7.1, -1.5, 2.48])


def planes():
    for axis in range(3):
        n = np.eye(3)[axis]
        yield np.r_[-n, LOW[axis]]
        yield np.r_[n, -HIGH[axis]]


def area(poly):
    return sum(np.linalg.norm(np.cross(poly[i]-poly[0], poly[i+1]-poly[0]))/2
               for i in range(1, len(poly)-1))


def clip(poly, plane):
    out = []
    for a, b in zip(poly, np.roll(poly, -1, axis=0)):
        da, db = a@plane[:3]+plane[3], b@plane[:3]+plane[3]
        if da <= 0:
            out.append(a)
        if (da < 0 < db) or (db < 0 < da):
            out.append(a+(b-a)*da/(da-db))
    return np.asarray(out).reshape(-1, 3)


def split_triangle(points):
    remaining = np.asarray(points, dtype=float)
    outside = []
    for p in planes():
        if len(remaining) and np.max(remaining@p[:3]+p[3]) <= 0:
            continue
        part = clip(remaining, -p)
        if area(part) > 1e-12:
            outside.append(part)
        remaining = clip(remaining, p)
        if len(remaining) == 0:
            break
    return remaining, outside


def vertices(halfspaces):
    """Enumerate bounded convex-cell vertices; no AABB approximation."""
    hs = np.asarray(halfspaces)
    out = []
    for ids in itertools.combinations(range(len(hs)), 3):
        a = hs[list(ids), :3]
        if abs(np.linalg.det(a)) < 1e-10:
            continue
        v = np.linalg.solve(a, -hs[list(ids), 3])
        if np.max(hs[:, :3]@v+hs[:, 3]) <= 1e-8:
            out.append(v)
    return np.unique(np.round(out, 10), axis=0) if out else np.empty((0, 3))


def volume(hs):
    v = vertices(hs)
    if len(v) < 4:
        return 0.
    try:
        return ConvexHull(v).volume
    except QhullError:
        return 0.


def split_box(points):
    hs = np.unique(np.round(ConvexHull(points).equations, 12), axis=0).tolist()
    outside = []
    for p in planes():
        part = hs + [(-p).tolist()]
        if volume(part) > 1e-12:
            outside.append(part)
        hs = hs + [p.tolist()]
    return hs, outside


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def partition(record, authorized):
    points = np.asarray(record['points'], dtype=float)
    if not np.isfinite(points).all():
        raise ValueError('nonfinite geometry')
    if record['type'] not in ('Triangle', 'Box'):
        raise ValueError('unsupported primitive: '+record['type'])
    if (points.max(0) < LOW).any() or (points.min(0) > HIGH).any():
        original = area(points) if record['type'] == 'Triangle' else ConvexHull(points).volume
        return {'source': digest(record), 'openingMeasure': 0., 'preservedMeasure': original,
                'protectedIntersection': 0., 'opening': [], 'remainder': [record['points']]}
    if record['type'] == 'Triangle':
        opening, remainder = split_triangle(points)
        measure = area
        original = area(points)
    elif record['type'] == 'Box':
        opening, remainder = split_box(points)
        measure = volume
        original = ConvexHull(points).volume
    else:
        raise ValueError('unsupported primitive: '+record['type'])
    removed = measure(opening)
    preserved = sum(map(measure, remainder))
    if not np.isclose(original, removed+preserved, atol=1e-7, rtol=1e-7):
        raise ValueError('area/volume not conserved')
    # Protected objects remain exactly as supplied, even inside the prism.
    return {'source': digest(record), 'openingMeasure': removed if authorized else 0.,
            'preservedMeasure': preserved if authorized else original,
            'protectedIntersection': removed if not authorized else 0.,
            'opening': np.asarray(opening).tolist() if authorized else [],
            'remainder': [np.asarray(p).tolist() for p in remainder] if authorized else [record['points']]}


def verify(source, candidate, allowed):
    """Strict oracle for this partition representation, including metadata/identity.

    Refuses alternate tessellations: authoring/export validation is a later gate.
    """
    if len({r['key'] for r in source}) != len(source):
        raise ValueError('duplicate source identity')
    expected = {r['key']: partition(r, r['key'] in allowed) for r in source}
    if digest(expected) != digest(candidate):
        raise ValueError('candidate differs from authorized cut/remainder (or inventory)')
    return True


def identity(t):
    return {k: v for k, v in t.items() if k not in ('points', 'local', 'id', 'ids', 'clippedSurfaceArea')}


def run_private():
    import os
    import geometry as g
    evidence = json.loads(Path(__file__).with_name('evidence.json').read_text())
    if hashlib.sha256(Path(os.environ['X9_RAW']).read_bytes()).hexdigest() != evidence['privateRawSha256']:
        raise ValueError('raw digest differs from reviewed #320 evidence')
    if evidence['errors'] or evidence['collisionScan']['errors']:
        raise ValueError('incomplete extraction')
    # Evidence-derived full identity allowlist; never a model-name-only wildcard.
    allowed = set()
    for group in evidence['cutPrism']['actualSurfaceIntersections']:
        if group['name'].startswith('v_51_clothing') or (group['name'] == 'v_clotheslo' and group.get('child') == 'root/0'):
            continue
        for pid in group['ids']:
            allowed.add(digest({'owner': identity(group), 'id': pid}))
    records, seen = [], set()
    boxes = {}
    for t in g.tri:
        key = digest({'owner': identity(t), 'id': t['id']})
        if t.get('primitive') == 'Box':
            boxes.setdefault(key, [t, []])[1].extend(t['local'].tolist())
            continue
        if key in seen:
            raise ValueError('duplicate triangle')
        seen.add(key)
        records.append({'key': key, 'type': 'Triangle', 'points': t['local'].tolist(), 'owner': identity(t)})
    for key, (t, pts) in boxes.items():
        records.append({'key': key, 'type': 'Box', 'points': np.unique(pts, axis=0).tolist(), 'owner': identity(t)})
    if not allowed <= {r['key'] for r in records}:
        raise ValueError('missing authorized owners')
    candidate = {r['key']: partition(r, r['key'] in allowed) for r in records}
    verify(records, candidate, allowed)
    # Never publish vertices or convex halfspaces.
    summary = {k: {a: b for a, b in v.items() if a not in ('opening', 'remainder')}
               for k, v in candidate.items()}
    print(json.dumps({'partitionVerified': True, 'deployment': 'BLOCKED',
                      'rawSha256': evidence['privateRawSha256'], 'records': summary}, indent=2))


if __name__ == '__main__':
    run_private()
