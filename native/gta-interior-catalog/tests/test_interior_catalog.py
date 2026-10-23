"""Offline tests for the interior catalog tool. Synthetic fixtures only - no Rockstar data required."""
import json
import math
import os
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import interior_catalog as ic  # noqa: E402

S = math.sqrt(0.5)
ROT90 = [0, 0, S, S]  # +90 degrees about Z


def arch(name, h, layer, dlc, rooms, portals, entities, ytyp=None):
    return {
        "archetype": name, "hash": h, "resolved": True, "ytyp": ytyp or ("%s\\x.ytyp" % layer), "ytypFile": "x.ytyp", "topRpf": layer + ".rpf", "layer": layer, "dlc": dlc,
        "mloFlags": 1, "lodDist": 100, "flags": 0, "bbMin": [0, 0, 0], "bbMax": [0, 0, 0], "bsCentre": [0, 0, 0], "bsRadius": 0, "timeCycleModifiers": 0,
        "rooms": [{"index": i, "name": n, "bbMin": b[0], "bbMax": b[1], "flags": 0, "floorId": 0, "portalCount": 1, "exteriorVisibilityDepth": -1, "timecycle": "0", "attachedObjects": 0} for i, (n, b) in enumerate(rooms)],
        "portals": [{"index": i, "roomFrom": a, "roomTo": b, "flags": 0, "opacity": 0, "audioOcclusion": 0, "center": c, "cornerCount": 4, "corners": [[c[0], c[1], c[2], 0]] * 4, "attachedObjects": 0} for i, (a, b, c) in enumerate(portals)],
        "entitySets": [], "entities": [{"index": i, "archetype": n, "hash": 1000 + i, "resolved": True, "position": p, "rotation": [0, 0, 0, 1], "scaleXY": 1, "scaleZ": 1, "flags": 0, "guid": i, "parentIndex": -1, "lodDist": 50, "room": 1} for i, (n, p) in enumerate(entities)],
    }


def inst(name, h, layer, dlc, pos, rot, ents_local, ymap="x_milo_.ymap", group=0):
    world = [ic.to_world({"position": pos, "rotationRaw": rot, "scaleXY": 1, "scaleZ": 1}, p) for p in ents_local]
    lo = [min(w[i] for w in world) - 1 for i in range(3)]
    hi = [max(w[i] for w in world) + 1 for i in range(3)]
    return {"archetype": name, "hash": h, "resolved": True, "ymap": layer + "\\" + ymap, "ymapName": ymap, "topRpf": layer + ".rpf", "layer": layer, "dlc": dlc, "instanceIndex": 0, "ymapParent": "0", "ymapFlags": 0, "ymapContentFlags": 0,
            "position": pos, "rotationRaw": rot, "scaleXY": 1, "scaleZ": 1, "entityFlags": 0, "guid": 7, "lodLevel": "LODTYPES_DEPTH_HD", "parentIndex": -1, "lodDist": 100, "groupId": group, "floorId": 0, "numExitPortals": 1, "mloInstFlags": 0,
            "defaultEntitySets": [], "entitiesExtents": {"min": lo, "max": hi}}


def write_raw(d, mutate=None):
    ents_local = [[1, 2, 0], [-3, 4, 1], [5, -2, 2]]
    shop_rooms = [("limbo", ([-10, -10, -2], [10, 10, 6])), ("GtaMloRoom001", ([-6, -6, 0], [6, 6, 4])), ("back", ([-6, 0, 0], [6, 8, 4]))]
    shop_portals = [(1, 0, [0, -6, 1]), (1, 2, [0, 0, 1])]
    shop_ents = [("tst_counter", ents_local[0]), ("tst_shelf", ents_local[1]), ("tst_lamp", ents_local[2])]
    a = [
        arch("tst_shop", 111, "base", "", shop_rooms, shop_portals, shop_ents),
        arch("tst_shop", 111, "update-dlcpack", "mpheist", shop_rooms, shop_portals, shop_ents + [("tst_extra", [0, 0, 0])], ytyp="update-dlcpack\\y.ytyp"),
        arch("tst_subway_vault", 222, "base", "", [("limbo", ([-5, -5, -5], [5, 5, 5])), ("r1", ([-4, -4, -4], [4, 4, 4])), ("r2", ([-4, -4, -4], [4, 4, 4]))], [(1, 2, [0, 0, 0])], [("tst_pipe", [0, 0, 0])]),
        arch("apa_tst_flat", 333, "update-dlcpack", "mpapartment", [("limbo", ([-5, -5, -5], [5, 5, 5])), ("r1", ([-4, -4, -4], [4, 4, 4])), ("r2", ([-4, -4, -4], [4, 4, 4]))], [(1, 0, [0, 0, 0])], [("tst_pipe", [0, 0, 0])]),
        arch("tst_orphan", 444, "base", "", [("limbo", ([0, 0, 0], [1, 1, 1]))], [], []),
    ]
    i = [
        inst("tst_shop", 111, "base", "", [100, 200, 10], ROT90, ents_local),
        inst("tst_shop", 111, "update-dlcpack", "mpheist", [100, 200, 10], ROT90, ents_local, ymap="y_milo_.ymap"),
        inst("tst_subway_vault", 222, "base", "", [500, 500, -20], [0, 0, 0, 1], [[0, 0, 0]]),
        inst("apa_tst_flat", 333, "update-dlcpack", "mpapartment", [900, 100, 80], [0, 0, 0, 1], [[0, 0, 0]]),
    ]
    if mutate:
        mutate(a, i)
    with open(os.path.join(d, "mlo-ytyp-0.jsonl"), "w") as f:
        for r in a:
            f.write(json.dumps(r) + "\n")
    with open(os.path.join(d, "mlo-inst-0.jsonl"), "w") as f:
        for r in i:
            f.write(json.dumps(r) + "\n")
    with open(os.path.join(d, "ymaps-0.tsv"), "w") as f:
        f.write("0\tbase\\streams.ymap\tbase\t\tstreams\t0\t0\t0\n")
    with open(os.path.join(d, "ents-0.tsv"), "w") as f:
        f.write("\t".join(["9001", "tst_building", "102", "201", "10", "0", "0", "0", "1", "0", "5", "LODTYPES_DEPTH_HD", "0", "-1"]) + "\n")
        f.write("\t".join(["9001", "tst_building", "102", "201", "10", "0", "0", "0", "1", "0", "6", "LODTYPES_DEPTH_HD", "0", "-1"]) + "\n")  # duplicate must collapse
        f.write("\t".join(["9002", "tst_tree_big", "101", "200", "10", "0", "0", "0", "1", "0", "7", "LODTYPES_DEPTH_HD", "0", "-1"]) + "\n")  # vegetation filtered
        f.write("\t".join(["9003", "tst_far_hall", "5000", "5000", "10", "0", "0", "0", "1", "0", "8", "LODTYPES_DEPTH_HD", "0", "-1"]) + "\n")
    with open(os.path.join(d, "archetypes-0.tsv"), "w") as f:
        for h, n, dims in ((9001, "tst_building", (12, 10, 8)), (9002, "tst_tree_big", (12, 12, 12)), (9003, "tst_far_hall", (30, 30, 10))):
            f.write("\t".join([str(h), n, "0", "0", "0", str(dims[0]), str(dims[1]), str(dims[2]), "ASSET_TYPE_DRAWABLE", "100", "0", "-", "base", "x.ytyp"]) + "\n")
    with open(os.path.join(d, "files.tsv"), "w") as f:
        for n in ("tst_counter", "tst_shelf", "tst_lamp"):
            f.write("\t".join([n, ".ydr", "10", "base", "", "x64a.rpf\\%s.ydr" % n]) + "\n")
        f.write("\t".join(["tst_shop", ".ybn", "10", "base", "", "x64a.rpf\\tst_shop.ybn"]) + "\n")


class MathTests(unittest.TestCase):
    def test_rotation_about_z(self):
        p = ic.to_world({"position": [10, 20, 30], "rotationRaw": ROT90, "scaleXY": 1, "scaleZ": 1}, (1, 0, 0))
        self.assertAlmostEqual(p[0], 10, places=5)
        self.assertAlmostEqual(p[1], 21, places=5)
        self.assertAlmostEqual(p[2], 30, places=5)

    def test_identity_and_scale(self):
        p = ic.to_world({"position": [1, 1, 1], "rotationRaw": [0, 0, 0, 1], "scaleXY": 2, "scaleZ": 3}, (1, 1, 1))
        self.assertEqual([round(v, 6) for v in p], [3, 3, 4])

    def test_aabb_world_rotates_extents(self):
        lo, hi = ic.aabb_world({"position": [0, 0, 0], "rotationRaw": ROT90, "scaleXY": 1, "scaleZ": 1}, (0, 0, 0), (4, 2, 1))
        self.assertAlmostEqual(lo[0], -2, places=5)
        self.assertAlmostEqual(hi[1], 4, places=5)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.raw = os.path.join(self.tmp.name, "raw")
        self.out = os.path.join(self.tmp.name, "out")
        os.makedirs(self.raw)
        write_raw(self.raw)
        self.cov = ic.build(self.raw, self.out)
        self.db = sqlite3.connect(os.path.join(self.out, "catalog.sqlite"))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def q(self, sql, *a):
        return self.db.execute(sql, a).fetchall()

    def test_counts(self):
        c = self.cov["counts"]
        self.assertEqual(c["interiors_unique"], 4)
        self.assertEqual(c["variants_ytyp_defs"], 5)
        self.assertEqual(c["instance_records"], 4)
        self.assertEqual(c["placements_unique"], 3)  # shop base+dlc merge
        self.assertEqual(c["interiors_without_placement"], 1)
        self.assertEqual(c["variants_differing_interiors"], 1)

    def test_exit_portals_are_topology_only(self):
        self.assertEqual(self.q("SELECT exit_portal_count FROM variants WHERE layer='base' AND interior_hash=111")[0][0], 1)
        self.assertEqual(self.q("SELECT exit_portal_count FROM variants WHERE interior_hash=222")[0][0], 0)

    def test_placement_merge_and_world_room(self):
        row = self.q("SELECT layers, source_count FROM placements WHERE interior='tst_shop'")[0]
        self.assertEqual(row, ("base,update-dlcpack", 2))
        lo, hi = [json.loads(v) for v in self.q("SELECT world_min, world_max FROM placement_rooms WHERE room_idx=1 AND placement_id=(SELECT id FROM placements WHERE interior='tst_shop')")[0]]
        self.assertAlmostEqual(lo[0], 94, delta=0.01)  # room +-6 about (100,200) after 90deg rotation
        self.assertAlmostEqual(hi[1], 206, delta=0.01)

    def test_nearby_structures_filtered_and_deduped(self):
        names = [r[0] for r in self.q("SELECT archetype FROM nearby_structures WHERE placement_id=(SELECT id FROM placements WHERE interior='tst_shop')")]
        self.assertEqual(names, ["tst_building"])

    def test_assumption_flags(self):
        self.assertEqual(self.q("SELECT underground_like_assumed FROM placements WHERE interior='tst_subway_vault'")[0][0], 1)
        self.assertEqual(self.q("SELECT online_like_assumed FROM placements WHERE interior='apa_tst_flat'")[0][0], 1)
        self.assertEqual(self.q("SELECT online_like_assumed FROM placements WHERE interior='tst_shop'")[0][0], 0)

    def test_asset_presence_and_ybn_hint(self):
        v = self.q("SELECT assets_present, assets_missing FROM variants WHERE layer='base' AND interior_hash=111")[0]
        self.assertEqual(v, (3, 0))
        self.assertIn("tst_shop", self.q("SELECT ybn_name_matches FROM placements WHERE interior='tst_shop'")[0][0])

    def test_ranking(self):
        with open(os.path.join(self.out, "candidates.json")) as fh:
            cand = json.load(fh)
        self.assertEqual(cand["candidates"][0]["interior"], "tst_shop")
        self.assertLessEqual(len(cand["candidates"]), 5)
        self.assertIn("NOT prove", cand["disclaimer"])
        self.assertTrue(cand["candidates"][0]["assumptions"])

    def test_validate_ok_and_deterministic(self):
        self.assertEqual(ic.validate(self.out), [])
        out2 = os.path.join(self.tmp.name, "out2")
        ic.build(self.raw, out2)
        self.assertEqual(ic.fingerprint(self.out), ic.fingerprint(out2))
        for f in ("candidates.json", "coverage.json", "interiors-summary.json"):
            with open(os.path.join(self.out, f)) as a, open(os.path.join(out2, f)) as b:
                self.assertEqual(a.read(), b.read())

    def test_validate_detects_corruption(self):
        self.db.close()
        db = sqlite3.connect(os.path.join(self.out, "catalog.sqlite"))
        db.execute("DELETE FROM interiors WHERE hash=111")
        db.commit()
        db.close()
        errs = ic.validate(self.out)
        self.assertTrue(any("variants without interior" in e for e in errs))
        self.db = sqlite3.connect(os.path.join(self.out, "catalog.sqlite"))

    def test_search(self):
        dbp = os.path.join(self.out, "catalog.sqlite")
        self.assertTrue(ic.search(dbp, text="shelf"))
        self.assertTrue(ic.search(dbp, text="tst_building"))
        near = ic.search(dbp, near=(100, 200), radius=10)
        self.assertEqual([r[1] for r in near], ["tst_shop"])
        self.assertFalse(ic.search(dbp, text="zzz_nothing"))


class TransformValidationTests(unittest.TestCase):
    def test_wrong_transform_fails_validation(self):
        with tempfile.TemporaryDirectory() as t:
            raw, out = os.path.join(t, "r"), os.path.join(t, "o")
            os.makedirs(raw)

            def bad(a, i):
                for r in i:
                    r["entitiesExtents"] = {"min": [0, 0, 0], "max": [1, 1, 1]}
            write_raw(raw, bad)
            ic.build(raw, out)
            errs = ic.validate(out)
            self.assertTrue(any("transform validation" in e for e in errs))


class CommittedCatalogTests(unittest.TestCase):
    """Runs against the committed catalog when present (CI parity with the extracted data)."""

    CAT = os.path.join(os.path.dirname(HERE), "catalog")

    @unittest.skipUnless(os.path.exists(os.path.join(CAT, "catalog.sqlite")), "no committed catalog")
    def test_committed_catalog(self):
        self.assertEqual(ic.validate(self.CAT), [])
        with open(os.path.join(self.CAT, "coverage.json")) as fh:
            cov = json.load(fh)
        db = sqlite3.connect(os.path.join(self.CAT, "catalog.sqlite"))
        self.assertEqual(db.execute("SELECT COUNT(*) FROM placements").fetchone()[0], cov["counts"]["placements_unique"])
        self.assertEqual(db.execute("SELECT COUNT(*) FROM interiors").fetchone()[0], cov["counts"]["interiors_unique"])
        with open(os.path.join(self.CAT, "candidates.json")) as fh:
            cands = json.load(fh)["candidates"]
        self.assertTrue(1 <= len(cands) <= 5)
        self.assertEqual(len({c["interior"] for c in cands}), len(cands))
        prov = cov.get("provenance", {})
        self.assertTrue(prov.get("gameExeSha256"))
        self.assertTrue(prov.get("rawFiles"))
        for f in os.listdir(self.CAT):
            self.assertFalse(f.endswith((".ydr", ".yft", ".ybn", ".ytd", ".rpf", ".dds", ".ymap", ".ytyp")), f)
        self.assertLess(os.path.getsize(os.path.join(self.CAT, "catalog.sqlite")), 40 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
