#!/usr/bin/env python3
"""VH3 capture audit: evaluate paired CSV + optional diagnostics sidecars.
Does not declare that the native matches rendered GTA geometry.
Usage:
  python tools/vehicle-deformation/audit_capture.py baseline.csv damaged.csv
"""
import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path

REQUIRED = ("index", "region", "sample_x", "sample_y", "sample_z",
            "dx", "dy", "dz", "valid", "capture_id", "model", "handle", "phase")


def read(path):
    with path.open(newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 48 or any(any(field not in row for field in REQUIRED) for row in rows):
        raise ValueError(f"{path}: expected VH3 48-row capture CSV")
    rows.sort(key=lambda row: int(row["index"]))
    if [int(row["index"]) for row in rows] != list(range(48)):
        raise ValueError(f"{path}: missing or duplicated probe indices")
    return rows


def valid(row):
    return row["valid"] == "1" and all(
        math.isfinite(float(row[k])) for k in ("dx", "dy", "dz")
    )


def sidecar(path):
    name=path.name
    if not name.endswith(".csv"):
        return None
    diagnostic=path.with_name(name[:-4]+".diagnostics.csv")
    if not diagnostic.is_file():
        return None
    with diagnostic.open(newline="", encoding="utf-8-sig") as stream:
        rows=list(csv.DictReader(stream))
    if len(rows)!=48:
        raise ValueError(f"{diagnostic}: incomplete forensic sidecar")
    rows.sort(key=lambda row: int(row["probe_index"]))
    if [int(row["probe_index"]) for row in rows] != list(range(48)):
        raise ValueError(f"{diagnostic}: forensic probe order invalid")
    return rows


def stats(rows):
    if rows is None:
        return {"available": False}
    speeds=[float(row["speed_mps"]) for row in rows if row.get("speed_mps")]
    micro=[int(row["native_us"]) for row in rows if row.get("native_us")]
    duration=[int(row["capture_elapsed_ms"]) for row in rows if row.get("capture_elapsed_ms")]
    return {
        "available": True,
        "rows": len(rows),
        "max_speed_mps": round(max(map(abs, speeds)), 4) if speeds else None,
        "capture_duration_ms": max(duration) if duration else None,
        "native_total_us": sum(micro),
        "native_max_us": max(micro) if micro else None,
        "native_mean_us": round(sum(micro)/len(micro),2) if micro else None,
        "native_errors": sum(row.get("valid")!="1" for row in rows),
        "motion_flag": bool(speeds and max(map(abs,speeds))>.5)
    }


def audit(baseline_path, damaged_path):
    baseline=read(baseline_path)
    damaged=read(damaged_path)
    for k in ("capture_id", "model", "handle"):
        if baseline[0][k]!=damaged[0][k]:
            raise ValueError(f"Unmatched capture: {k} differs")
    if baseline[0]["phase"]!="baseline" or damaged[0]["phase"]!="damaged":
        raise ValueError("Expected baseline followed by damaged capture")
    region=defaultdict(list)
    comparable=0
    zero_baseline=0
    zero_damaged=0
    changes=[]
    for a,b in zip(baseline,damaged):
        if a["region"]!=b["region"]:
            raise ValueError("Region mismatch")
        if any(abs(float(a[k])-float(b[k]))>0.001 for k in
               ("sample_x","sample_y","sample_z")):
            raise ValueError("Sample positions mismatch")
        if not(valid(a) and valid(b)):
            continue
        comparable+=1
        av=[float(a[k]) for k in ("dx","dy","dz")]
        bv=[float(b[k]) for k in ("dx","dy","dz")]
        if math.sqrt(sum(v*v for v in av))<1e-5:
            zero_baseline+=1
        if math.sqrt(sum(v*v for v in bv))<1e-5:
            zero_damaged+=1
        delta=math.sqrt(sum((x-y)**2 for x,y in zip(av,bv)))
        changes.append(delta)
        region[a["region"]].append(delta)
    before_stats=stats(sidecar(baseline_path))
    after_stats=stats(sidecar(damaged_path))
    flags=[]
    if comparable<40:
        flags.append("INSUFFICIENT_COMPARABLE_PROBES")
    if len(changes)>0 and max(changes)<.05:
        flags.append("NO_MEANINGFUL_VECTOR_CHANGE_AT_SAMPLED_POINTS")
    if zero_baseline==comparable and zero_damaged==comparable and comparable>0:
        flags.append("ALL_ZERO_BOTH_CAPTURES_NATIVE_OR_COVERAGE_UNVERIFIED")
    if before_stats.get("motion_flag") or after_stats.get("motion_flag"):
        flags.append("MOVING_DURING_CAPTURE")
    if not before_stats["available"] or not after_stats["available"]:
        flags.append("MISSING_PER_PROBE_TIMING_AND_MOTION_SIDECAR")
    return {
        "model":baseline[0]["model"],"capture_id":baseline[0]["capture_id"],
        "comparable_probes":comparable,
        "baseline_zero_vectors":zero_baseline,
        "damaged_zero_vectors":zero_damaged,
        "delta_ge_005":sum(v>=.05 for v in changes),
        "delta_ge_015":sum(v>=.15 for v in changes),
        "maximum_delta":round(max(changes),5) if changes else None,
        "regions":{k:{"count":len(v),"max_delta":round(max(v),5),
                      "changed_ge_005":sum(x>=.05 for x in v)}
                   for k,v in sorted(region.items())},
        "baseline_diagnostics":before_stats,
        "damaged_diagnostics":after_stats,
        "flags":flags,
        "conclusion":"REQUIRES_SCREENSHOT_CORRELATION_AND_RUNTIME_VALIDATION"
    }


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline",type=Path)
    parser.add_argument("damaged",type=Path)
    parser.add_argument("--out",type=Path)
    args=parser.parse_args()
    result=audit(args.baseline,args.damaged)
    data=json.dumps(result,indent=2)
    if args.out:
        args.out.write_text(data+"\n",encoding="utf-8")
        print("Saved audit:",args.out)
    else:
        print(data)


if __name__=="__main__":
    main()
