# GT0 — offline ground-truth foundations (research-only)

Implements [GT0 from the E0 implementation roadmap](../research/IMPLEMENTATION-ROADMAP-20261019.md). **No GTA/RPH native calls, mod installation, gameplay modifications, destructive mechanics, uploaded Rockstar assets, or claims of confirmed geometry.** This is a future-supporting tool for the independent E0.2/E0.3 research plugin, not a replacement for live verification.

## What actually works today

- **Candidate-source ray index:** Deterministic finite-segment hits against private triangular and oriented-box primitives. Returns *all* plausible intersections, distance-sorted, with material index and exact **source/variant/bound/primitive** identifiers. Marks overlapping/competing sources and incomplete world coverage explicitly. Supports nested row-vector transforms for placed objects, MLOs and embedded collision; refuses to double-transform static world-space YBNs or assume sheared boxes are rectangles.
- **Private provenance graph:** Reads the existing extraction manifest's YBN/YMAP resource paths, decoded/archive fingerprints, YMAP parent hashes, physicsDictionary hashes and referenced archetype hashes. Resolves potential parent/dictionary candidates while explicitly leaving unidentified YTYP providers and active mod/IPL winners UNRESOLVED. No binary assets read.\n- **Existing CodeWalker import:** Reads locally generated private `candidates.json` and its candidate pool; deduplicates box primitives by source asset, bound and polygon index. It **does not fabricate triangles** when the existing output contains only centroid/normal/area. It marks incomplete YMAP/embedded coverage and unknown active IPL/mod precedence; no import yields "PROVEN_ACTIVE" without independent evidence.
- **Catalog validator:** Validates against the research JSON Schema and adds source/active-winner, independent identity, collision/screenshot, session repeat, hit/normal/material and thickness gates before any record can be marked CONFIRMED. Missing evidence is not inferred from an ordinary material hash match. Preserve all attempts in the private catalog.
- **Future GTA filter matrix planner:** Generates the existing `traceFlags=17, optionFlags=7` baseline plus four read-only variant requests, on exactly the *same* private start/end; marks all requests NOT_RUN. It retains the 2/6 material misses, 3/4 wall identity failures and 0/10 inside-solid failures as historical baseline. **The planner never calls GTA**.
- **Optional spawnable discovery:** Accepts verified-syntax model hashes from local object lists, including user-curated Durty or CodeWalker data, as `CANDIDATE_ONLY`. It does **not** require Menyoo/Durty, assume collision exists or attempt spawning. GT2 would use the separately reviewed lab's own spawn/ownership/cleanup.
- **Public export:** Defaults to a tiny counts-only allowlist; excludes all source paths, names, hashes, XYZ, screenshots, notes and sample IDs. Raw scene/catalog/trace/filter/discovery files are PRIVATE.

## Setup and commands

Python 3.10+ and `jsonschema>=4,<5`. On Windows PowerShell, `python -m pip install "jsonschema>=4,<5"`. No Rockstar dependencies are required. From repository root:

`python native/physics-e0/ground-truth/cli.py validate "D:\private\e0\catalog.private.json"`

`python native/physics-e0/ground-truth/cli.py adapt-codewalker "D:\private\e0\candidates.json" --output "D:\private\e0\scene.private.json"`

`python native/physics-e0/ground-truth/cli.py build-provenance "D:\private\e0\manifest.json" --output "D:\private\e0\source-graph.private.json"`

`python native/physics-e0/ground-truth/cli.py trace "D:\private\e0\scene.private.json" --rays "D:\private\e0\rays.private.json" --output "D:\private\e0\trace-results.private.json"`

`python native/physics-e0/ground-truth/cli.py plan-filters "D:\private\e0\catalog.private.json" --output "D:\private\e0\planned-filters.private.json"`

`python native/physics-e0/ground-truth/cli.py discover-spawnables "D:\private\e0\scene.private.json" --output "D:\private\e0\spawnable-list.private.json"`

`python native/physics-e0/ground-truth/cli.py export-aggregate "D:\private\e0\catalog.private.json" --output "D:\private\e0\safe-counts.json"`

`python -m unittest discover -s native/physics-e0/ground-truth/tests -p "test_*.py" -v`

**The CLI never silently writes back to the source inputs.** Non-public output commands require a `.private.json` suffix. Keep all private files OUTSIDE the repository, including all config files, candidate coordinates, original exported material tables, CodeWalker XML, screenshots and full source manifests. A Git branch in this repository is publicly readable. Git ignores are defense-in-depth, not publication permission.

### Private minimal scene format (shape, NOT real coordinates)

The private scene must include `sceneSchemaVersion:1`, `coverage` with four **explicit** booleans (`sourceSetComplete`, `includesPlaced`, `includesEmbedded`, `precedenceEstablished`), and `colliders[]`. Each collider needs `colliderId`, `source{assetId,boundPath,primitiveId,variantId}`, `activation` (`PROVEN_ACTIVE`, `POSSIBLY_ACTIVE` or `PROVEN_INACTIVE`), `materialIndex` and geometry:

- `{kind:"BOX", center:[x,y,z], halfAxes:[[x,y,z],[x,y,z],[x,y,z]]}` (each vector is a true half-edge; axes are transformed and checked for skew).
- `{kind:"TRIANGLE", vertices:[[x,y,z],[x,y,z],[x,y,z]]}` (actual 3 vertices required; offline candidate center alone is insufficient).
- `coordinateFrame` is `WORLD_STATIC_YBN`, `LOCAL_PLACED`, `LOCAL_MLO` or `EMBEDDED`. For local variants, `transformChain` holds 4×4 row-vector affine transforms in application order; world static YBN must have an empty chain.
- Optional `spawnableCandidates` contains model hashes, source and `status:"CANDIDATE_ONLY"`. External catalog strings are untrusted discovery inputs, not runtime proof.

The rays file is a private JSON array of `{rayId,start:[x,y,z],end:[x,y,z]}`, 0.05–100 m finite segments, max 1000 rays. The index checks all provided candidate colliders, but **does not infer unextracted triangle or embedded geometry**. A unique nearest hit from a full *declared* synthetic scene is still `UNIQUE_OFFLINE_CANDIDATE_NOT_LIVE_CONFIRMED`, never CONFIRMED.

### Where the input graph comes from

Existing extraction: [`Extract-E0Assets.ps1`](../asset-research/Extract-E0Assets.ps1) and [`analyze_e0_assets.py`](../asset-research/analyze_e0_assets.py) exist on the separate `research/physics-e0-asset-extraction-20261019` branch. Do not assume those files are in this branch's own tree. The initial **adapter currently handles reconstructable box candidates, not a complete asset loader**. To truly index all physical objects, GT1 will need a PRIVATE export containing the full triangles and placed/embedded collision source graph and independently verified active DLC/IPL/mod variants. The GT0 index deliberately reports that coverage as incomplete. It does not masquerade as an end-to-end CodeWalker archive parser.

This implementation contains no real GTA sample coordinates, materials.dat, meshes or proprietary source assets. Unit tests are synthetic and marked as such.

## What GT0 does NOT unblock

It cannot yet identify which static collision primitive GTA's native engine hit. Static world collision often does not have a resolvable script object model. It cannot prove NVE or LA Roads mod precedence, capture images, infer game-dependent start-inside behavior, fix the 2 missing materials, or reconcile wall samples 3/4. GT2/GT3 still require owner's interactive GTA Enhanced single-player runtime. Do not "repair" the baseline by substituting easier samples.

## Acceptance review

- Tests exercise finite triangle/box intersections, outward normal and inside-solid distinction, near-overlap ambiguity, source-activation confidence, nested transforms, double-transform rejection, privacy, immutable filter plans and schema-driven confirmation.
- The initial GT0 schema is deliberately **proposal-level**: JSON Schema validates structure and the Python domain validator imposes stronger promotion policy. The validator is not a cryptographic attestation; reviewer and raw private evidence remain required.
- Existing source results stay untouched: 28/30 material matches, 8/10 thickness agreement and 0/10 inside-solid hits.
- No CI job launches GTA or accesses private resources.
