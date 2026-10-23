# GTA V Enhanced interior (MLO) catalog

Reusable, searchable metadata catalog of every MLO interior in the installed GTA V Enhanced archives (base, `update`, DLC packs and the NVE/`onigiri` layer),
so cloud/GitHub work on X9/X10 can pick destructible-building candidates without re-inspecting the PC.

**Metadata only.** Names, hashes, transforms, bounds, portal topology and archive provenance. No Rockstar/NVE asset bytes, no collision polygons,
no GTA launch. Not GTA-validated; nothing here proves a wall is breachable.

## Contents

| Path | Purpose |
| --- | --- |
| `extractor/Extractor.cs`, `extractor.csproj` | Headless CodeWalker.Core reader (`ytyp` and `ymap` stages, shardable). CodeWalker is not included. |
| `run_extraction.sh` | Reproducible raw extraction (Linux/WSL; ~1 minute total on the reference PC). |
| `collect_provenance.py` | Hashes the game exe, CodeWalker.Core, extractor source and every raw output; lists archives by size/mtime. |
| `interior_catalog.py` | `build` (raw -> SQLite + JSON), `validate`, `search`, `fingerprint`. Deterministic; stdlib only. |
| `tests/` | Synthetic-fixture unit tests plus a test of the committed catalog. CI: `.github/workflows/x9-interior-catalog.yml`. |
| `catalog/catalog.sqlite` | Full catalog (tables below). |
| `catalog/interiors-summary.json` | Compact per-interior summary for quick lookup/diff. |
| `catalog/candidates.json` | Up to five ranked X9 building candidates with reasons, verified facts and assumptions. |
| `catalog/coverage.json` | Counts, validation results, limitations and the full provenance record. |

## Regenerate

```
bash run_extraction.sh "<GTA V Enhanced dir>" "<CodeWalker30_dev48 dir>" <work dir>
python3 collect_provenance.py --game "<GTA dir>" --codewalker "<CW dir>" --raw <work>/raw --extractor extractor --out provenance.json
python3 interior_catalog.py build --raw <work>/raw --out catalog --provenance provenance.json   # also validates
python3 -m unittest discover -s tests
```

## Query

```
python3 interior_catalog.py search --db catalog/catalog.sqlite --text gasstation
python3 interior_catalog.py search --db catalog/catalog.sqlite --near 1569 2680 --radius 150
```

SQLite tables: `interiors`, `variants` (one per YTYP definition per archive layer), `rooms`, `portals` (`is_exit` = connects to room 0/limbo), `entity_sets`,
`mlo_entities` (local transforms, room, model-file presence by name), `placements` (one per distinct world position; merges identical placements across layers),
`placement_sources` (every YMAP that places it), `placement_rooms` / `placement_exit_portals` (world-space), `nearby_structures` (large non-prop models nearby),
`candidates`, `meta`, and an FTS5 `search` table when available.

## Verified vs assumed

Verified from the archives: MLO definitions, rooms, portal room links, interior entity lists, world placement (position/rotation/flags), model bounds (YTYP), file presence by name.
Transform convention (stored rotation applied as-is) is validated against YMAP entity extents (see `coverage.json`).

Assumed/heuristic (named `*_assumed`/`heuristic_*`, never presented as fact): layer load precedence, offline/story availability, "online-like" and "underground-like" naming,
association of a nearby large model with the interior's building, YBN files matched by name only.

An exit portal proves room topology only: it does not prove a physical doorway, collision, reachability or wall ownership.

## Ranking

`WEIGHTS` in `interior_catalog.py` are fixed and printed with each candidate's reasons; one candidate per interior archetype and per 150 m area.
The score is a triage aid for choosing what to investigate next (YBN polygon ownership, LOD, NVE overrides), not a feasibility claim.
