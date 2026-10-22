"""X7.3 read-only diagnostics and frozen evidence comparison (no GTA)."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "native/fragment-x7/WpsBreachLabX7.3.cs"
SUCCESS = ROOT / "docs/agent-operations/2026-10-22/p2smoke-repair/live/evidence/20261022-175645-5efa53/trials.jsonl"
FAILURE = ROOT / "docs/agent-operations/2026-10-22/x73-local-validation/live/evidence/20261022-190534-db7fdf/trials.jsonl"

def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]

def first(source, kind):
    return next((r for r in source if r.get("kind") == kind), None)

class DiagnosticSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8")
        cls.shot = cls.source.split("void X7Shot(", 1)[1].split("void X7DiagOther(", 1)[0]

    def test_selector_remains_the_only_authority(self):
        self.assertEqual(self.shot.count("ImpactSectionSelector.TryPredictAndSelect("), 1)
        self.assertIn("X7Commit(bestSelection)", self.shot)
        self.assertIn("selection.TimeToFaceSeconds <= horizonSeconds && readyCount == 1", self.shot)
        self.assertIn('if (S(a, "fallback", "0") != "0")', self.shot.replace('if(S(a,"fallback","0")!="0")', 'if (S(a, "fallback", "0") != "0")'))
        self.assertNotIn("World.AddExplosion(", self.shot)
        self.assertNotIn("X7Commit();", self.shot)
        self.assertIn("if (beforeShotHandles.Contains(p.Handle)) { diagExcluded++; continue; }", self.shot)

    def test_rejection_reasons_cover_selector_guards(self):
        for reason in ("nonfinite", "normal_speed", "behind_face", "beyond_prediction_window",
                       "outside_sheet_u", "outside_sheet_v", "unclassified_selector_rejection"):
            self.assertIn('return "' + reason + '";', self.source)
        self.assertIn("ImpactSectionSelector.MaximumHorizonSeconds", self.source)
        self.assertIn("ImpactSectionSelector.Width", self.source)
        self.assertIn("ImpactSectionSelector.SheetHeight", self.source)
        self.assertIn("ImpactSectionSelector.MinimumNormalSpeed", self.source)

    def test_only_bounded_memory_in_gameplay_loop(self):
        self.assertIn("if (recent.Count == 48) recent.Dequeue();", self.source)
        self.assertIn("if (!first.ContainsKey(reason)) first[reason] = sample;", self.source)
        self.assertIn('Row("x7_diag_summary"', self.shot)
        self.assertIn('Row("x7_diag_count"', self.shot)
        self.assertIn('Row("x7_diag_sample"', self.source)
        self.assertLess(self.shot.index('Row("x7_diag_summary"'), self.shot.index('foreach (X7Frame fr in trace)'))
        self.assertIn('if (!seen && diagExplosionFrame < 0)', self.shot)
        self.assertIn("diagExplosionFrame = gf;", self.shot)
        self.assertIn("if (exFrame < 0 && (seen || mode == \"manual\" || mode == \"none\")", self.shot)
        self.assertIn('Row("x7_result"', self.shot)

    def test_frozen_success_failure_differ_at_new_acceptance_boundary(self):
        success, failure = rows(SUCCESS), rows(FAILURE)
        a, b = first(success, "x7_shot_begin"), first(failure, "x7_shot_begin")
        self.assertIsNotNone(a)
        self.assertIsNotNone(b)
        self.assertEqual((a["aimX"], a["aimY"], a["aimZ"]),
                         (b["aimX"], b["aimY"], b["aimZ"]))
        self.assertEqual((a["baseHorizonMs"], a["frameK"], a["aimU"], a["aimV"]),
                         (b["baseHorizonMs"], b["frameK"], b["aimU"], b["aimV"]))
        shot_a, shot_b = first(success, "x7_result"), first(failure, "x7_result")
        self.assertTrue(shot_a["committed"])
        self.assertFalse(shot_b["committed"])
        self.assertEqual((shot_a["nativeParts"], shot_b["nativeParts"]), (2, 0))
        self.assertGreater(len([r for r in success if r["kind"] == "x7_track"]), 0)
        self.assertEqual(len([r for r in failure if r["kind"] == "x7_track"]), 0)
        self.assertEqual(first(failure, "x7_corridor")["hit"], False)
        # The old trace is only accepted samples; the new failed run has no rejected-sample logs.
        self.assertFalse(any(r["kind"] == "x7_diag_summary" for r in failure))
        print("COMPARE: identical aim and 60ms shot timing; X7.2c tracked and fractured 2, X7.3 recorded no accepted sample")
        print("LIMIT: historical X7.3 rejection cause remains unobservable; a newly instrumented shot is required")

if __name__ == "__main__":
    unittest.main()
