#!/usr/bin/env python3
"""Strict offline analyzer for the WPS E0 JSONL evidence contract."""
import argparse
import json
import pathlib
import sys

IDS = [f"E0.{n}" for n in range(13)]
STATES = {"OFFLINE_READY","GTA_VERIFIED","FAILED","BLOCKED","NOT_TESTED"}

def analyze(path):
    rows = []
    problems = []
    previous = {}
    with open(path, encoding="utf-8-sig") as stream:
        for lineno, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            if not raw.startswith("[WPS-LAB] "):
                problems.append(f"line {lineno}: missing prefix")
                continue
            try:
                record = json.loads(raw[len("[WPS-LAB] "):])
            except json.JSONDecodeError as ex:
                problems.append(f"line {lineno}: invalid JSON: {ex}")
                continue
            required = {"v","exp","run","build","rph","plugin","t_game_ms",
                        "t_real_ms","frame","kind","details"}
            if required - record.keys():
                problems.append(f"line {lineno}: missing {sorted(required - record.keys())}")
                continue
            if record["v"] != 1 or record["exp"] not in IDS or not record["run"]:
                problems.append(f"line {lineno}: schema identity invalid")
            key = record["run"]
            marker = (record["t_real_ms"],record["frame"])
            if key in previous and marker < previous[key]:
                problems.append(f"line {lineno}: nonmonotonic real time/frame")
            previous[key] = marker
            rows.append(record)
    runs = {}
    for row in rows:
        record = runs.setdefault(row["run"], {"exp":row["exp"],"events":0,"verdict":None,
                                               "start":False,"cleanup":False})
        if record["exp"] != row["exp"]:
            problems.append(f"run {row['run']}: multiple experiment IDs")
        record["events"] += 1
        if row["kind"] == "start": record["start"] = True
        if row["kind"] == "cleanup": record["cleanup"] = bool((row["details"] or {}).get("success"))
        if row["kind"] == "verdict":
            verdict=(row["details"] or {}).get("status")
            if verdict not in STATES: problems.append(f"invalid verdict {verdict}")
            if record["verdict"]:problems.append(f"run {row['run']}: duplicate verdict")
            record["verdict"] = verdict
    for key, run in runs.items():
        if not run["start"]: problems.append(f"run {key}: missing start")
        if not run["cleanup"]: problems.append(f"run {key}: cleanup not confirmed")
        if run["verdict"] is None: problems.append(f"run {key}: no verdict")
    return {"file":str(path),"valid":not problems,"issues":problems,
            "runs":runs,"offlineReadyDoesNotProveGta":True}

def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        p=pathlib.Path(tmp)/"test.jsonl"
        def row(kind,frame,details):
            return "[WPS-LAB] "+json.dumps(dict(v=1,exp="E0.0",run="abc",build="1158.16",
                rph="1.132",plugin="0.1",t_game_ms=frame,t_real_ms=frame,frame=frame,
                kind=kind,details=details))+"\n"
        p.write_text(row("start",0,{})+row("cleanup",1,{"success":True})+
                     row("verdict",2,{"status":"GTA_VERIFIED"}))
        assert analyze(p)["valid"]
        p.write_text(row("start",0,{})+row("verdict",2,{"status":"PASS"}))
        assert not analyze(p)["valid"]
        p.write_text("not json\n")
        assert not analyze(p)["valid"]
    print("PASS: E0 strict analyzer self-test (positive, invalid status, missing cleanup, malformed)")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("logfile",nargs="?")
    parser.add_argument("--self-test",action="store_true")
    a=parser.parse_args()
    if a.self_test:self_test()
    if a.logfile:
        result=analyze(a.logfile)
        print(json.dumps(result,indent=2))
        if not result["valid"]:sys.exit(1)
    elif not a.self_test:parser.error("supply a JSONL path or --self-test")
if __name__=="__main__":main()
