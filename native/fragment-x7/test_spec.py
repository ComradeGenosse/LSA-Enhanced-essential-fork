"""Offline source-only determinism and frozen matrix contract; no fabricated game samples."""
import unittest
from spec import *

class FrozenMatrix(unittest.TestCase):
    def test_matrix(self):
        vs=a_variants()
        self.assertEqual(len(vs),12)
        self.assertEqual([v.name for v in vs[:3]],["lsa_x7a_ctl","lsa_x7a_sx","lsa_x7a_hx"])
        self.assertEqual([v.strength for v in vs[3:10]],list(LEVELS))
        self.assertEqual(vs[0].transmission,.25)
        self.assertEqual((vs[1].strength,vs[1].min_damage_force,vs[1].health),(1e7,5,25))
        self.assertEqual((vs[2].strength,vs[2].min_damage_force,vs[2].health),(35,1e7,1e7))
        self.assertEqual([v.name for v in vs[-2:]],["lsa_x7a_j1000f","lsa_x7a_j3200f"])
        for v in vs[3:10]:
            self.assertEqual(v.health,v.strength)
            self.assertEqual(v.min_damage_force,v.strength/5)
            self.assertEqual(v.transmission,0)
    def test_torn(self):
        self.assertEqual(len(cells("torn36")),36)
        self.assertEqual(len(cells("grid6x5")),30)
        for v in b_variants(1000):
            self.assertEqual(v.weapon_scale,.15)
            self.assertEqual(v.transmission,0)
        with self.assertRaises(ValueError): b_variants(1555)
    def test_walk5_is_isolated_and_player_sized(self):
        self.assertEqual(len(cells("walk5")),5)
        strips=cells("walk5")
        self.assertAlmostEqual(strips[0][3]-strips[0][2],SHEET_H)
        self.assertGreaterEqual(2*(strips[0][1]-strips[0][0]),.9)
        models=c_variants()
        self.assertEqual(len(models),7)
        self.assertEqual([m.strength for m in models],[1000,550,1800,3200,1300,1400,1600])
        self.assertTrue(all(m.transmission==0 for m in models))
        self.assertEqual(manifest("walk5")["groups"],6)
        self.assertEqual(manifest("walk5")["allowlist"],[m.name for m in models])
        self.assertEqual(len(a_variants()),12)
        self.assertEqual(len(cells("grid6x5")),30)
    def test_sec1_independent_sections(self):
        models=d_variants()
        self.assertEqual(len(models),6)
        self.assertEqual([m.name for m in models][:2],["lsa_x7d_sec_j1400","lsa_x7d_secp_j1400"])
        self.assertEqual([m.post for m in models],[False,True]*3)
        self.assertTrue(all(m.transmission==0 and m.health==m.strength and m.min_damage_force==m.strength/5 for m in models))
        self.assertAlmostEqual(SEC_W*SECTIONS,W)
        self.assertEqual(cells("sec1"),[(-SEC_W/2,SEC_W/2,0.0,SHEET_H)])
        self.assertEqual(manifest("sec1")["groups"],2)
        self.assertEqual(manifest("sec1")["allowlist"],[m.name for m in models])
        self.assertEqual(manifest("walk5")["groups"],6)  # x7c walk5 untouched
    def test_shared_edges(self):
        import math
        for j in range(1,4):
            for i in range(1001):
                x=-W/2+W*i/1000
                self.assertLessEqual(abs(seam_z(j,x)-j*SHEET_H/4),.02001)
        self.assertEqual(manifest(),manifest())

if __name__=="__main__":unittest.main()
