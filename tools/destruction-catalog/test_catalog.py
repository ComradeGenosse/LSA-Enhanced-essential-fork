import copy
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import catalog as c


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.definition = c.read_json(c.HERE/"fence.definition.json")
        self.placements = c.read_json(c.HERE/"synthetic.placements.json")

    def compile(self):
        return c.compile_catalog(self.definition, self.placements)

    def test_actual_xml_contract_and_physical_order(self):
        out = self.compile()
        self.assertAlmostEqual(out["layout"]["width_m"], 2.536)
        self.assertAlmostEqual(out["layout"]["sheet_height_m"], 2.131)
        a = out["instances"][0]
        self.assertEqual([s["physical_index"] for s in a["sections"]], list(range(5)))
        self.assertIn("secp", a["sections"][0]["model"])
        self.assertAlmostEqual(a["sections"][0]["origin_world"][0], -1.0144)
        self.assertAlmostEqual(a["sections"][-1]["origin_world"][0], 1.0144)
        self.assertEqual(len(out["asset_input_sha256"]), 4)
        self.assertIn("OFFLINE", out["status"])

    def test_translated_quarter_turn_and_distinct_source_origin(self):
        b = self.compile()["instances"][1]
        self.assertEqual(b["source_origin_world"], [100, 200, 10])
        self.assertEqual(b["sections"][2]["origin_world"], [100.25, 200.5, 10.1])
        self.assertAlmostEqual(b["sections"][0]["origin_world"][1], 199.4856)
        self.assertEqual(b["sections"][0]["origin_world"][0], 100.25)

    def test_arbitrary_yaw_preserves_geometry_and_nine_rays(self):
        for angle in (0, .37, 1.5, math.pi, 5.8):
            p = self.placements[0]
            p["basis"]["u"] = [math.cos(angle), math.sin(angle), 0]
            p["basis"]["t"] = [-math.sin(angle), math.cos(angle), 0]
            a = self.compile()["instances"][0]
            for left, right in zip(a["sections"], a["sections"][1:]):
                self.assertAlmostEqual(math.dist(left["origin_world"], right["origin_world"]), .5072)
            self.assertEqual(len(a["original_witness_rays"]), 9)
            for ray in a["original_witness_rays"]:
                self.assertAlmostEqual(math.dist(ray["from"], ray["to"]), 1.6)

    def test_ids_are_authored_not_derived_from_coordinates_or_list_order(self):
        before = self.compile()
        self.placements.reverse()
        self.assertEqual(c.render(before), c.render(self.compile()))
        self.placements[0]["source_origin_world"][0] += .001
        after = self.compile()
        self.assertEqual([x["instance_id"] for x in before["instances"]],
                         [x["instance_id"] for x in after["instances"]])

    def test_reject_bad_model_and_post_placement(self):
        self.definition["section_models"][1] = "unknown_model"
        with self.assertRaisesRegex(ValueError, "allowlist"):
            self.compile()
        self.setUp()
        self.definition["section_models"].reverse()
        with self.assertRaisesRegex(ValueError, "post"):
            self.compile()

    def test_reject_unproven_source_or_strength_recipe(self):
        self.definition["source_model"] = "prop_roadcone02a"
        with self.assertRaisesRegex(ValueError, "source model"):
            self.compile()
        self.setUp()
        self.definition["section_models"][2] = "lsa_x7d_sec_j2400"
        with self.assertRaisesRegex(ValueError, "j1400"):
            self.compile()

    def test_reject_duplicate_ids_and_hide_scope_conflicts(self):
        self.placements[1]["instance_id"] = self.placements[0]["instance_id"]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.compile()
        self.setUp()
        self.placements[1]["source_origin_world"] = [.2, 0, 0]
        with self.assertRaisesRegex(ValueError, "overlapping"):
            self.compile()

    def test_reject_nonfinite_scale_shear_mirror_and_tilt(self):
        for key, value in (("u", [2, 0, 0]), ("t", [.1, 1, 0]),
                           ("u", [-1, 0, 0]), ("u", [float("nan"), 0, 0]),
                           ("u", [True, 0, 0]), ("u", [10**400, 0, 0])):
            with self.subTest(value=value):
                self.setUp()
                self.placements[0]["basis"][key] = value
                with self.assertRaises(ValueError):
                    self.compile()
        self.setUp()
        self.placements[0]["basis"] = {"u": [1, 0, 0], "t": [0, 0, 1], "v": [0, -1, 0]}
        with self.assertRaisesRegex(ValueError, "upright"):
            self.compile()

    def test_closed_contract_rejects_unknown_field_revision_and_definition(self):
        for mutate in (lambda: self.definition.update(scale=2),
                       lambda: self.definition.update(revision=True),
                       lambda: self.definition.update(schema=2),
                       lambda: self.placements[0].update(definition_id="another-definition"),
                       lambda: self.placements[0].update(source_origin_world=[0, float("inf"), 0])):
            self.setUp()
            mutate()
            with self.assertRaises(ValueError):
                self.compile()

    def test_xml_drift_is_rejected_and_only_reads_repo_assets(self):
        import shutil
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets = root/"native/fragment-x7/assets-x7d"
            assets.mkdir(parents=True)
            source = c.REPO/"native/fragment-x7/assets-x7d"
            for name in ("models.json", "lsa_x7d.ytyp.xml", "lsa_x7d_sec_j1400.yft.xml",
                         "lsa_x7d_secp_j1400.yft.xml"):
                shutil.copyfile(source/name, assets/name)
            c.compile_catalog(self.definition, self.placements, root)
            path = assets/"lsa_x7d_sec_j1400.yft.xml"
            original = path.read_text()
            path.write_text(original.replace('<Strength value="1400"', '<Strength value="999"'))
            with self.assertRaisesRegex(ValueError, "tuning drift"):
                c.compile_catalog(self.definition, self.placements, root)
            path.write_text(original.replace('x="-0.2536"', 'x="9.7464"')
                           .replace('x="0.2536"', 'x="10.2536"'))
            with self.assertRaisesRegex(ValueError, "origin/height"):
                c.compile_catalog(self.definition, self.placements, root)

    def test_cli_reproducible_output_and_reject_duplicate_json_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"compiled.json"
            run = subprocess.run([sys.executable, str(c.HERE/"catalog.py"), "--output", str(path)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(path.read_text(), c.render(self.compile()))
            path.write_text('{"schema":1,"schema":2}')
            with self.assertRaisesRegex(ValueError, "duplicate JSON"):
                c.read_json(path)
            run = subprocess.run([sys.executable, str(c.HERE/"catalog.py"), "--definition", str(path)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 2)
            self.assertIn("catalog rejected", run.stderr)


if __name__ == "__main__":
    unittest.main()
