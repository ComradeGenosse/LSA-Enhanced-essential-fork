import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
class PublicPayloadPolicyTests(unittest.TestCase):
    def test_geometry_tree_contains_no_asset_payloads_or_game_logs(self):
        root=ROOT/"geometry"/"vehicles"/"buffalo"
        forbidden={".rpf",".yft",".ydr",".glb",".gltf",".obj",".mtl",".dds",".ytd",".csv",".png",".jpg"}
        self.assertTrue(root.exists())
        files=[p for p in root.rglob("*") if p.is_file()]
        self.assertTrue(files)
        self.assertFalse([str(p.relative_to(ROOT)) for p in files if p.suffix.lower() in forbidden])
        for p in files:
            text=p.read_text(encoding="utf-8")
            self.assertNotIn("capture_id",text.lower())
            self.assertNotIn("probe_index",text.lower())
if __name__=="__main__":unittest.main(verbosity=2)
