"""Self-contained offline smoke test; synthetic geometry, no GTA assets."""
import json, tempfile, unittest
from pathlib import Path
import numpy as np
import trimesh
from render_vehicle_library import process

class OfflineVehicleLibraryTests(unittest.TestCase):
    def test_synthetic_car_export_and_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            scene=trimesh.Scene()
            chassis=trimesh.creation.box(extents=(1.7,.65,4.6))
            scene.add_geometry(chassis,node_name="chassis",geom_name="chassis")
            # Side mirrors break a rectangular contour into a proper car profile.
            for side,x in (("left",-0.9),("right",0.9)):
                mirror=trimesh.creation.box(extents=(.30,.18,.28))
                scene.add_geometry(mirror,node_name=f"mirror_{side}",
                    transform=trimesh.transformations.translation_matrix([x,.21,-.7]))
            for key,x,z in (("lf",-.83,-1.6),("rf",.83,-1.6),
                            ("lr",-.83,1.6),("rr",.83,1.6)):
                wheel=trimesh.creation.box(extents=(.30,.55,.64))
                scene.add_geometry(wheel,node_name="wheel_"+key,
                    transform=trimesh.transformations.translation_matrix([x,-.25,z]))
            path=root/"testcar_hi.yft.glb"
            path.write_bytes(scene.export(file_type="glb"))
            result=process("testcar",path,root/"processed")
            self.assertEqual(result["status"],"ok")
            self.assertGreaterEqual(result["outline"],6)
            self.assertEqual(result["triangles"],12*(1+2+4))
            output=root/"processed"
            geometry=json.loads((output/"testcar.json").read_text("utf8"))
            self.assertEqual(geometry["schemaVersion"],"vh6.vehicle-geometry.v1")
            self.assertEqual(geometry["model"],"testcar")
            self.assertEqual(set(geometry["wheels"]),{"lf","rf","lr","rr"})
            self.assertLess(geometry["wheels"]["lf"]["hudNormalized"]["x"],0)
            self.assertLess(geometry["wheels"]["lf"]["hudNormalized"]["y"],
                            geometry["wheels"]["lr"]["hudNormalized"]["y"])
            from PIL import Image
            with Image.open(output/"testcar-shaded.png") as pic:
                self.assertEqual(pic.mode,"RGBA")
                self.assertGreater(pic.getbbox()[2],128)

if __name__=="__main__":
    unittest.main()
