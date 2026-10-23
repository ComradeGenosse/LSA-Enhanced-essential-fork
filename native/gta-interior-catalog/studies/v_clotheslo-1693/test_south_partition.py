"""Cloud/CI gates for the #322 south opening. Not a private-asset replay."""
import copy
import itertools
import unittest

import numpy as np

from cut_verifier import digest, partition, verify
import south_partition as sp


def sample_triangle(key, name, z=3):
    return {"key": key, "type": "Triangle", "points": [
        [7.376, -6.0, 0.0], [7.376, -3.0, 0.0], [7.376, -4.5, z]],
        "owner": {"name": name, "file": "synthetic"}}


class SouthPartitionTests(unittest.TestCase):
    def test_exact_reviewed_evidence_and_groups(self):
        e = sp.load_reviewed()
        allowed, protected, counts = sp.reviewed_permissions(e, "base-hipster")
        self.assertEqual(sum(counts.values()), 13)
        self.assertEqual(counts["v_51_windows03"], 5)
        self.assertEqual(counts["v_clotheslo"], 1)
        self.assertEqual(counts["cs2_01_5"], 1)
        self.assertTrue(allowed)
        self.assertTrue(protected)
        self.assertFalse(allowed & protected)
        self.assertEqual(len(e["regions"]["opening"]["surfaceIntersections"]), 16)
        self.assertFalse(e["nveClearanceCertified"])
        self.assertEqual(len(e["nvePrimaryTransformDifferences"]), 56)

    def test_profile_gates_reject_cheap_and_nve(self):
        e = sp.load_reviewed()
        for name in ("base-cheap", "nve-hipster", "nve-cheap", "unknown"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "unsupported profile"):
                sp.reviewed_permissions(e, name)

    def test_unreviewed_owner_and_obstruction_fail_closed(self):
        e = sp.load_reviewed()
        for name in ("unreviewed_store_display", "prop_weeds_nxg04b"):
            changed = copy.deepcopy(e)
            changed["regions"]["opening"]["surfaceIntersections"][0]["name"] = name
            with self.assertRaisesRegex(ValueError, "unreviewed obstacle"):
                sp.reviewed_permissions(changed, sp.PROFILE)
        changed = copy.deepcopy(e)
        changed["regions"]["landing"]["surfaceIntersections"].append({"name": "new_shelf"})
        with self.assertRaisesRegex(ValueError, "clearance regression"):
            sp.reviewed_permissions(changed, sp.PROFILE)
        changed = copy.deepcopy(e)
        changed["regions"]["opening"]["entitySetIntersections"].append(
            {"name": "new_NVE_display", "set": "clotheslowhipster"})
        with self.assertRaisesRegex(ValueError, "unexpected optional-set"):
            sp.reviewed_permissions(changed, sp.PROFILE)

    def test_south_bounds_not_north_or_moved_sill(self):
        glass = sample_triangle("glass", "v_51_windows03")
        south = partition(glass, True, sp.LOW, sp.HIGH)
        north = partition(glass, True)
        self.assertGreater(south["openingMeasure"], 0)
        self.assertEqual(north["openingMeasure"], 0)
        sill = sample_triangle("sill", "v_51_windows03", z=.25)
        kept = partition(sill, False, sp.LOW, sp.HIGH)
        self.assertEqual(kept["openingMeasure"], 0)
        self.assertEqual(kept["protectedIntersection"], 0)
        self.assertEqual(kept["remainder"], [sill["points"]])

    def test_south_normal_box_partition_conserves_volume(self):
        corners = np.array(list(itertools.product(
            [6.8, 7.8], [-6.0, -3.0], [0.0, 3.0])))
        box = {"key": "collision209", "type": "Box",
               "owner": {"name": "cs2_01_5"}, "points": corners.tolist()}
        piece = partition(box, True, sp.LOW, sp.HIGH)
        self.assertAlmostEqual(piece["openingMeasure"], np.prod(sp.HIGH-sp.LOW), places=6)
        self.assertAlmostEqual(piece["preservedMeasure"]+piece["openingMeasure"], 9.0, places=6)
        self.assertTrue(verify([box], {"collision209": piece}, {"collision209"},
                               sp.LOW, sp.HIGH))

    def test_full_inventory_protection_and_mutations(self):
        glass = sample_triangle("glass", "v_51_windows03")
        weed = sample_triangle("weed", "prop_weeddead_nxg02")
        counter = sample_triangle("counter", "v_51_counter", z=.8)
        sill = sample_triangle("sill", "v_51_windows03", z=.25)
        records = [glass, weed, counter, sill]
        # Unknown protected collision inside the cut is a hard stop.
        with self.assertRaisesRegex(ValueError, "new protected obstruction"):
            sp.evaluate(records, {"glass"}, {"weed"})
        # No display or counter can be authorized just because it intersects.
        with self.assertRaisesRegex(ValueError, "missing/duplicate"):
            sp.evaluate(records, {"glass", "not-present"}, {"weed"})
        safe = [glass, weed, sill]
        result = sp.evaluate(safe, {"glass"}, {"weed"})
        self.assertTrue(result["partitionVerified"])
        self.assertGreater(result["preservedWeedSurfaceArea"], 0)
        self.assertEqual(result["cutOwners"]["v_51_windows03"]["cutCount"], 1)
        candidate = {r["key"]: partition(r, r["key"] == "glass", sp.LOW, sp.HIGH)
                     for r in safe}
        altered = copy.deepcopy(candidate)
        altered["sill"]["remainder"][0][0][2] = 1
        with self.assertRaises(ValueError):
            verify(safe, altered, {"glass"}, sp.LOW, sp.HIGH)

    def test_reviewer_identity_does_not_mean_name_wildcard(self):
        e = sp.load_reviewed()
        allowed, _, _ = sp.reviewed_permissions(e, sp.PROFILE)
        group = next(g for g in e["regions"]["opening"]["surfaceIntersections"]
                     if g["name"] == "v_51_windows03")
        from cut_verifier import identity
        pid = group["ids"][0]
        original = digest({"owner": identity(group), "id": pid})
        self.assertIn(original, allowed)
        switched = copy.deepcopy(group)
        switched["file"] = switched["file"].replace("x64h.rpf", "onigiri\\nve_interiors")
        self.assertNotIn(digest({"owner": identity(switched), "id": pid}), allowed)


if __name__ == "__main__":
    unittest.main()
