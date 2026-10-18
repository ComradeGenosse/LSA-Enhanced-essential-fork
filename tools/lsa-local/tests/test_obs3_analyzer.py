"""OBS3 offline fault/non-exercise tests; no GTA, provider or private files."""
import importlib.util
import csv
import hashlib
import io
import json
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path

MOD = Path(__file__).resolve().parents[1] / "Analyze-Logs.py"
spec = importlib.util.spec_from_file_location("lsa_obs3_analyzer", MOD)
obs3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(obs3)
RUN = "11111111-1111-4111-8111-111111111111"
ID = "22222222-2222-4222-8222-222222222222"
MANIFEST_NAME = "source-1/logs/obs2-inventory-" + RUN + ".jsonl"
EVENT_NAME = "source-1/logs/e1-run-20261018T190000Z-" + RUN + ".jsonl"


def entries():
    return [
        {"id": "act.drive_to", "family": "activity_capability", "configuredMode": "on",
         "installed": "unknown", "implemented": True, "dependencies": [], "initialization": "unknown"},
        {"id": "act.walk_to", "family": "activity_capability", "configuredMode": "off",
         "installed": "unknown", "implemented": True, "dependencies": [], "initialization": "unknown"},
        {"id": "reaction.transport", "family": "reaction", "configuredMode": "shadow",
         "installed": "unknown", "implemented": True, "dependencies": [], "initialization": "unknown"},
        {"id": "mk.memory.cloudCuration", "family": "memory_k", "configuredMode": "on",
         "installed": "unknown", "implemented": True, "dependencies": ["mk.p2.sqlite"], "initialization": "unknown"},
        {"id": "conversation.playback", "family": "conversation", "configuredMode": "auto",
         "installed": "unknown", "implemented": True, "dependencies": [], "initialization": "unknown"},
        {"id": "native.rph", "family": "native", "configuredMode": "auto",
         "installed": "unknown", "implemented": True, "dependencies": [], "initialization": "unknown"},
        {"id": "unimplemented.feature", "family": "test", "configuredMode": "off",
         "installed": "unknown", "implemented": False, "dependencies": [], "initialization": "unknown"},
    ]


def rec(seq, event, data=None, identity=None, run=RUN):
    row = {"schemaVersion": 1, "timestamp": "2026-10-18T19:00:%02d.000Z" % (seq % 60),
           "runId": run, "sequence": seq, "event": event,
           "provider": "internal", "data": data or {}}
    if identity is not None:
        row["identity"] = identity
    return row


def fixture(events=None, systems=None, manifest=True, errors=None, missing_roots=None,
            altered_manifest=False, extra_files=None):
    files = {}
    if manifest:
        obj = {"kind": "obs2_system_inventory", "schemaVersion": 1, "runId": RUN,
               "recordedAt": "2026-10-18T19:00:00.000Z",
               "systems": systems if systems is not None else entries()}
        manifest_bytes = (json.dumps(obj, separators=(",", ":")) + "\n").encode()
        files[MANIFEST_NAME] = manifest_bytes
        digest = hashlib.sha256(manifest_bytes).hexdigest()
    else:
        digest = "0" * 64
    if events is None:
        events = [
            rec(1, "run_started"), rec(2, "system_health_manifest", {"manifestHash": digest}),
            rec(3, "system_health", {"systemId": "act.drive_to", "healthState": "ready",
                                    "proofLevel": "transport", "worldEpoch": 1}),
            rec(4, "system_health", {"systemId": "act.drive_to", "healthState": "verified",
                                    "proofLevel": "world_strong", "worldEpoch": 1,
                                    "activityId": ID, "evidenceEvent": "activity_terminal"}),
            rec(5, "activity_terminal", {"activityId": ID, "capability": "drive_to",
                                          "status": "completed", "proofLevel": "world_strong"}),
            rec(6, "system_health", {"systemId": "reaction.transport", "healthState": "ready",
                                    "proofLevel": "transport"}),
            rec(7, "system_health", {"systemId": "mk.memory.cloudCuration",
                                    "healthState": "blocked", "code": "consent_not_granted",
                                    "proofLevel": "resource_lifecycle"}),
            rec(8, "system_health", {"systemId": "conversation.playback",
                                    "healthState": "degraded", "code": "playback_timeout",
                                    "proofLevel": "native_terminal"}),
            rec(9, "run_shutdown"),
        ]
    files[EVENT_NAME] = ("\n".join(json.dumps(x) for x in events) + "\n").encode()
    if extra_files:
        files.update(extra_files)
    if altered_manifest and manifest:
        files[MANIFEST_NAME] += b"garbage"
    files["collection.json"] = (json.dumps({"Files": len(files) - 1, "Failures": errors or [],
                                              "MissingRoots": missing_roots or []}) + "\n").encode()
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["File", "Source", "SHA256"])
    writer.writeheader()
    for path, body in files.items():
        if path != "collection.json":
            writer.writerow({"File": path, "Source": "C:/PRIVATE/PRIVATE_PATH",
                             "SHA256": hashlib.sha256(body).hexdigest().upper()})
    files["inventory.csv"] = output.getvalue().encode()
    return files


def analyze(files):
    return obs3.build_report(files)


def table(report):
    return {row["id"]: row for row in report["sessions"][0]["health_matrix"]}


class OBS3Tests(unittest.TestCase):
    def test_every_system_including_zero_events_and_six_states(self):
        report = analyze(fixture())
        t = table(report)
        self.assertEqual(len(t), 7)
        self.assertEqual(t["act.drive_to"]["health"], "operational")
        self.assertEqual(t["act.drive_to"]["last_successful_operation"]["proof"], "world_strong")
        self.assertEqual(t["act.walk_to"]["health"], "disabled")
        self.assertEqual(t["reaction.transport"]["health"], "ready but not exercised")
        self.assertEqual(t["mk.memory.cloudCuration"]["health"], "blocked")
        self.assertEqual(t["conversation.playback"]["health"], "degraded")
        self.assertEqual(t["native.rph"]["health"], "unknown")
        self.assertEqual(t["unimplemented.feature"]["implemented"], False)
        self.assertEqual(sum(report["sessions"][0]["health_counts"].values()), 7)
        self.assertEqual(t["native.rph"]["installed"], "unknown")
        self.assertTrue(t["act.drive_to"]["evidence"])
        self.assertNotIn("PRIVATE_PATH", json.dumps(report))

    def test_later_failure_supersedes_success_and_recovery_needs_new_proof(self):
        base = fixture()
        old = [json.loads(x) for x in base[EVENT_NAME].decode().splitlines()]
        old = old[:5]
        suffix = [rec(6,"system_health",{"systemId":"act.drive_to","healthState":"degraded",
                                        "code":"connection_closed","proofLevel":"transport"}),
                  rec(7,"run_shutdown")]
        t = table(analyze(fixture(events=old + suffix)))
        self.assertEqual(t["act.drive_to"]["health"], "degraded")
        old.append(rec(6,"system_health",{"systemId":"act.drive_to","healthState":"degraded",
                                         "code":"connection_closed"}))
        old.append(rec(7,"system_health",{"systemId":"act.drive_to","healthState":"ready",
                                         "proofLevel":"transport"}))
        old.append(rec(8,"run_shutdown"))
        t = table(analyze(fixture(events=old)))
        self.assertEqual(t["act.drive_to"]["health"], "ready but not exercised")
        old[-1:] = [rec(8,"system_health",{"systemId":"act.drive_to","healthState":"verified",
                                         "proofLevel":"world_strong",
                                         "evidenceEvent":"activity_terminal"}),
                    rec(9,"run_shutdown")]
        self.assertEqual(table(analyze(fixture(events=old)))["act.drive_to"]["health"],"operational")

    def test_unverified_acceptance_and_model_output_are_not_completion(self):
        manifest = fixture()
        d = hashlib.sha256(manifest[MANIFEST_NAME]).hexdigest()
        events = [rec(1,"run_started"),rec(2,"system_health_manifest",{"manifestHash":d}),
                  rec(3,"system_health",{"systemId":"act.drive_to","healthState":"ready",
                                        "proofLevel":"transport"}),
                  rec(4,"activity_receipt",{"activityId":ID,"receiptState":"HANDLER_ACCEPTED"}),
                  rec(5,"run_shutdown")]
        t = table(analyze(fixture(events=events)))
        self.assertEqual(t["act.drive_to"]["health"],"ready but not exercised")
        key = "activityId:" + ID
        operation = {o["correlation"]:o for o in analyze(fixture(events=events))["sessions"][0]["operations"]}[key]
        self.assertEqual(operation["terminal"],"not observed")
        self.assertIn("insufficient evidence",operation["diagnosis"])

    def test_world_epoch_reset_invalidates_previous_proof(self):
        files = fixture()
        rows = [json.loads(x) for x in files[EVENT_NAME].decode().splitlines()]
        rows = rows[:5] + [rec(6,"system_health",{"systemId":"act.drive_to","healthState":"ready",
                             "worldEpoch":2,"proofLevel":"transport"}),rec(7,"run_shutdown")]
        self.assertEqual(table(analyze(fixture(events=rows)))["act.drive_to"]["health"],
                         "ready but not exercised")

    def test_loss_corruption_and_missing_manifest_do_not_claim_success(self):
        files=fixture()
        rows=[json.loads(x) for x in files[EVENT_NAME].decode().splitlines()]
        rows.insert(7,rec(20,"telemetry_records_dropped",{"dropped":7}))
        report=analyze(fixture(events=rows))
        self.assertEqual(table(report)["act.drive_to"]["health"],"unknown")
        self.assertIn("record_loss",report["sessions"][0]["evidence_gaps"])
        no_inventory=analyze(fixture(manifest=False,events=rows))
        self.assertEqual(len(no_inventory["sessions"][0]["health_matrix"]),0)
        self.assertIn("inventory_missing",no_inventory["sessions"][0]["evidence_gaps"])
        with_errors=analyze(fixture(errors=[{"File":"foo","ErrorCode":"sharing_violation"}]))
        self.assertEqual(table(with_errors)["act.drive_to"]["health"],"unknown")
        self.assertIn("collection_incomplete",with_errors["sessions"][0]["evidence_gaps"])

    def test_incomplete_manifest_and_sequence_gap(self):
        files=fixture(altered_manifest=True)
        report=analyze(files)
        self.assertIn("inventory_invalid",report["archive_issues"])
        self.assertIn("inventory_missing",report["sessions"][0]["evidence_gaps"])
        rows=[json.loads(x) for x in fixture()[EVENT_NAME].decode().splitlines()]
        rows=[r for r in rows if r["sequence"] != 5]
        report=analyze(fixture(events=rows))
        self.assertIn("sequence_gap",report["sessions"][0]["evidence_gaps"])
        self.assertEqual(table(report)["act.drive_to"]["health"],"unknown")

    def test_privacy_projections_do_not_copy_raw_dialogue_or_fs_path(self):
        files=fixture()
        events=[json.loads(x) for x in files[EVENT_NAME].decode().splitlines()]
        events[2]["data"]["secret"]="PRIVATE_MEMORY_PROMPT"
        events[2]["data"]["stage"]="unsafe dialogue prompt with PRIVATE information"
        identity={"pedId":"VPRIVATE","turnId":"YOUR_PRIVATE_DIALOGUE","generationId":1,"sessionNonce":4}
        events[4]["identity"]=identity
        rep=analyze(fixture(events=events))
        md=obs3.render_md(rep)
        self.assertNotIn("PRIVATE_MEMORY_PROMPT",json.dumps(rep)+md)
        self.assertNotIn("YOUR_PRIVATE_DIALOGUE",json.dumps(rep)+md)
        self.assertNotIn("PRIVATE_PATH",json.dumps(rep)+md)

    def test_zip_only_cli_generates_reports_and_rejects_unsafe_member(self):
        files=fixture()
        with tempfile.TemporaryDirectory() as tmp:
            zpath=Path(tmp)/"logs.zip"
            with zipfile.ZipFile(zpath,"w") as z:
                for key,value in files.items():
                    z.writestr(key,value)
                z.writestr("../outside.jsonl",b"PRIVATE")
            data,issues=obs3.read_zip(zpath)
            self.assertIn("unsafe_or_oversize_member_ignored",issues)
            self.assertNotIn("../outside.jsonl",data)
            output=Path(tmp)/"results"
            self.assertEqual(obs3.main([str(zpath),"--output",str(output)]),0)
            self.assertTrue((output/"report.json").exists())
            text=(output/"report.md").read_text()
            self.assertIn("Complete system-health matrix",text)
            self.assertIn("ready but not exercised",text)

    def test_multi_run_never_cross_correlates(self):
        files=fixture()
        second="33333333-3333-4333-8333-333333333333"
        other_file="source-2/logs/e1-run-20261018T200000Z-"+second+".jsonl"
        files[other_file]=(json.dumps(rec(1,"run_started",run=second))+"\n").encode()
        result=analyze(files)
        self.assertEqual(len(result["sessions"]),2)
        self.assertEqual(sum(len(s["health_matrix"]) for s in result["sessions"]),7)
        self.assertEqual(next(s for s in result["sessions"] if s["run_id"]==second)["inventory"],None)


if __name__=="__main__":
    unittest.main()
