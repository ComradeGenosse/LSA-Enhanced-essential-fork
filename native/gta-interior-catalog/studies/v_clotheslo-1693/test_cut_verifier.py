import copy
import itertools
import json
from pathlib import Path
import unittest
import numpy as np
from cut_verifier import (LOW, HIGH, area, split_triangle, split_box, volume,
                          partition, verify, cuttable_owner)


class CutTests(unittest.TestCase):
    def test_triangle_area_winding_and_boundary(self):
        for x in [-7.8, -7.5, -7.1]:
            p = np.array([[x, -20, 0], [x, 20, 0], [x, 0, 20.]])
            opening, remainder = split_triangle(p)
            self.assertAlmostEqual(area(opening)+sum(map(area, remainder)), area(p))
            self.assertAlmostEqual(area(opening), 3.45)
            normal = np.cross(p[1]-p[0], p[2]-p[0])
            for f in [opening, *remainder]:
                if area(f):
                    self.assertGreater(np.dot(np.cross(f[1]-f[0], f[2]-f[0]), normal), 0)

    def test_oriented_solid_volume_and_disjoint_remainder(self):
        # Thick, rotated collider crossing all six planes.
        from scipy.spatial import ConvexHull
        p = np.array(list(itertools.product([-2., 2.], repeat=3)))
        q = np.array([[.8, -.6, 0], [.6, .8, 0], [0, 0, 1]])
        p = p@q + (LOW+HIGH)/2
        opening, remainder = split_box(p)
        self.assertAlmostEqual(volume(opening), np.prod(HIGH-LOW), places=7)
        self.assertAlmostEqual(volume(opening)+sum(map(volume, remainder)), ConvexHull(p).volume, places=7)
        for a, b in itertools.combinations(remainder, 2):
            self.assertLess(volume(a+b), 1e-8)

    def test_inventory_and_preservation_mutations(self):
        source = [{'key': name, 'type': 'Triangle', 'points':
                   [[-7.5, -4, 0], [-7.5, 0, 0], [-7.5, -2, 4]],
                   'material': name} for name in ['wall', 'floor', 'display', 'neighbor', 'normal', 'high', 'nve', 'lod']]
        allowed = {'wall', 'normal', 'high', 'nve', 'lod'}
        candidate = {r['key']: partition(r, r['key'] in allowed) for r in source}
        self.assertTrue(verify(source, candidate, allowed))
        for name in candidate:
            bad = copy.deepcopy(candidate)
            bad[name]['remainder'][0][0][0] += .01
            with self.assertRaises(ValueError):
                verify(source, bad, allowed)
        for mutation in ['delete', 'extra', 'material', 'opening']:
            bad = copy.deepcopy(candidate)
            if mutation == 'delete': del bad['neighbor']
            elif mutation == 'extra': bad['extra'] = bad['wall']
            elif mutation == 'material': bad['wall']['source'] = 'changed'
            else: bad['wall']['opening'] = []
            with self.assertRaises(ValueError): verify(source, bad, allowed)

    def test_display_is_preserved_but_blocking(self):
        p = np.array(list(itertools.product([-7.4276533, -6.8884296],
                                             [-5.507884, -1.4135588],
                                             [.3276665, 2.5699403])))
        r = {'key': 'display', 'type': 'Box', 'points': p.tolist()}
        result = partition(r, False)
        self.assertGreater(result['protectedIntersection'], 0)
        self.assertEqual(result['remainder'], [r['points']])
        self.assertEqual(result['opening'], [])

    def test_bad_input(self):
        for typ, pts in [('Sphere', [[0, 0, 0]]), ('Triangle', [[float('nan'), 0, 0]]*3)]:
            with self.assertRaises(ValueError): partition({'type': typ, 'points': pts}, True)

    def test_missing_authorized_identity(self):
        # The public oracle must fail closed too, not just run_private's adapter.
        with self.assertRaisesRegex(ValueError, 'missing authorized'):
            verify([], {}, {'missing-reviewed-wall'})

    def test_intersection_does_not_authorize_vegetation(self):
        self.assertFalse(cuttable_owner({'name': 'prop_weeddead_nxg02'}))
        self.assertFalse(cuttable_owner({'name': 'v_51_clothing02'}))
        self.assertFalse(cuttable_owner({'name': 'v_clotheslo', 'child': 'root/0'}))
        self.assertTrue(cuttable_owner({'name': 'v_clotheslo', 'child': 'root/1'}))

    def test_reviewed_evidence_coverage(self):
        e = json.loads(Path(__file__).with_name('evidence.json').read_text())
        names = {g['name'] for g in e['cutPrism']['actualSurfaceIntersections']}
        self.assertTrue({'cs2_01_5', 'hi@cs2_01_8', 'v_clotheslo', 'v_51_v_clotheslo',
                         'v_51_clothing02', 'cs2_01_clothshop_lod', '1814693341'} <= names)
        self.assertFalse(e['errors'])
        self.assertFalse(e['unsupportedPrimitiveBroadphaseCandidates'])
        self.assertEqual(len(e['portals']), 8)


if __name__ == '__main__': unittest.main()
