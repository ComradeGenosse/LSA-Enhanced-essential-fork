#!/usr/bin/env python3
"""Collect reproducibility provenance for an interior-catalog extraction run (read-only, stdlib only).

Records hashes/sizes only - never archive contents. Archive files are listed by size and mtime (hashing ~tens of GB
of RPFs is deliberately skipped; the game executable and CodeWalker.Core are hashed, and every raw extractor output is hashed).
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True, help="GTA V Enhanced install directory")
    ap.add_argument("--codewalker", required=True, help="CodeWalker folder containing CodeWalker.Core.dll")
    ap.add_argument("--raw", required=True, help="extractor output directory")
    ap.add_argument("--extractor", required=True, help="extractor source directory (Extractor.cs, extractor.csproj)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    exe = os.path.join(a.game, "GTA5_Enhanced.exe")
    rpfs = []
    for root, _dirs, files in os.walk(a.game):
        for fn in files:
            if fn.lower().endswith(".rpf"):
                p = os.path.join(root, fn)
                st = os.stat(p)
                rel = os.path.relpath(p, a.game).replace("/", "\\")
                rpfs.append({"path": rel, "size": st.st_size, "mtimeUtc": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    rpfs.sort(key=lambda r: r["path"].lower())
    raw = []
    for fn in sorted(os.listdir(a.raw)):
        p = os.path.join(a.raw, fn)
        if os.path.isfile(p) and fn.endswith((".jsonl", ".tsv")):
            with open(p, "rb") as f:
                lines = sum(1 for _ in f)
            raw.append({"name": fn, "bytes": os.path.getsize(p), "lines": lines, "sha256": sha256(p)})
    errors = 0
    for fn in os.listdir(a.raw):
        if fn.startswith("run-") and fn.endswith(".log"):
            with open(os.path.join(a.raw, fn), encoding="utf-8", errors="replace") as f:
                errors += sum(1 for line in f if line.startswith("E "))
    try:
        dn = subprocess.run(["dotnet", "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception:
        dn = "unknown"
    ex_files = {}
    for fn in ("Extractor.cs", "extractor.csproj"):
        p = os.path.join(a.extractor, fn)
        if os.path.exists(p):
            ex_files[fn] = sha256(p)
    prov = {
        "tool": "gta-interior-catalog",
        "extractorVersion": re.search(r'ExtractorVersion = "(\d+)"', open(os.path.join(a.extractor, "Extractor.cs"), encoding="utf-8").read()).group(1),
        "collectedUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "gameExe": "GTA5_Enhanced.exe",
        "gameExeSha256": sha256(exe),
        "gameExeSize": os.path.getsize(exe),
        "codewalkerCoreSha256": sha256(os.path.join(a.codewalker, "CodeWalker.Core.dll")),
        "codewalkerBuild": os.path.basename(os.path.normpath(a.codewalker)),
        "dotnetVersion": dn,
        "extractorSourceSha256": ex_files,
        "archiveCount": len(rpfs),
        "archives": rpfs,
        "rawFiles": raw,
        "extractorLogErrorLines": errors,
        "note": "Archives are identified by relative path, size and mtime only. No archive contents are stored.",
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(prov, f, indent=1, sort_keys=True)
    print("provenance: %d archives, %d raw files, exe %s" % (len(rpfs), len(raw), prov["gameExeSha256"][:16]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
