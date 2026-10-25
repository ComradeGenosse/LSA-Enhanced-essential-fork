import json
import math
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "convert"))
from glb_to_hud_geometry import convert, read_glb, area, self_intersects


class GenuineBuffaloGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path=os.environ.get("VH6_BUFFALO_GLB")
        if not path:
            raise unittest.SkipTest("Set VH6_BUFFALO_GLB to the locally extracted stock buffalo_hi GLB")
        cls.path=Path(path)
        cls.a=convert(cls.path)
        cls.b=convert(cls.path)

    def test_genuine_glb_parses_and_contains_expected_high_lod_mesh(self):
        doc,binary=read_glb(self.path)
        self.assertEqual(doc["asset"]["version"],"2.0")
        self.assertGreater(len(binary),1_000_000)
        self.assertEqual(sum(p["triangleCount"] for p in self.a["sourceParts"]),64562)

    def test_orientation_and_dimensions_match_buffalo_source(self):
        self.assertEqual(self.a["coordinateSystem"]["gtaFront"],"+Y")
        self.assertIn("GTA local Y=-glTF Z",self.a["coordinateSystem"]["transform"])
        self.assertAlmostEqual(self.a["dimensions"]["length"],5.02051,places=3)
        self.assertAlmostEqual(self.a["dimensions"]["width"],1.94727,places=3)
        self.assertGreater(self.a["dimensions"]["length"],self.a["dimensions"]["width"]*2)
        self.assertEqual(set(self.a["wheels"]),{"lf","rf","lr","rr"})
        self.assertLess(self.a["wheels"]["lf"]["center"]["x"],0)
        self.assertGreater(self.a["wheels"]["lf"]["center"]["y"],0)
        self.assertGreater(self.a["wheels"]["lf"]["center"]["y"],self.a["wheels"]["lr"]["center"]["y"])
        self.assertLess(self.a["wheels"]["lf"]["hudNormalized"]["y"],self.a["wheels"]["lr"]["hudNormalized"]["y"])
        self.assertLess(self.a["wheels"]["lf"]["hudNormalized"]["x"],0)
        self.assertGreater(self.a["wheels"]["rf"]["hudNormalized"]["x"],0)
        self.assertTrue(all(-0.51<=p["x"]<=0.51 and 0<=p["y"]<=1 for p in self.a["contour"]["vertices"]))

    def test_contour_is_simple_compact_and_faithful_to_actual_mesh(self):
        v=[(p["x"],p["y"]) for p in self.a["contour"]["vertices"]]
        self.assertGreaterEqual(len(v),8); self.assertLessEqual(len(v),32)
        self.assertFalse(self_intersects(v)); self.assertGreater(area(v),0)
        self.assertGreaterEqual(self.a["validation"]["rasterContourIoU"],.95)

    def test_conversion_is_deterministic_and_schema_valid(self):
        self.assertEqual(self.a,self.b)
        self.assertEqual(self.a["schemaVersion"],"vh6.vehicle-geometry.v1")
        self.assertEqual(self.a["contour"]["coordinateUnits"],"normalized HUD XY; X centered and scaled by full width, Y front=0 rear=1")
        self.assertEqual(len(self.a["deformationMapping"]["probes"]),48)
        self.assertEqual({r:sum(p["region"]==r for p in self.a["deformationMapping"]["probes"]) for r in ("front","rear","left","right","roof")},{"front":9,"rear":9,"left":12,"right":12,"roof":6})
        self.assertEqual(len(self.a["deformationMapping"]["vertexAssociations"]),len(self.a["contour"]["vertices"]))
        self.assertEqual(self.a["contour"]["winding"],"counterclockwise")
        self.assertEqual(len(self.a["contour"]["vertices"]),self.a["validation"]["contourVertexCount"])
        self.assertTrue(self.a["sourceParts"])
        self.assertTrue(all("id" in p and "x" in p and "y" in p for ring in self.a["windowRegions"]["rings"] for p in ring))
        self.assertTrue(all(p["classification"]!="placeholder" for p in self.a["sourceParts"]))

if __name__=="__main__":unittest.main(verbosity=2)
