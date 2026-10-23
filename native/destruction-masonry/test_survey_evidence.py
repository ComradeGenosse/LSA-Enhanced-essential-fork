import json
import unittest
from pathlib import Path

D = Path(__file__).resolve().parent / "evidence" / "20261023-headless-survey"


class SurveyEvidence(unittest.TestCase):
    def setUp(self):
        self.d = json.loads((D / "survey-results.json").read_text(encoding="utf-8"))

    def test_wallbricks_cannot_qualify(self):
        for a in self.d["wallbrick"]["archetypes"]:
            w, _, h = a["sizeM"]
            self.assertLess(h, 1.8, a["name"])
            self.assertLess(w, 2.7, a["name"])
        self.assertEqual(self.d["wallbrick"]["verdict"], "REJECT")

    def test_barrier_solid_collision_is_low(self):
        for a in self.d["storedConcreteFamily"]:
            if "solidBoundGeometryMaxZM" in a:
                self.assertLess(a["solidBoundGeometryMaxZM"], 1.0, a["name"])

    def test_decision_and_no_deployable_claim(self):
        self.assertFalse(self.d["decision"]["genuineStockFullHeightMasonryPropFound"])
        plan = json.loads((D / "synthetic-target-plan.json").read_text(encoding="utf-8"))
        self.assertEqual(plan["status"], "OFFLINE_FIXTURE_NOT_DEPLOYABLE")
        self.assertEqual(plan["sectionRootCount"], 5)
        self.assertGreaterEqual(plan["maxOpeningWidthM"], 1.0)


if __name__ == "__main__":
    unittest.main()
