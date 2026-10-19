#!/usr/bin/env python3
"""GT0 offline research CLI. Inputs/most outputs are PRIVATE_LOCAL_ONLY."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

from adapter import adapt_codewalker_candidates
from gt0 import (
    GT0Error, discover_spawnable_candidates, load_json, plan_filter_tests,
    public_export, scene_trace, validate_catalog, validate_scene, write_json
)

DEFAULT_SCHEMA = Path(__file__).resolve().parent.parent / "research" / "verified-material-catalog.schema.json"


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    for command in ("validate", "adapt-codewalker", "trace", "plan-filters",
                    "discover-spawnables", "export-aggregate"):
        c = sub.add_parser(command)
        c.add_argument("input", type=Path)
        if command == "validate":
            c.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
        else:
            c.add_argument("--output", type=Path, required=True)
        if command == "trace":
            c.add_argument("--rays", type=Path, required=True)
    opts = p.parse_args(argv)
    data = load_json(opts.input)
    if opts.command == "validate":
        errors = validate_catalog(data, load_json(opts.schema))
        result = {"valid": not bool(errors), "errors": errors}
        print(json.dumps(result, indent=2))
        return 0 if not errors else 2
    if opts.command == "adapt-codewalker":
        result = adapt_codewalker_candidates(data)
    elif opts.command == "trace":
        result = scene_trace(data, load_json(opts.rays))
    elif opts.command == "plan-filters":
        result = plan_filter_tests(data)
    elif opts.command == "discover-spawnables":
        result = discover_spawnable_candidates(data)
    elif opts.command == "export-aggregate":
        # Schematized, validated catalog only; no arbitrary malformed records.
        errors = validate_catalog(data, load_json(DEFAULT_SCHEMA))
        if errors:
            raise GT0Error("catalog invalid; public export denied: " + "; ".join(errors[:4]))
        result = public_export(data)
    else:
        raise AssertionError("unreachable")
    if opts.command != "export-aggregate" and not str(opts.output).endswith(".private.json"):
        raise GT0Error("private output must have .private.json suffix")
    write_json(opts.output, result)
    print(f"GT0 {opts.command}: written {'sanitized aggregate' if opts.command == 'export-aggregate' else 'PRIVATE_LOCAL_ONLY'} output")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (GT0Error, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"GT0 BLOCKED: {exc}", file=sys.stderr)
        sys.exit(2)
