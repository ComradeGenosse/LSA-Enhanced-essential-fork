#!/usr/bin/env python3
"""Decorate X8 lab output with X9 read-only P2 inspection, never fracture."""
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
LAB = HERE.parent / "destruction-lab"
if len(sys.argv) != 2:
    raise SystemExit("usage: build_runtime.py OUTPUT_DIRECTORY")
out = Path(sys.argv[1])
# Build to the requested directory through the canonical X8 lab generator.
subprocess.run([sys.executable, str(LAB / "build_runtime.py"), str(out)], check=True)
dst = out / "WpsBreachLabX7.3.cs"
source = dst.read_text(encoding="utf-8")
command = '            case "labsurvey": LabSurvey(a); break;'
method = "    // ===================================================================== lab geometry"
if source.count(command) != 1 or source.count(method) != 1:
    raise RuntimeError("X9 source anchor drift; refuse silent driver mutation")
if "case \"x9survey\"" in source or "void X9Survey(" in source:
    raise RuntimeError("X9 already present; refuse duplicate injection")
source = source.replace(command, command + '\n            case "x9survey": X9Survey(a); break;', 1)
source = source.replace(method, (HERE / "X9Survey.inc.cs").read_text(encoding="utf-8") + "\n" + method, 1)
if 'case "x8shot":' not in source or 'case "x8restore":' not in source:
    raise RuntimeError("X8 commands absent; refuse incomplete build")
dst.write_bytes(source.encode("utf-8"))
print("X9 inspection-only driver generated:", dst)
