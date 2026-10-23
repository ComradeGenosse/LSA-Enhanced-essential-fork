import importlib.util
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INC = ROOT / "environment" / "LabEnvironment.inc.cs"
PATCH = ROOT / "environment_patch.py"


class LabEnvironmentSourceChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = INC.read_text(encoding="utf-8")
        spec = importlib.util.spec_from_file_location("environment_patch", PATCH)
        cls.patch = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.patch)

    def test_p2_commands_are_opt_in_and_not_implicit(self):
        s = self.source
        self.assertIn('S(a, "approved", "0") != "1"', s)
        self.assertIn('S(a, "enable", "0") != "1"', s)
        self.assertIn("bool labEnvActive", s)
        self.assertIn("lab_env_enable_before_staging", s)
        self.assertIn("lab_env_already_enabled", s)
        self.assertIn("lab_env_story_mode_only", s)
        self.assertIn("lab_env_player_outside_approved_radius", s)
        self.assertIn("lab_env_invalid_site_or_radius", s)
        self.assertNotIn("World.AddExplosion(", s)
        self.assertNotIn("World.CreateProp(", s)

    def test_population_is_per_frame_and_radius_gated(self):
        s = self.source
        self.assertIn("labEnvInRadius && labEnvSuppressPopulation", s)
        for name in (
            "SET_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME",
            "SET_RANDOM_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME",
            "SET_PARKED_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME",
            "SET_PED_DENSITY_MULTIPLIER_THIS_FRAME",
            "SET_SCENARIO_PED_DENSITY_MULTIPLIER_THIS_FRAME",
        ):
            self.assertIn("Hash." + name, s)
        self.assertIn('S(a, "population", "1")', s)
        self.assertIn("Interval = 0;", s)
        self.assertIn("Interval = 200;", s)
        self.assertNotIn("CLEAR_AREA_OF_VEHICLES", s)
        self.assertNotIn("SET_ROADS_IN_AREA", s)
        self.assertNotIn("ENABLE_DISPATCH_SERVICE", s)

    def test_world_damage_mechanics_untouched(self):
        s = self.source
        self.assertNotIn("Game.TimeScale", s)
        self.assertNotIn("SET_TIME_SCALE", s)
        self.assertNotIn("SET_EXPLOSIVE_AMMO_THIS_FRAME", s)
        self.assertNotIn("SET_EVERYONE_IGNORE_PLAYER", s)
        self.assertNotIn("x7SelPos =", s)
        self.assertNotIn("x7Model =", s)

    def test_snapshot_before_mark_active_and_uncertainty_visible(self):
        s = self.source
        for name in ("labEnvSavedInvincible", "labEnvSavedWanted",
                     "labEnvSavedMaxWanted", "labEnvSavedClock",
                     "labEnvSavedWeather", "labEnvSavedRpgAmmo",
                     "labEnvSavedWeapon"):
            self.assertIn(name, s)
        i = s.index("void LabEnvSetup")
        a = s.index("labEnvSavedWeather = weather", i)
        b = s.index("labEnvActive = true", i)
        c = s.index("Game.Player.IsInvincible = true", i)
        self.assertLess(a, b)
        self.assertLess(b, c)
        self.assertIn('lab_env_weather_snapshot_unknown', s)
        self.assertIn('write_only_police_flags_return_to_normal_defaults_not_exact_snapshot', s)
        self.assertIn('ped_identity_changed_cannot_restore_ped_flags_or_weapon', s)
        self.assertIn('restore_blocked_online_state', s)

    def test_restore_attempts_independent_components_and_guard(self):
        s = self.source
        self.assertIn('lab_env_restore_native_context_first', s)
        self.assertIn("void LabEnvAbort() { LabEnvShutdown(); }", s)
        self.assertIn("if (labEnvRpgGiven)", s)
        self.assertIn("else if (labEnvAmmoChanged)", s)
        self.assertIn("lab_env_restoration_partial_review_required", s)
        self.assertIn("Game.Player.IsInvincible = labEnvSavedInvincible", s)
        self.assertIn("World.CurrentDayTime = labEnvSavedClock", s)
        self.assertIn("World.Weather = labEnvSavedWeather", s)

    def test_generator_fails_closed_on_anchor_drift(self):
        for source in ("", "void OnTick() {}", 'case "labsurvey":', 'no OnAborted'):
            with self.subTest(source=source):
                with self.assertRaises(RuntimeError):
                    self.patch.apply_environment(source)

    def test_source_integration_is_idempotency_guarded(self):
        # Synthetic tiny source representing exactly four generator anchors.
        src = (
            '            case "labsurvey": LabSurvey(a); break;\n'
            '    void OnTick()\n    {\n        Beat();\n'
            '    void OnAborted() { try { X4Restore(); } catch { } try { X7Restore(); } finally { try { CleanupAll(); RestorePlayer(); } catch { } } }\n'
            '    // ===================================================================== lab geometry'
        )
        out = self.patch.apply_environment(src)
        for verb in ("x8labsetup", "x8labstatus", "x8labrestore"):
            self.assertEqual(out.count('case "' + verb + '"'), 1)
        self.assertEqual(out.count("LabEnvTick();"), 1)
        self.assertEqual(out.count("LabEnvAbort();"), 1)
        self.assertEqual(out.count("void LabEnvSetup("), 1)
        with self.assertRaises(RuntimeError):
            self.patch.apply_environment(out)

    def test_local_build_is_explicitly_hooked(self):
        source = (ROOT / "build_runtime.py").read_text(encoding="utf-8")
        self.assertIn("from environment_patch import apply_environment", source)
        self.assertIn("source = apply_environment(source)", source)


if __name__ == "__main__":
    unittest.main()
