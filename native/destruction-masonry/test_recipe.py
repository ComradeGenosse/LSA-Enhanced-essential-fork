"""X9: guard against false source qualification, asset creation and driver drift."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("x9_recipe", HERE / "recipe.py")
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


class X9OfflineTests(unittest.TestCase):
    def setUp(self):
        self.fixture = recipe.fixture_proposal()

    def assertRejected(self, value, fixture=False):
        with self.assertRaises(ValueError):
            recipe.create_plan(value, fixture=fixture)

    def test_offline_geometry_is_five_independent_roots(self):
        p = recipe.create_plan(self.fixture, fixture=True)
        self.assertEqual(p["status"], "OFFLINE_FIXTURE_NOT_DEPLOYABLE")
        self.assertEqual(p["sectionRootCount"], 5)
        self.assertEqual(p["maxOpeningWidthM"], 1.2)
        self.assertEqual(len(p["sections"]), 5)
        self.assertEqual([s["physicalIndex"] for s in p["sections"]], list(range(5)))
        self.assertEqual(p["sections"][0]["localU0M"], -1.5)
        self.assertEqual(p["sections"][-1]["localU1M"], 1.5)
        self.assertTrue(all(s["nativeRoot"].startswith("REQUIRES") for s in p["sections"]))
        self.assertEqual(sum(s["localU1M"]-s["localU0M"] for s in p["sections"]), 3.0)

    def test_deterministic_plan_and_evidence_hash(self):
        a = recipe.create_plan(self.fixture, fixture=True)
        b = recipe.create_plan(copy.deepcopy(self.fixture), fixture=True)
        self.assertEqual(a, b)
        self.assertEqual(len(a["planSha256"]), 64)
        altered = copy.deepcopy(self.fixture)
        altered["dimensions"]["widthM"] = 3.5
        self.assertNotEqual(a["planSha256"], recipe.create_plan(altered, fixture=True)["planSha256"])

    def test_operator_qualification_is_explicit_not_self_proving(self):
        self.assertRejected(self.fixture)
        qualified = copy.deepcopy(self.fixture)
        qualified["localQualification"]["evidenceId"] = "operator_p2_and_cw_0001"
        qualified["localQualification"]["gates"] = {g: True for g in recipe.GATES}
        result = recipe.create_plan(qualified)
        self.assertEqual(result["status"], "OPERATOR_ATTESTED_PLAN_NOT_DEPLOYABLE")
        self.assertIn("world collision", " ".join(result["mustProveLocally"]))
        qualified["localQualification"]["gates"]["noResidualYbnCollision"] = False
        self.assertRejected(qualified)

    def test_nonnumeric_nan_infinity_dimensions_rejected(self):
        for v in [True, None, "3.0", float("nan"), float("inf"), -1, 1]:
            data = copy.deepcopy(self.fixture)
            data["dimensions"]["widthM"] = v
            self.assertRejected(data, fixture=True)
        for name, value in [("heightM", 1.2), ("thicknessM", 0.9)]:
            data = copy.deepcopy(self.fixture)
            data["dimensions"][name] = value
            self.assertRejected(data, fixture=True)

    def test_no_negative_control_or_unverified_arbitrary_model(self):
        for model in ["prop_barier_conc_01a", "prop_fnccorgm_02e", "fake_masonry", None]:
            data = copy.deepcopy(self.fixture)
            data["sourceModel"] = model
            self.assertRejected(data, fixture=True)

    def test_exact_evidence_bool_gates(self):
        for mutation in [
            lambda d: d["localQualification"]["gates"].pop("installedModelAndCodeWalkerReload", None),
            lambda d: d["localQualification"]["gates"].update({"extra": True}),
            lambda d: d["localQualification"]["gates"].update({"installedModelAndCodeWalkerReload": 1}),
            lambda d: d["localQualification"].update({"evidenceId": "bad id"}),
        ]:
            data = copy.deepcopy(self.fixture)
            mutation(data)
            self.assertRejected(data, fixture=True)

    def test_source_is_only_additive_read_only_and_x8_unchanged(self):
        source = (HERE / "X9Survey.inc.cs").read_text(encoding="utf-8")
        builder = (HERE / "build_runtime.py").read_text(encoding="utf-8")
        self.assertIn('case "x9survey": X9Survey(a); break;', builder)
        self.assertIn("collisionOwnerQualified\", false", source)
        self.assertIn("candidateSelected\", false", source)
        self.assertIn("READ_ONLY_UNQUALIFIED", source)
        self.assertIn("35f", source)
        self.assertNotIn("Game.Player.Character.Position =", source)
        for forbidden in ["AddExplosion(", "CreateProp(", "CreateModelHide(",
                          "SetEntityCollision(", ".Delete(", "WaitCollision(", "RestorePlayer()"]:
            self.assertNotIn(forbidden, source)
        names = json.loads((HERE / "candidates.json").read_text(encoding="utf-8"))
        self.assertEqual([x["model"] for x in names["candidateModels"] if x["role"] == "candidate"],
                         ["prop_wallbrick_01", "prop_wallbrick_02", "prop_wallbrick_03"])
        for x in names["candidateModels"]:
            self.assertIn('"' + x["model"] + '"', source)


if __name__ == "__main__":
    unittest.main()
