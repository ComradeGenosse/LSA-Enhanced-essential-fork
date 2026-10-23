import math
import unittest
import numpy as np
from geometry_math import rotation, box_faces, clip_triangle, ray_hits


class GeometryTests(unittest.TestCase):
    def test_mlo_and_ordinary_rotation_are_distinct(self):
        q = [0, 0, math.sqrt(.5), math.sqrt(.5)]
        np.testing.assert_allclose(rotation(q)@[1, 0, 0], [0, 1, 0], atol=1e-12)
        q[2] *= -1
        np.testing.assert_allclose(rotation(q)@[1, 0, 0], [0, -1, 0], atol=1e-12)

    def test_rotated_box_is_not_its_axis_aligned_bounds(self):
        points = np.array([[0,0,0], [0,1,1], [1,1,0], [1,0,1]], dtype=float)
        q = rotation([0,0,math.sin(math.pi/8),math.cos(math.pi/8)])
        faces = box_faces(points@q.T)
        self.assertEqual(len(faces), 12)
        hits = ray_hits(faces, [-2, .7, .4], [1,0,0], 4)
        self.assertEqual(len(hits), 2)
        self.assertLess(hits[0][1], hits[1][1])
        self.assertEqual(ray_hits(faces, [-2, 1.5, .4], [1,0,0], 4), [])

    def test_bbox_overlap_without_triangle_intersection_is_rejected(self):
        tri = [[0,0,0], [2,0,0], [0,2,0]]
        self.assertEqual(clip_triangle(tri, [1.2,1.2,-1], [1.8,1.8,1]), 0)
        self.assertAlmostEqual(clip_triangle(tri, [0,0,-1], [.5,.5,1]), .25)

    def test_ray_segment_does_not_hit_past_endpoint(self):
        tri = [[[1,-1,-1], [1,1,-1], [1,0,1]]]
        self.assertEqual(ray_hits(tri, [0,0,0], [1,0,0], .5), [])
        self.assertAlmostEqual(ray_hits(tri, [0,0,0], [1,0,0], 2)[0][1], 1)


if __name__ == '__main__':
    unittest.main()
