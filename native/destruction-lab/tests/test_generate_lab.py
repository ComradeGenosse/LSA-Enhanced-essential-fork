import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate_lab as lab


class DestructionLabTests(unittest.TestCase):
    def setUp(self):
        self.site = {"x": 1245.125, "y": -2250.875, "z": 37.75,
                     "heading": 30.0, "surveyed": True, "evidence": "operator-site-001"}

    def test_no_unqualified_site(self):
        site = dict(self.site, surveyed=False)
        with self.assertRaisesRegex(ValueError, "surveyed"):
            lab.create_plan(site)
        del site["surveyed"]
        with self.assertRaises(ValueError):
            lab.create_plan(site)
        site = dict(self.site, evidence="../unsafe text")
        with self.assertRaises(ValueError):
            lab.create_plan(site)

    def test_reject_bad_numbers(self):
        for key in ("x", "y", "z", "heading"):
            for value in (float("nan"), float("inf"), True, "2"):
                site = dict(self.site, **{key: value})
                with self.subTest(key=key, value=str(value)):
                    with self.assertRaises(ValueError):
                        lab.create_plan(site)
        with self.assertRaises(ValueError):
            lab.create_plan(dict(self.site, heading=360))
        with self.assertRaises(ValueError):
            lab.create_plan(dict(self.site, x=12000))

    def test_two_separated_fences_different_headings(self):
        plan = lab.create_plan(self.site)
        a, b = plan["placements"]
        self.assertEqual([p["id"] for p in plan["placements"]], ["A", "B"])
        self.assertEqual([p["hash"] for p in plan["placements"]], [1185366416] * 2)
        self.assertGreaterEqual(math.dist([a["x"], a["y"]], [b["x"], b["y"]]), 29.9)
        self.assertAlmostEqual((b["heading"] - a["heading"]) % 360, 90.0)
        self.assertEqual(plan["classification"], "PROPOSED_UNVERIFIED_IN_GTA")

    def test_fixture_cannot_look_deployable(self):
        plan = lab.create_plan({"x": 100, "y": 200, "z": 50, "heading": 0}, fixture=True)
        with tempfile.TemporaryDirectory() as d:
            out = lab.emit(plan, d)
            self.assertIn("NOT_DEPLOYABLE.txt", out)
            self.assertIn("synthetic", Path(d, "NOT_DEPLOYABLE.txt").read_text().lower())
            self.assertIn("OFFLINE_FIXTURE", json.loads(out["placements.json"])["classification"])

    def test_xml_is_parseable_codewalker_shape(self):
        xml = lab.render_xml(lab.create_plan(self.site))
        root = ET.fromstring(xml)
        self.assertEqual(root.tag, "CMapData")
        self.assertEqual(root.findtext("name"), lab.MAP_NAME)
        self.assertEqual(root.find("flags").get("value"), "0")
        self.assertEqual(root.find("contentFlags").get("value"), "1")
        entities = root.find("entities").findall("Item")
        self.assertEqual(len(entities), 2)
        for entity in entities:
            self.assertEqual(entity.get("type"), "CEntityDef")
            self.assertEqual(entity.findtext("archetypeName"), lab.MODEL)
            self.assertEqual(entity.find("parentIndex").get("value"), "-1")
            self.assertEqual(entity.findtext("lodLevel"), "LODTYPES_DEPTH_ORPHANHD")
            self.assertEqual(entity.find("scaleXY").get("value"), "1")
            q = entity.find("rotation")
            magnitude = sum(float(q.get(k)) ** 2 for k in ("x", "y", "z", "w"))
            self.assertAlmostEqual(magnitude, 1, places=5)

    def test_extents_cover_each_entity(self):
        root = ET.fromstring(lab.render_xml(lab.create_plan(self.site)))
        for p in lab.create_plan(self.site)["placements"]:
            for kind in ("entities", "streaming"):
                low = root.find(kind + "ExtentsMin")
                high = root.find(kind + "ExtentsMax")
                for axis in ("x", "y", "z"):
                    self.assertLess(float(low.get(axis)), p[axis])
                    self.assertGreater(float(high.get(axis)), p[axis])
        self.assertGreater(float(root.find("streamingExtentsMax").get("x")),
                           float(root.find("entitiesExtentsMax").get("x")))

    def test_codewalker_inverted_quaternion_at_ninety(self):
        plan = lab.create_plan({"x": 100, "y": 200, "z": 50, "heading": 0}, fixture=True)
        a, b = plan["placements"]
        self.assertAlmostEqual(a["quaternion"][2], 0)
        self.assertAlmostEqual(a["quaternion"][3], 1)
        self.assertAlmostEqual(b["quaternion"][2], -math.sqrt(.5))
        self.assertAlmostEqual(b["quaternion"][3], math.sqrt(.5))

    def test_reproducible_output_and_command_scope(self):
        plan = lab.create_plan(self.site)
        with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
            lhs, rhs = lab.emit(plan, d1), lab.emit(plan, d2)
            self.assertEqual(lhs, rhs)
            self.assertEqual(set(lhs), set(rhs))
            cmds = lhs["p2-operator-commands.txt"]
            self.assertEqual(cmds.count("x8register id="), 2)
            self.assertIn("x8audit id=A", cmds)
            self.assertIn("x8audit id=B", cmds)
            commands_only = [line for line in cmds.splitlines() if not line.startswith("#")]
            self.assertFalse(any(line.startswith("x8shot ") for line in commands_only))
            self.assertFalse(any(line.startswith("x8prepare ") for line in commands_only))
            self.assertFalse(any(line.startswith("x8restore ") for line in commands_only))
            self.assertNotIn("CreateObject", lhs[lab.MAP_NAME + ".ymap.xml"])
            self.assertIn("NOT A SCRIPT", cmds)

    def test_pack_requires_resource_entry_and_nve_streaming_metadata(self):
        # A binary YMAP that reopens in CodeWalker can still be unsuitable
        # for GTA streaming if stored with the wrong RPF entry kind.
        packer = (Path(__file__).resolve().parents[1] / "pack_lab.ps1").read_text(encoding="utf-8")
        self.assertIn("RpfResourceFileEntry", packer)
        self.assertIn("$entry[0].Version -ne 2", packer)
        self.assertIn("GROUP_UPDATE_STREAMING", packer)
        self.assertIn("CONTENTS_DLC_MAP_DATA", packer)
        self.assertIn("filesToEnable", packer)
        self.assertNotIn("<fileType>MAP_DATA</fileType>", packer)

    def test_opt_in_story_mode_map_registration_candidate(self):
        # The baseline packaging must remain untouched unless explicitly opted in.
        packer = (Path(__file__).resolve().parents[1] / "pack_lab.ps1").read_text(encoding="utf-8")
        self.assertIn("[switch]$StoryModeMapCandidate", packer)
        self.assertIn("if($StoryModeMapCandidate){", packer)
        self.assertIn("<NameHash>GROUP_MAP_SP</NameHash>", packer)
        self.assertIn("<mapChangeSetData>", packer)
        self.assertIn("<associatedMap>MO_JIM_L11</associatedMap>", packer)
        self.assertIn("LSA_DESTRUCTION_LAB_MAP_SP", packer)
        self.assertIn("mapRegistrationVariant=", packer)
        self.assertIn("V3_BASELINE", packer)
        self.assertIn("GROUP_MAP_SP_EXPERIMENT", packer)

    def test_no_output_for_missing_site(self):
        with self.assertRaises(ValueError):
            lab.create_plan({"x": 1, "y": 2, "z": 3, "heading": 0})


if __name__ == "__main__":
    unittest.main()
