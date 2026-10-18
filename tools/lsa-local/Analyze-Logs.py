#!/usr/bin/env python3
"""OBS3: offline, bounded, evidence-linked LSA ZIP analysis. Python stdlib only."""
import argparse
import collections
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

LABELS = ("operational", "ready but not exercised", "disabled", "blocked", "degraded", "unknown")
VERIFIED = {"world_strong", "durable_write", "native_terminal", "history_commit", "provider_result", "frame_projected"}
READY = {"ready", "connected"}
FAULT = {"blocked", "degraded", "disconnected"}
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
MANIFEST = re.compile(r"(?:^|/)obs2-inventory-(" + UUID + r")\.jsonl$")
EVENT_FILE = re.compile(r"(?:^|/)e1-run-\d{8}T\d{6}Z-(" + UUID + r")(?:-\d+)?\.jsonl$")
TOKEN = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")
SYSTEM_ID = re.compile(r"^[a-z][A-Za-z0-9_.-]{1,79}$")
FIELDS = ("systemId","healthState","proofLevel","evidenceEvent","code","reason","terminalReason",
          "stage","status","outcome","receiptState","capability","intent","activityId",
          "executionId","goalId","requestId","traceCode","hostRunId","nativeRun","adapterEpoch",
          "worldEpoch","manifestHash","dropped")
TERMINALS = {"activity_terminal","turn_terminal_summary","native_playback_ended",
             "voice_fallback_playback_completed","voice_fallback_playback_failed"}
SIGNALS = {"activity_admitted","activity_rejected","activity_step_started","activity_receipt",
           "activity_terminal","activity_channel_failure","act6_player_direct_rejected",
           "act6_player_direct_unavailable","model_decision_validation_failure",
           "decision_rejected","provider_request_failed","native_playback_started",
           "native_playback_ended","playback_watchdog_fired","turn_terminal_summary",
           "target_changed","director_gate","director_candidate","director_handoff",
           "memory_journal_committed","memory_journal_not_committed","memory_m3_intake_loss",
           "system_health","system_health_gap","reaction_channel_mode_mismatch",
           "telemetry_records_dropped","telemetry_sink_failed"}
SERIOUS = {"telemetry_missing","malformed_telemetry","sequence_gap","sequence_duplicate",
           "sequence_prefix_missing","record_loss","collection_incomplete","inventory_integrity_failed"}


def evidence(name, lineno=1, record=None):
    result = {"file": name, "line": lineno}
    if isinstance(record, dict):
        if type(record.get("sequence")) is int:
            result["sequence"] = record["sequence"]
        if isinstance(record.get("timestamp"), str):
            result["timestamp"] = record["timestamp"][:40]
    return result


def projected_data(data):
    if not isinstance(data, dict):
        return {}
    out = {}
    for key in FIELDS:
        val = data.get(key)
        if key in ("worldEpoch", "dropped") and type(val) is int and 0 <= val < 1000000000:
            out[key] = val
        elif isinstance(val, str) and TOKEN.fullmatch(val):
            out[key] = val
    return out


def read_zip(archive):
    files, issues, total = {}, [], 0
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            if len(files) >= 20000 or total + info.file_size > 512 * 1024 * 1024:
                issues.append("archive_limits_exceeded")
                break
            name = info.filename
            if (name.startswith("/") or "\\" in name or ".." in PurePosixPath(name).parts
                    or info.file_size > 32 * 1024 * 1024 or name in files):
                issues.append("unsafe_or_oversize_member_ignored")
                continue
            try:
                body = zf.read(info)
            except (OSError, RuntimeError, zipfile.BadZipFile):
                issues.append("unreadable_archive_member")
                continue
            total += len(body)
            files[name] = body
    return files, issues


def collector_metadata(files, gaps):
    collection = next((v for p, v in files.items() if PurePosixPath(p).name == "collection.json"), None)
    result = {"files": None, "copy_failures": None, "missing_roots": None}
    if collection is None:
        gaps.append("collection_metadata_missing")
    else:
        try:
            c = json.loads(collection.decode("utf-8-sig"))
            result["files"] = c.get("Files") if type(c.get("Files")) is int else None
            result["copy_failures"] = len(c.get("Failures", []))
            result["missing_roots"] = len(c.get("MissingRoots", []))
            if result["copy_failures"] or result["missing_roots"]:
                gaps.append("collection_incomplete")
        except (ValueError, TypeError, UnicodeError, AttributeError):
            gaps.append("collection_metadata_invalid")
    inventory = next((v for p, v in files.items() if PurePosixPath(p).name == "inventory.csv"), None)
    if inventory is None:
        gaps.append("collection_hash_inventory_missing")
    else:
        try:
            for row in csv.DictReader(io.StringIO(inventory.decode("utf-8-sig"))):
                name, digest = row.get("File"), row.get("SHA256")
                # Ignore the Source field: it may contain the user's private absolute paths.
                if not name or name not in files:
                    gaps.append("collection_incomplete")
                elif not digest or hashlib.sha256(files[name]).hexdigest().upper() != digest.upper():
                    gaps.append("collection_incomplete")
        except (UnicodeError, csv.Error):
            gaps.append("collection_hash_inventory_invalid")
    return result


def build_evidence(files, issues):
    """Only curated SHA256 evidence emitted by the collector is safe to report."""
    candidates = [(p, x) for p, x in files.items() if PurePosixPath(p).name == "build-evidence.json"]
    result = {"file": None, "build_manifests": [], "installed_files": []}
    if len(candidates) != 1:
        issues.append("build_evidence_missing_or_ambiguous")
        return result
    name, body = candidates[0]
    result["file"] = name
    try:
        obj = json.loads(body.decode("utf-8-sig"))
        if obj.get("SchemaVersion") != 1:
            raise ValueError()
        for row in obj.get("BuildManifests", [])[:50]:
            if not isinstance(row, dict) or row.get("Origin") not in ("game", "package"):
                continue
            hashes = {key: value.lower() for key in ("ManifestSHA256", "builtBundleSha256",
                       "e1SourceTreeSha256", "releasePayloadSha256", "upstreamBundleSha256",
                       "stockDllReferenceSha256") if isinstance(value := row.get(key), str)
                       and re.fullmatch(r"[a-fA-F0-9]{64}", value)}
            result["build_manifests"].append({"origin": row["Origin"], "hashes": hashes,
                "evidence": evidence(name)})
        allowed = {"RagePluginHook.exe":"native.rph",
                   "Plugins/LosSantosAlive.dll":"native.p2",
                   "Plugins/LSA.Standalone.RageHost.dll":"native.rph",
                   "Plugins/LSA.Enhanced.dll":"native.enhanced",
                   "Plugins/LSA.PromotedCharacters.dll":"native.p2"}
        for row in obj.get("DeployedDllCandidates", [])[:50]:
            if not isinstance(row, dict):
                continue
            path, digest = row.get("RelativePath"), row.get("SHA256")
            if (path in allowed and isinstance(digest, str) and
                    re.fullmatch(r"[a-fA-F0-9]{64}", digest) and
                    row.get("Evidence") == "file_present_not_loaded"):
                result["installed_files"].append({"id": allowed[path], "file": path,
                    "sha256": digest.lower(), "load_state": "unverified",
                    "evidence": evidence(name)})
    except (ValueError, UnicodeError, TypeError, AttributeError):
        issues.append("build_evidence_invalid")
    return result


def native_diagnostics(files):
    """Bounded safe P2 reason codes. Never echo raw native log lines."""
    found = []
    pattern = re.compile(r"\[P2 OBS1\] control_channel_failure code=([A-Za-z_]{1,64})" +
        r".*?host_run=(" + UUID + r"|unavailable) world_epoch=(\d{1,9})")
    for name, data in files.items():
        if not name.lower().endswith((".log", ".txt")):
            continue
        if "rph" not in name.lower() and "rage" not in name.lower():
            continue
        if len(found) >= 300:
            break
        for lineno, line in enumerate(data.splitlines()[:100000], 1):
            match = pattern.search(line.decode("utf-8", errors="replace"))
            if match:
                found.append({"reason": match.group(1), "host_run": match.group(2),
                    "world_epoch": int(match.group(3)), "evidence": evidence(name, lineno)})
            if len(found) >= 300:
                break
    return found


def parse_inputs(files, issues):
    manifests, events, malformed = collections.defaultdict(list), collections.defaultdict(list), collections.Counter()
    for filename, contents in files.items():
        m = MANIFEST.search(filename)
        e = EVENT_FILE.search(filename)
        if not (m or e):
            continue
        run_id = (m or e).group(1)
        if m:
            try:
                doc = json.loads(contents.decode("utf-8-sig").strip())
                rows = doc["systems"]
                if (doc.get("kind") != "obs2_system_inventory" or doc.get("schemaVersion") != 1 or
                    doc.get("runId") != run_id or not isinstance(rows, list) or len(rows) > 1000):
                    raise ValueError()
                ids = [x["id"] for x in rows]
                if len(ids) != len(set(ids)) or any(not SYSTEM_ID.fullmatch(x) for x in ids):
                    raise ValueError()
                manifests[run_id].append({"source": filename, "doc": doc,
                    "sha256": hashlib.sha256(contents).hexdigest()})
            except (ValueError, KeyError, TypeError, UnicodeError):
                issues.append("inventory_invalid")
            continue
        lines = contents.split(b"\n")
        if len(lines) > 400000:
            issues.append("telemetry_line_limit")
            continue
        for lineno, line in enumerate(lines, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line.decode("utf-8-sig"))
                if (row.get("runId") != run_id or type(row.get("sequence")) is not int
                    or not isinstance(row.get("event"), str) or
                    not re.fullmatch(r"[a-z][a-z0-9_]{2,79}", row["event"])):
                    raise ValueError()
                identity = row.get("identity")
                identity = identity if isinstance(identity, dict) else None
                timestamp = row.get("timestamp")
                if not isinstance(timestamp, str) or not re.fullmatch(
                        r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z", timestamp):
                    timestamp = None
                events[run_id].append({"event": row["event"], "timestamp": timestamp,
                    "sequence": row["sequence"], "data": projected_data(row.get("data")),
                    "identity": identity, "evidence": evidence(filename, lineno, row)})
            except (ValueError, TypeError, UnicodeError, AttributeError):
                malformed[run_id] += 1
        if not contents.endswith(b"\n"):
            issues.append("possible_truncated_telemetry")
    return manifests, events, malformed


def session_gaps(rows, manifest, malformed, archive_gaps):
    gap = []
    if manifest is None:
        gap.append("inventory_missing")
    if not rows:
        gap.append("telemetry_missing")
    if malformed:
        gap.append("malformed_telemetry")
    seq = [x["sequence"] for x in rows]
    if seq and min(seq) != 1:
        gap.append("sequence_prefix_missing")
    if len(seq) != len(set(seq)):
        gap.append("sequence_duplicate")
    if seq and max(seq) - min(seq) + 1 != len(set(seq)):
        gap.append("sequence_gap")
    if rows and not any(x["event"] == "run_shutdown" for x in rows):
        gap.append("shutdown_not_observed")
    if any(x["event"] in ("telemetry_records_dropped","system_health_gap","telemetry_sink_failed")
           or x["data"].get("dropped", 0) for x in rows):
        gap.append("record_loss")
    if any(x in archive_gaps for x in ("collection_incomplete","archive_limits_exceeded",
        "unreadable_archive_member","possible_truncated_telemetry","unsafe_or_oversize_member_ignored")):
        gap.append("collection_incomplete")
    if manifest:
        if not any(x["event"] == "system_health_manifest" and
                   x["data"].get("manifestHash") == manifest["sha256"] for x in rows):
            gap.append("inventory_integrity_failed")
    return list(dict.fromkeys(gap))


def health_row(raw, transitions, gaps, install=None, world_cutoff=None):
    mode = raw.get("configuredMode", "unknown")
    if mode not in ("off", "on", "shadow", "experimental", "active",
                    "openai", "elevenlabs", "gemini", "auto", "unspecified", "unknown"):
        mode = "unknown"
    implemented = raw.get("implemented")
    if type(implemented) is not bool:
        implemented = "unknown"
    installed, initialization, last_success = "unknown", "unknown", None
    state, recovered, failures, proofs = None, [], [], []
    previously_failed = False
    current_epoch = None
    current_verified = False
    scoped_reset = False
    reset_applied = False
    # A verified earlier-world outcome cannot establish the latest world's health.
    world_sensitive = raw["id"].startswith(("act.", "activity.", "reaction.",
        "perception.", "scene.", "native.", "mk.", "character.")) or raw["id"] == "conversation.ux4"
    for item in transitions:
        if world_sensitive and world_cutoff is not None and not reset_applied and item["sequence"] >= world_cutoff:
            state, initialization, installed = None, "unknown", "unknown"
            current_verified = False
            previously_failed = False
            reset_applied = True
            scoped_reset = True
        d = item["data"]
        status = d.get("healthState")
        if not status:
            continue
        epoch = d.get("worldEpoch")
        if type(epoch) is int:
            if current_epoch is not None and current_epoch != epoch:
                current_verified = False
                initialization = "unknown"
                installed = "unknown"
                state = None
            current_epoch = epoch
        proofs.append(item["evidence"])
        proofs = proofs[-12:]
        if status == "initializing":
            initialization = "in progress"
        if status in ("initialized","ready","connected","verified"):
            initialization = "succeeded"
            installed = "observed runtime"
        if status in READY:
            if previously_failed:
                recovered.append(item["evidence"])
                current_verified = False
            previously_failed = False
            # A routine readiness confirmation does not cancel a real verified
            # operation. Only failure/reset invalidates that success.
            state = "verified" if current_verified else "ready"
        elif status == "initialized":
            state = "initialized"
        elif status == "verified":
            if d.get("proofLevel") in VERIFIED:
                current_verified = True
                previously_failed = False
                state = "verified"
                last_success = {"at": item["timestamp"], "proof": d["proofLevel"],
                    "operation": d.get("evidenceEvent"), "id": d.get("activityId"),
                    "evidence": item["evidence"]}
            else:
                current_verified = False
                state = None
        elif status in FAULT:
            if status == "blocked" and initialization == "in progress":
                initialization = "failed"
            current_verified = False
            previously_failed = True
            state = status
            failures.append({"state": status, "reason": d.get("code"), "evidence": item["evidence"]})
            failures = failures[-8:]
        elif status == "unknown":
            state = None
            current_verified = False
        # A graceful stopped resource is not a failure and does not erase the
        # completed-session evidence. No live/current-state inference is made.
    if world_sensitive and world_cutoff is not None and not reset_applied:
        # No health event in the new world/host scope, despite recorded reset.
        state, installed, initialization, current_verified = None, "unknown", "unknown", False
        scoped_reset = True
    if mode == "off":
        label = "disabled"
        reason = "effective_configuration_off"
    elif state == "blocked":
        label, reason = "blocked", "observed_prerequisite_or_admission_block"
    elif state in ("degraded","disconnected"):
        label, reason = "degraded", "observed_runtime_failure_or_disconnect"
    elif state == "verified" and current_verified:
        label, reason = "operational", "observed_success_with_proof_boundary"
    elif state == "ready":
        label, reason = "ready but not exercised", "readiness_only"
    else:
        label, reason = "unknown", "insufficient evidence"
    if scoped_reset and label == "unknown":
        reason = "world_or_host_reset_without_new_operation_proof"
    if label in ("operational", "ready but not exercised") and SERIOUS.intersection(gaps):
        label, reason = "unknown", "incomplete_evidence_cannot_establish_current_health"
    if mode == "shadow" and label == "operational":
        reason = "shadow_operation_only_not_production_activation"
    if installed == "unknown" and install:
        installed = "file_present_load_unverified"
    return {
        "id": raw["id"], "family": raw.get("family") if SYSTEM_ID.fullmatch(str(raw.get("family", ""))) else "unknown",
        "implemented": implemented, "installed": installed,
        "deployment_evidence": install or [], "configured_mode": mode, "initialization": initialization,
        "health": label, "reason": reason, "dependencies": [x for x in raw.get("dependencies", [])
             if isinstance(x, str) and SYSTEM_ID.fullmatch(x)][:40],
        "last_successful_operation": last_success, "recent_failures": failures,
        "recoveries": recovered[-8:], "evidence": proofs,
    }


def operation_key(item):
    d = item["data"]
    for field in ("activityId", "requestId", "traceCode"):
        if field in d:
            return field + ":" + d[field]
    identity = item.get("identity")
    if (isinstance(identity, dict) and isinstance(identity.get("turnId"), str)
        and type(identity.get("generationId")) is int and type(identity.get("sessionNonce")) is int):
        # Don't expose NPC/turn ids. Use one stable digest for identity joins.
        encoded = json.dumps([identity.get("pedId"),identity["turnId"],
            identity["generationId"],identity["sessionNonce"]])
        return "turn:" + hashlib.sha256(encoded.encode()).hexdigest()[:16]
    return None


def gameplay_operations(events):
    groups = {}
    for x in events:
        if x["event"] not in SIGNALS and x["event"] not in TERMINALS:
            continue
        key = operation_key(x)
        if not key or key not in groups and len(groups) >= 2000:
            continue
        entry = groups.setdefault(key, {"correlation": key, "stages": [],
            "terminal": "not observed", "diagnosis": "insufficient evidence: no terminal receipt"})
        if len(entry["stages"]) < 80:
            entry["stages"].append({"event": x["event"], "at": x["timestamp"],
                "data": x["data"], "evidence": x["evidence"]})
        if x["event"] in TERMINALS:
            status = (x["data"].get("status") or x["data"].get("terminalReason")
                      or x["data"].get("outcome") or "terminal recorded")
            entry["terminal"] = status
            entry["diagnosis"] = "terminal recorded; evidence/proof boundary in cited events"
    return list(groups.values())


def failure_summary(events):
    counts, last = collections.Counter(), []
    for x in events:
        e, d = x["event"], x["data"]
        failed = (e.endswith(("_failed", "_rejected", "_unavailable")) or
                  e in ("activity_channel_failure","playback_watchdog_fired",
                        "memory_journal_not_committed","system_health_gap",
                        "telemetry_sink_failed","telemetry_records_dropped") or
                  e == "system_health" and d.get("healthState") in FAULT)
        if failed:
            reason = d.get("code") or d.get("reason") or e
            counts[reason] += 1
            last.append({"event": e, "reason": reason, "evidence": x["evidence"]})
    return {"codes": dict(counts.most_common(80)), "recent": last[-150:]}


def build_report(files, source_issues=()):
    issues = list(source_issues)
    collection = collector_metadata(files, issues)
    build = build_evidence(files, issues)
    native = native_diagnostics(files)
    installs = collections.defaultdict(list)
    for installed in build["installed_files"]:
        installs[installed["id"]].append(installed)
    manifests, event_groups, malformed = parse_inputs(files, issues)
    report = {"schema_version": 1, "tool": "lsa_obs3_zip_analyzer",
        "scope": "ZIP-only evidence, no live queries", "collection": collection,
        "build_evidence": build, "unassigned_native_diagnostics": [],
        "archive_issues": [], "sessions": []}
    for run_id in sorted(set(manifests) | set(event_groups)):
        options = manifests.get(run_id, [])
        manifest = options[0] if len(options) == 1 else None
        events = sorted(event_groups.get(run_id, []),
                        key=lambda x: (x["sequence"], x["evidence"]["file"], x["evidence"]["line"]))
        gaps = session_gaps(events, manifest, malformed.get(run_id, 0), issues)
        if len(options) > 1:
            gaps.append("inventory_ambiguous")
        by_id = collections.defaultdict(list)
        for x in events:
            if x["event"] == "system_health" and SYSTEM_ID.fullmatch(x["data"].get("systemId", "")):
                by_id[x["data"]["systemId"]].append(x)
        host_scopes_ordered = [(e["sequence"], e["data"].get("hostRunId"), e["data"].get("worldEpoch"))
            for e in events if e["event"] == "system_health" and
            isinstance(e["data"].get("hostRunId"), str) and
            type(e["data"].get("worldEpoch")) is int]
        world_cutoff = None
        previous = None
        for seq, host, epoch in host_scopes_ordered:
            scope = (host, epoch)
            if previous is not None and previous != scope:
                world_cutoff = seq
            previous = scope
        matrix = ([health_row(row, by_id[row["id"]], gaps, installs.get(row["id"]),
                             world_cutoff=world_cutoff)
                   for row in manifest["doc"]["systems"]] if manifest else [])
        counts = collections.Counter(row["health"] for row in matrix)
        host_scopes = {(d.get("hostRunId"), d.get("worldEpoch"))
                       for e in events for d in [e["data"]]
                       if isinstance(d.get("hostRunId"), str) and type(d.get("worldEpoch")) is int}
        native_for_run = [n for n in native if (n["host_run"], n["world_epoch"]) in host_scopes]
        if native_for_run:
            # Native failures do not certify a running system state; they are
            # independently correlated by exact verified host/world identity.
            for row in matrix:
                if row["id"] == "native.p2":
                    for n in native_for_run[-8:]:
                        row["recent_failures"].append({"state": "observed_native_failure",
                            "reason": n["reason"], "evidence": n["evidence"]})
                        row["evidence"].append(n["evidence"])
        report["sessions"].append({
            "run_id": run_id,
            "native_diagnostics": native_for_run,
            "inventory": ({"file": manifest["source"], "sha256": manifest["sha256"],
                           "schema": manifest["doc"]["schemaVersion"], "systems": len(matrix)}
                          if manifest else None),
            "first_event": events[0]["timestamp"] if events else None,
            "last_event": events[-1]["timestamp"] if events else None,
            "events": len(events), "evidence_gaps": list(dict.fromkeys(gaps)),
            "health_counts": {label: counts[label] for label in LABELS},
            "health_matrix": matrix, "operations": gameplay_operations(events),
            "failures": failure_summary(events),
        })
    scoped = {(n["host_run"], n["world_epoch"])
              for session in report["sessions"] for n in session.get("native_diagnostics", [])}
    report["unassigned_native_diagnostics"] = [n for n in native
        if (n["host_run"], n["world_epoch"]) not in scoped]
    if not report["sessions"]:
        issues.append("no_structured_sessions")
    report["archive_issues"] = sorted(set(issues))
    return report


def md_escape(value):
    return str(value if value is not None else "none").replace("|", "/").replace("\n", " ")[:140]


def render_md(report):
    out = ["# OBS3: LSA session diagnostics and complete system health", "",
           "Evidence only. Readiness is not successful gameplay; missing evidence is not failure or success.", ""]
    if report["archive_issues"]:
        out += ["Archive limitations: " + ", ".join(report["archive_issues"]), ""]
    build = report.get("build_evidence", {})
    if build.get("installed_files"):
        out += ["Hashed installed-file evidence (presence only, never loaded/executed): " +
                ", ".join(x["file"] for x in build["installed_files"]), ""]
    if report.get("unassigned_native_diagnostics"):
        out += ["Unassigned native P2 failures (no exact host/world match): " +
                str(len(report["unassigned_native_diagnostics"])), ""]
    for session in report["sessions"]:
        out += ["## Session " + session["run_id"], "",
                "Period: " + str(session["first_event"]) + " to " + str(session["last_event"]), "",
                "Inventory: " + (session["inventory"]["file"] if session["inventory"] else "MISSING"), "",
                "Coverage gaps: " + (", ".join(session["evidence_gaps"]) or "none detected"), "",
                "Health totals: " + "; ".join(k + " = " + str(v) for k, v in session["health_counts"].items()), "",
                "### Complete system-health matrix", "",
                "| System | Implemented / installed | Mode | Init | Status | Last operation / proof | Recent issue / evidence |",
                "|---|---|---|---|---|---|---|"]
        for row in session["health_matrix"]:
            last = row["last_successful_operation"]
            success = (str(last["at"]) + " / " + last["proof"]) if last else "none observed"
            failed = (row["recent_failures"][-1]["reason"] if row["recent_failures"] else row["reason"])
            refs = ", ".join(x["file"] + ":" + str(x["line"]) for x in row["evidence"][-2:])
            vals = [row["id"], str(row["implemented"]) + " / " + row["installed"],
                    row["configured_mode"], row["initialization"], row["health"], success,
                    str(failed) + (" [" + refs + "]" if refs else " [no runtime event]")]
            out.append("| " + " | ".join(md_escape(x) for x in vals) + " |")
        out += ["", "### Correlated gameplay operations", "",
                "| Correlation | Terminal evidence | Diagnosis |",
                "|---|---|---|"]
        for op in session["operations"][:160]:
            out.append("| " + " | ".join(md_escape(x) for x in
                       [op["correlation"], op["terminal"], op["diagnosis"]]) + " |")
        if len(session["operations"]) > 160:
            out.append(str(len(session["operations"]) - 160) + " more operations in JSON report.")
        out += ["", "### Recent failure evidence", ""]
        for native in session.get("native_diagnostics", [])[-12:]:
            src = native["evidence"]
            out.append("- P2 native: " + native["reason"] + " : " + src["file"] + ":" +
                       str(src["line"]))
        if not session["failures"]["recent"]:
            out.append("No explicit failures observed. This is not proof of error-free operation.")
        for f in session["failures"]["recent"][-35:]:
            src = f["evidence"]
            out.append("- " + f["event"] + " / " + f["reason"] + " : " + src["file"] +
                       ":" + str(src["line"]))
        out += ["", "Limit: a built-in inventory row alone does not prove native installation, "
                "connection or action completion. See JSON for exact events, evidence and missing-data flags.", ""]
    if not report["sessions"]:
        out += ["No OBS2/E1 session evidence found. Overall system status is unknown.", ""]
    return "\n".join(out) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="One-ZIP offline LSA health and gameplay diagnostic report")
    parser.add_argument("zip", type=Path)
    parser.add_argument("--output", type=Path, help="Output directory (default: ZIP sibling / ZIP stem + -analysis)")
    args = parser.parse_args(argv)
    try:
        files, issues = read_zip(args.zip)
        report = build_report(files, issues)
        output = args.output or args.zip.with_name(args.zip.stem + "-analysis")
        output.mkdir(parents=True, exist_ok=True)
        (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        (output / "report.md").write_text(render_md(report), encoding="utf-8")
        print("OBS3 reports:", output / "report.md", output / "report.json")
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        print("OBS3 analyzer failed:", type(error).__name__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
