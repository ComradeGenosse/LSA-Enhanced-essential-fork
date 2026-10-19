"""Small parallel validation runner (stdlib only, deterministic per spec)."""
import os
from concurrent.futures import ProcessPoolExecutor

from .catalog import load_catalog
from .validator import validate

_CAT = None


def _init():
    global _CAT
    _CAT = load_catalog()


def _one(args):
    exp, mode, nodes = args
    r = validate(exp, _CAT, mode=mode, search_nodes=nodes)
    s = r.get("search") or {}
    return {"id": exp["id"], "valid": r["valid"], "errors": r["errors"], "warnings": r["warnings"],
            "required_tier": r.get("required_tier"), "solvable": s.get("solvable"),
            "shapes": len(s.get("solution_shapes", [])), "shortest": s.get("shortest"),
            "failure_reachable": s.get("failure_reachable"), "nodes": s.get("nodes")}


def validate_many(exps, mode="lab", nodes=3000, workers=None):
    workers = workers or max(1, min(4, os.cpu_count() or 1))
    jobs = [(e, mode, nodes) for e in exps]
    if workers == 1:
        _init()
        return [_one(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=workers, initializer=_init) as ex:
        return list(ex.map(_one, jobs, chunksize=4))
