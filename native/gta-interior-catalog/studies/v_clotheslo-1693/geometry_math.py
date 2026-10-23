"""Read-only geometric calculations. numpy is required; no game-file writers."""
import numpy as np


def rotation(q):
    x, y, z, w = q
    return np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
    ])


def box_faces(points):
    # CodeWalker BoundPolygonBox stores four alternating corners, not an AABB.
    p1, p2, p3, p4 = np.asarray(points)
    a1 = (p3+p4-p1-p2)*.5
    a2, a3 = p3-p1-a1, p4-p1-a1
    v = np.array([p1+i*a1+j*a2+k*a3
                  for i in [0, 1] for j in [0, 1] for k in [0, 1]])
    return [v[list(ids)] for ids in [
        (0,1,3), (0,3,2), (4,6,7), (4,7,5), (0,4,5), (0,5,1),
        (2,3,7), (2,7,6), (0,2,6), (0,6,4), (1,5,7), (1,7,3),
    ]]


def clip_triangle(points, lower, upper):
    """Clip a triangle to all six prism planes, returning actual intersection area."""
    poly = list(np.asarray(points, dtype=float))
    for axis in range(3):
        for bound, sign in [(lower[axis], 1), (upper[axis], -1)]:
            result = []
            for a, b in zip(poly, poly[1:]+poly[:1]):
                da, db = sign*(a[axis]-bound), sign*(b[axis]-bound)
                if da >= -1e-9:
                    result.append(a)
                if (da >= 0) != (db >= 0):
                    result.append(a+(b-a)*da/(da-db))
            poly = result
            if len(poly) < 3:
                return 0.0
    return sum(np.linalg.norm(np.cross(poly[i]-poly[0], poly[i+1]-poly[0]))/2
               for i in range(1, len(poly)-1))


def ray_hits(triangles, origin, direction, length):
    """Two-sided Moller-Trumbore ray/triangle intersections; no bbox-only hits."""
    a = np.asarray(triangles)
    e1, e2 = a[:,1]-a[:,0], a[:,2]-a[:,0]
    d, o = np.asarray(direction), np.asarray(origin)
    h = np.cross(d, e2)
    det = np.einsum('ij,ij->i', e1, h)
    inv = 1/np.where(abs(det)>1e-10, det, 1)
    s = o-a[:,0]
    u = inv*np.einsum('ij,ij->i', s, h)
    q = np.cross(s, e1)
    v = inv*(q@d)
    dist = inv*np.einsum('ij,ij->i', e2, q)
    ids = np.where((abs(det)>1e-10) & (u>=-1e-8) & (v>=-1e-8) &
                   (u+v<=1+1e-8) & (dist>=0) & (dist<=length))[0]
    return [(int(i), float(dist[i])) for i in sorted(ids, key=lambda j:dist[j])]
