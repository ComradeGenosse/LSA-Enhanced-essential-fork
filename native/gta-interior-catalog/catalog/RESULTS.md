# X9 interior catalog - results (2026-10-23)

Metadata-only extraction with headless CodeWalker.Core 30_dev48 over the installed GTA V Enhanced archives (read-only). Not GTA-validated. No game launch, no modification, no asset bytes committed.
Full provenance (exe sha256, CodeWalker.Core sha256, 199 archive paths/sizes/mtimes, sha256 of every raw output) is in `coverage.json` and `provenance.json`.

## Counts

| Item | Count |
| --- | --- |
| Unique MLO archetypes | 392 (391 fully name-resolved) |
| YTYP MLO definitions (variants) | 570 (42 interiors differ between layers) |
| Definitions per layer | base 228, update-dlc_patch 5, update-dlcpack 321, onigiri-nve 16 |
| Rooms / portals / exit portals (to room 0) | 2,216 / 3,561 / 2,195 |
| Entity sets / interior entities | 2,276 / 70,214 (70,054 with a model file found by name) |
| YMAP MLO instance records / unique world placements | 1,752 / 806 (745 with an exit portal; 1 layer conflict) |
| Interiors with no placement found | 10 |
| YMAPs scanned / nearby large-structure rows | 21,331 / 6,191 |

## Validation

Referential integrity, portal/entity room ranges, coordinate sanity, exit-portal counts, <=5 candidates: all pass (`interior_catalog.py validate`; 15 unit tests, CI workflow `x9-interior-catalog.yml`).
Transform convention (stored YMAP rotation applied as-is) is validated empirically: 117,791 of 117,930 interior entities (99.88%) land inside their YMAP's entity extents (3 m tolerance).

## Top five X9 candidates (triage only)

| # | Interior | World position | Rooms | Exit portals | Co-located / nearby exterior model | Layers |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | v_guardtower | 1569.8, 2680.4, 44.6 | 2 | 9 | cs6_04_prisontower6, 9.1 x 9.1 x 23.4 m, 0.02 m from pivot | base, update-dlcpack |
| 2 | cs1_14brailway3 | -545.8, 4923.0, 91.6 | 1 | 2 | cs1_15c_retwalb003, 18.2 x 8.2 x 9.8 m, 40.6 m away | base, update-dlcpack |
| 3 | v_gun2 | -327.2, 6079.3, 30.5 | 1 | 3 | cs1_06_tractor_alpha, 27.2 x 11.8 x 6.9 m, 2.4 m away | base, update-dlcpack |
| 4 | v_gasstation | -1827.5, 791.0, 137.2 | 3 | 4 | ch1_06c_petrol, 80.9 x 68.2 x 23.6 m (very large) | base, update-dlc_patch, update-dlcpack |
| 5 | v_clotheslo | 1693.5, 4823.7, 40.9 | 2 | 7 | cs2_01_clothshop, 19.1 x 17.1 x 6.5 m, 1.0 m away | base, update-dlcpack |

Scores are fixed-weight triage aids (see `WEIGHTS`); one candidate per interior archetype and per 150 m area.

## Best next candidate

**#1 v_guardtower at (1569.8, 2680.4, 44.6).** A compact (~9 m) tower shell whose exterior model sits on the MLO pivot, so a bounded collision study is plausible, in contrast to the sprawling overlay walls rejected in #318.
Next step (still investigation only): resolve which YBN child bounds cover the tower shell and exit-portal positions at polygon level, then check LOD parent and NVE override behaviour. Caveats: it is a prison tower (hostile area, likely restricted/online-vs-story treatment unverified), and a metadata match proves nothing about breachability.

## Coverage limitations

- No collision polygons, mesh geometry or runtime checks; YBN files are matched by name only.
- Layer precedence (base < update < DLC < NVE) is assumed; every variant is listed, none proven active.
- Offline/story availability and "online-like"/"underground-like" flags are name/layer heuristics.
- Exit portal = room topology only, not a physical doorway; exterior-model association is distance-based guesswork.
- Nearby-structure scan keeps only non-prop models with footprint >= 6 m and height >= 2.5 m; smaller walls are not indexed.
- 10 interiors have no placement; 100 interior entity names and 160 entities lacking a model file are unresolved/absent by name; unparsable YMAPs appear only in raw logs.
