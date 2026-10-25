import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"convert"))
from glb_to_hud_geometry import area,loops_from_cells,node_matrix,rdp_open,self_intersects

class GeometryUtilityTests(unittest.TestCase):
    def test_cell_boundary_trace_is_closed_and_simple(self):
        cells={(x,y) for x in range(4) for y in range(3)}
        rings=loops_from_cells(cells)
        self.assertEqual(len(rings),1)
        self.assertGreaterEqual(len(rings[0]),4)
        self.assertEqual(abs(area(rings[0][:-1])),12)
    def test_simplification_preserves_endpoints(self):
        source=[(0,0),(1,.01),(2,0),(3,0)]
        simplified=rdp_open(source,.05)
        self.assertEqual(simplified[0],source[0]);self.assertEqual(simplified[-1],source[-1])
        self.assertEqual(len(simplified),2)
    def test_gltf_column_major_node_matrix_is_converted_for_world_transform(self):
        m=[1,0,0,0,0,1,0,0,0,0,1,0,4,5,6,1]
        out=node_matrix({"matrix":m})
        self.assertEqual((out[3],out[7],out[11]),(4,5,6))
    def test_self_intersection_checker_rejects_bow_tie(self):
        self.assertTrue(self_intersects([(0,0),(1,1),(0,1),(1,0)]))
        self.assertFalse(self_intersects([(0,0),(1,0),(1,1),(0,1)]))
if __name__=="__main__":unittest.main(verbosity=2)
