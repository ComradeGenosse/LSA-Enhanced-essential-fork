"""Synthetic-only GT0 tests. No GTA assets, coordinates or private samples."""
import copy
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from adapter import adapt_codewalker_candidates
from provenance import graph_from_extraction, joaat
from gt0 import (
    ANOMALY_BASELINE, GT0Error, discover_spawnable_candidates, geom_world,
    hit_primitive, load_json, plan_filter_tests, public_export,
    scene_trace, transform, validate_catalog, validate_scene, vec,
)


def static_box(ident="box-a", center=None, activation="PROVEN_ACTIVE"):
    return {
        "colliderId": ident,
        "coordinateFrame": "WORLD_STATIC_YBN",
        "transformChain": [],
        "activation": activation,
        "source": {"assetId": f"SYNTHETIC_{ident}", "boundPath": "Bounds/Item[0]",
                   "primitiveId": "p1", "variantId": "synthetic_fixture_only"},
        "materialIndex": 1,
        "geometry": {"kind": "BOX", "center": center or [0, 0, 0],
                     "halfAxes": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
    }


def scene(complete=True, colliders=None):
    return {"sceneSchemaVersion": 1, "visibility": "PRIVATE_LOCAL_ONLY",
            "coverage": {"sourceSetComplete": complete,
                         "includesPlaced": complete, "includesEmbedded": complete,
                         "precedenceEstablished": complete, "notes": []},
            "colliders": [static_box()] if colliders is None else colliders,
            "spawnableCandidates": []}


def ray():
    return {"rayId": "SYNTHETIC_ray", "start": [-3, 0, 0], "end": [3, 0, 0]}


def draft_record(status="AMBIGUOUS"):
    return {
        "sampleId": "SYNTHETIC_001", "revision": 1,
        "lineage": {"originSampleId": None, "supersedes": []},
        "material": {"category": "CONCRETE", "materialName": None,
                     "materialIndex": 1, "expectedNativeHash": 42,
                     "hashDerivation": "UNVERIFIED", "materialTableProvenance": None},
        "source": {"assetRelativePath": None, "decodedPayloadSha256": None,
                   "boundPath": None, "polygonIndex": None,
                   "primitiveType": "Box", "coordinateFrame": "WORLD_STATIC_YBN",
                   "transformChain": [], "liveWinnerStatus": "UNKNOWN"},
        "target": {"worldTarget": [1, 2, 3], "safeTeleportPosition": None,
                   "expectedSurfaceNormal": None},
        "camera": {"position": None, "lookAt": None, "fieldOfViewDeg": None},
        "rays": [{"rayId": "SYNTHETIC_ray", "purpose": "PRIMARY",
                  "start": [-3, 0, 0], "end": [3, 0, 0],
                  "traceFlags": 17, "optionFlags": 7}],
        "expected": {"hitPoint": None, "normal": None, "thicknessM": None,
                     "semantics": "SINGLE_SURFACE"},
        "environment": {"gameEdition": "GTA_V_ENHANCED_SINGLE_PLAYER",
                        "gameBuild": "SYNTHETIC", "rphBuild": "SYNTHETIC",
                        "pluginCommit": "fixture", "modFingerprintId": None,
                        "archiveWinningEvidenceId": None, "iplStateEvidenceIds": []},
        "observations": [],
        "identity": {"method": "UNRESOLVED", "uniqueOfflineHitCandidate": None,
                     "activeSourceIndependentlyVerified": None,
                     "evidenceIds": [], "alternativeColliderIds": [],
                     "explanation": "No game session in synthetic tests"},
        "evidence": {"screenshots": [], "overlayRunIds": [],
                     "negativeControlObservationIds": [], "privateFiles": []},
        "verification": {"status": status, "reason": "MISSING_LIVE_EVIDENCE",
                         "reviewedAtUtc": None, "completedSessionCount": 0,
                         "independentEvidenceIds": [], "thicknessQualified": False},
    }


def catalog(records=None):
    return {"schemaVersion": 1, "visibility": "PRIVATE_LOCAL_ONLY",
            "catalogId": "SYNTHETIC_ONLY", "records":
            [draft_record()] if records is None else records}


class GeometryTests(unittest.TestCase):
    def test_world_box_hit_and_normal(self):
        z = scene_trace(scene(), [ray()])["results"][0]
        self.assertEqual(z["outcome"], "UNIQUE_OFFLINE_CANDIDATE_NOT_LIVE_CONFIRMED")
        self.assertAlmostEqual(z["hits"][0]["distanceM"], 2)
        self.assertEqual(tuple(z["hits"][0]["hitPoint"]), (-1, 0, 0))
        self.assertEqual(tuple(z["hits"][0]["normal"]), (-1, 0, 0))

    def test_inside_box_is_algorithmic_exit_not_native_proof(self):
        g = geom_world(static_box())
        h = hit_primitive((0, 0, 0), (1, 0, 0), 3, g)
        self.assertEqual(h["distanceM"], 1)
        self.assertTrue(h["startsInside"])
        self.assertEqual(ANOMALY_BASELINE["inside_solid_hits"], 0)

    def test_near_overlapping_box_candidates_ambiguous(self):
        b = static_box("overlap", [0.01, 0, 0])
        z = scene_trace(scene(colliders=[static_box(), b]), [ray()])["results"][0]
        self.assertEqual(z["outcome"], "AMBIGUOUS_OFFLINE")
        self.assertEqual(len(z["nearFirstHitColliderIds"]), 2)
        self.assertEqual(len(z["hits"]), 2)

    def test_proven_inactive_is_excluded_only_if_explicit(self):
        z = scene_trace(scene(colliders=[static_box("inactive", activation="PROVEN_INACTIVE"),
                                          static_box("active")]), [ray()])["results"][0]
        self.assertEqual(z["nearFirstHitColliderIds"], ["active"])

    def test_unknown_source_graph_blocks_uniqueness(self):
        z = scene_trace(scene(complete=False), [ray()])["results"][0]
        self.assertEqual(z["outcome"], "AMBIGUOUS_OFFLINE")

    def test_possible_activation_blocks_uniqueness(self):
        z = scene_trace(scene(colliders=[static_box(activation="POSSIBLY_ACTIVE")]),
                        [ray()])["results"][0]
        self.assertEqual(z["outcome"], "AMBIGUOUS_OFFLINE")

    def test_triangle_hit_both_sides(self):
        tri = static_box()
        tri["geometry"] = {"kind": "TRIANGLE",
                           "vertices": [[0, -1, -1], [0, 1, -1], [0, 0, 1]]}
        z = scene_trace(scene(colliders=[tri]), [ray()])["results"][0]
        self.assertEqual(z["outcome"], "UNIQUE_OFFLINE_CANDIDATE_NOT_LIVE_CONFIRMED")
        self.assertAlmostEqual(z["hits"][0]["distanceM"], 3)
        self.assertEqual(tuple(z["hits"][0]["hitPoint"]), (0, 0, 0))

    def test_nested_row_transforms_and_nonuniform_scale(self):
        # All values entirely synthetic; row-vector convention.
        translate = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [10, 20, 30, 1]]
        rotate = [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        v = transform([1, 0, 0], [rotate, translate])
        self.assertEqual(v, (10, 21, 30))
        b = static_box()
        b["coordinateFrame"] = "LOCAL_PLACED"
        b["transformChain"] = [rotate, translate]
        b["geometry"]["halfAxes"] = [[2, 0, 0], [0, 1, 0], [0, 0, .5]]
        test = {"rayId": "SYNTHETIC_rotated", "start": [7, 20, 30],
                "end": [13, 20, 30]}
        z = scene_trace(scene(colliders=[b]), [test])["results"][0]
        self.assertAlmostEqual(z["hits"][0]["distanceM"], 2)
        self.assertEqual(tuple(z["hits"][0]["hitPoint"]), (9, 20, 30))

    def test_no_double_transform_static_ybn(self):
        bad = static_box()
        bad["transformChain"] = [[[1, 0, 0, 0], [0, 1, 0, 0],
                                  [0, 0, 1, 0], [5, 0, 0, 1]]]
        with self.assertRaisesRegex(GT0Error, "already world-space"):
            scene_trace(scene(colliders=[bad]), [ray()])

    def test_reject_non_affine_skew_invalid_and_degenerate(self):
        bad = static_box()
        bad["geometry"]["halfAxes"][1] = [1, 1, 0]
        with self.assertRaisesRegex(GT0Error, "skewed"):
            geom_world(bad)
        with self.assertRaises(GT0Error):
            vec([1, 2, float("nan")])
        with self.assertRaises(GT0Error):
            scene_trace(scene(), [{"rayId": "bad", "start": [0, 0, 0],
                                   "end": [0, 0, 0]}])

    def test_missing_source_or_duplicate_fail(self):
        with self.assertRaisesRegex(GT0Error, "duplicate"):
            validate_scene(scene(colliders=[static_box(), static_box()]))
        b = static_box()
        del b["source"]["boundPath"]
        with self.assertRaisesRegex(GT0Error, "provenance"):
            validate_scene(scene(colliders=[b]))

    def test_full_scene_can_have_no_hit_but_never_confirmed(self):
        z = scene_trace(scene(), [{"rayId": "empty", "start": [-3, 3, 3],
                                   "end": [3, 3, 3]}])["results"][0]
        self.assertEqual(z["outcome"], "NO_CANDIDATE_HIT")


class AdapterAndDiscoveryTests(unittest.TestCase):
    def test_codewalker_adapter_does_not_invent_triangle_vertices(self):
        a = {
            "asset": "SYNTHETIC_ybn", "bound": "Bounds/Children/Item[0]",
            "polygonIndex": 1, "primitive": "Box", "materialIndex": 2,
            "center": [0, 0, 0], "axes": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "dimensionsM": [2, 4, 2]
        }
        triangle = {"asset": "SYNTHETIC_ybn", "bound": "Bounds",
                    "polygonIndex": 2, "primitive": "Triangle", "materialIndex": 1}
        private = {"schemaVersion": 1,
                   "candidatePool": {"surfaces": [a, a, triangle], "walls": [a]}}
        result = adapt_codewalker_candidates(private)
        self.assertEqual(len(result["colliders"]), 1)
        self.assertEqual(len(result["unmodeledSources"]), 1)
        self.assertEqual(result["colliders"][0]["activation"], "POSSIBLY_ACTIVE")
        self.assertFalse(result["coverage"]["sourceSetComplete"])
        self.assertEqual(result["colliders"][0]["geometry"]["halfAxes"][1], [0.0, 2.0, 0.0])

    def test_optional_catalog_discovery_never_claims_spawn_proven(self):
        s = scene()
        s["spawnableCandidates"] = [
            {"modelHash": 100, "source": "SYNTHETIC_CATALOG", "status": "CANDIDATE_ONLY"},
            {"modelHash": 100, "source": "SYNTHETIC_CATALOG", "status": "CANDIDATE_ONLY"},
            {"modelHash": 200, "source": "SYNTHETIC_CODEWALKER", "status": "CANDIDATE_ONLY"},
        ]
        out = discover_spawnable_candidates(s)
        self.assertEqual(len(out["candidates"]), 2)
        self.assertTrue(all(x["status"] == "CANDIDATE_ONLY" for x in out["candidates"]))

    def test_discovery_rejects_fake_verified_status(self):
        s = scene()
        s["spawnableCandidates"] = [
            {"modelHash": 100, "source": "SYNTHETIC",
             "status": "CONFIRMED"}
        ]
        with self.assertRaises(GT0Error):
            discover_spawnable_candidates(s)

    def test_filter_plan_preserves_original_and_has_five_variants(self):
        out = plan_filter_tests(catalog())
        self.assertEqual(len(out["plan"]), 5)
        self.assertEqual(out["plan"][0]["traceFlags"], 17)
        self.assertEqual(out["plan"][0]["optionFlags"], 7)
        self.assertTrue(all(x["baselineImmutable"] and x["executionStatus"] == "NOT_RUN"
                            for x in out["plan"]))
        self.assertEqual(out["baseline"]["material_misses"], [2, 6])
        self.assertEqual(out["baseline"]["wall_different_entities"], [3, 4])



class ProvenanceTests(unittest.TestCase):
    def test_reference_graph_tracks_variants_and_unresolved_archetypes(self):
        # Entirely synthetic YMAP/YBN graph; not a GTA location or asset.
        h = joaat("SYNTHETIC_WORLD")
        y = joaat("SYNTHETIC_PARENT")
        manifest = {
            "schemaVersion": 1,
            "assets": [
                {"originalPath": "SYNTHETIC/SYNTHETIC_WORLD.ybn",
                 "topArchive": "SYNTHETIC_BASE.rpf", "decodedPayloadSha256": "0" * 64},
                {"originalPath": "SYNTHETIC/SYNTHETIC_PARENT.ymap",
                 "topArchive": "SYNTHETIC_BASE.rpf"},
                {"originalPath": "SYNTHETIC/SYNTHETIC_CHILD.ymap",
                 "topArchive": "SYNTHETIC_BASE.rpf"},
            ],
            "archives": [{"path": "SYNTHETIC_BASE.rpf", "sha256": "a" * 64}],
            "relationships": [{
                "ymap": "SYNTHETIC/SYNTHETIC_CHILD.ymap",
                "parentHash": y,
                "physicsDictionaryHashes": [h],
                "archetypeHashes": [12345],
            }],
        }
        g = graph_from_extraction(manifest)
        self.assertEqual(len(g["nodes"]), 3)
        self.assertEqual(len(g["edges"]), 3)
        self.assertEqual(g["summary"]["unresolvedReferences"], 1)
        self.assertFalse(g["summary"]["activeCollisionPrecedenceVerified"])
        self.assertTrue(all(n["runtimeActiveStatus"] == "UNKNOWN" for n in g["nodes"]))
        self.assertEqual(len(next(e for e in g["edges"]
                                  if e["relation"] == "YMAP_PHYSICS_DICTIONARY")["potentialTargets"]), 1)

    def test_missing_parent_and_dictionary_remain_unresolved(self):
        m = {"schemaVersion": 1,
             "assets": [{"originalPath": "SYNTHETIC/A.ymap"}],
             "archives": [],
             "relationships": [{"ymap": "SYNTHETIC/A.ymap",
                                "parentHash": 123, "physicsDictionaryHashes": [456],
                                "archetypeHashes": []}]}
        g = graph_from_extraction(m)
        self.assertEqual(g["summary"]["unresolvedReferences"], 2)

    def test_manifest_rejects_path_traversal_and_missing_source(self):
        m = {"schemaVersion": 1,
             "assets": [{"originalPath": "../private.xbn"}], "relationships": []}
        with self.assertRaisesRegex(GT0Error, "traversing"):
            graph_from_extraction(m)
        m = {"schemaVersion": 1, "assets": [],
             "relationships": [{"ymap": "SYNTHETIC/not_in_assets.ymap"}]}
        with self.assertRaisesRegex(GT0Error, "absent"):
            graph_from_extraction(m)

    def test_empty_ray_list_duplicate_ray_ids_and_public_scene_disallowed(self):
        s = scene()
        with self.assertRaisesRegex(GT0Error, "nonempty"):
            scene_trace(s, [])
        with self.assertRaisesRegex(GT0Error, "duplicate private ray"):
            scene_trace(s, [ray(), ray()])
        s["visibility"] = "PUBLIC"
        with self.assertRaisesRegex(GT0Error, "private source"):
            scene_trace(s, [ray()])



class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = load_json(ROOT.parent / "research" /
                               "verified-material-catalog.schema.json")

    def test_synthetic_ambiguous_record_is_valid(self):
        self.assertEqual(validate_catalog(catalog(), self.schema), [])

    def test_confirmed_cannot_be_purchased_by_status_change(self):
        c = catalog()
        c["records"][0]["verification"]["status"] = "CONFIRMED"
        errors = validate_catalog(c, self.schema)
        self.assertTrue(errors, "schema/domain gates should reject empty evidence")
        self.assertTrue(any("observations" in e or "evidence" in e for e in errors))

    def test_duplicate_observations_rejected(self):
        c = catalog()
        a = {"observationId": "SYNTHETIC_obs1", "runId": "SYNTHETIC_run1",
             "sessionId": "SYNTHETIC_session1",
             "rayId": "SYNTHETIC_ray", "timeUtc": "2026-01-01T00:00:00Z",
             "shapeTestState": 2, "hit": False, "hitPoint": None, "normal": None,
             "materialHash": None, "entityHandle": None, "traceFlags": 17,
             "optionFlags": 7, "destinationCollisionReady": False, "notes": "",
             "result": "MISS"}
        c["records"][0]["observations"] = [a, copy.deepcopy(a)]
        self.assertTrue(any("duplicate observation" in e for e in
                            validate_catalog(c, self.schema)))

    def test_ray_reference_must_exist(self):
        c = catalog()
        a = {"observationId": "SYNTHETIC_obs1", "runId": "SYNTHETIC_run1",
             "sessionId": "SYNTHETIC_session1",
             "rayId": "NOT_A_RAY", "timeUtc": "2026-01-01T00:00:00Z",
             "shapeTestState": 2, "hit": False, "hitPoint": None, "normal": None,
             "materialHash": None, "entityHandle": None, "traceFlags": 17,
             "optionFlags": 7, "destinationCollisionReady": False, "notes": "",
             "result": "MISS"}
        c["records"][0]["observations"] = [a]
        self.assertTrue(any("missing ray" in e for e in validate_catalog(c, self.schema)))

    def test_public_export_deny_by_default_freeform_leaks(self):
        c = catalog()
        secret = "SECRET_PRIVATE_COORD_XYZ_987654321"
        c["records"][0]["source"]["assetRelativePath"] = secret
        c["records"][0]["verification"]["reason"] = secret
        c["catalogId"] = secret
        result = public_export(c)
        self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(result["statusCounts"]["AMBIGUOUS"], 1)
        self.assertEqual(result["baseline"]["walls_within_1cm"], 8)
        c["visibility"] = "PUBLIC"
        with self.assertRaises(GT0Error):
            public_export(c)

    def test_bad_nonfinite_ray_fails(self):
        c = catalog()
        c["records"][0]["rays"][0]["end"][0] = math.nan
        self.assertTrue(validate_catalog(c, self.schema))


if __name__ == "__main__":
    unittest.main()
