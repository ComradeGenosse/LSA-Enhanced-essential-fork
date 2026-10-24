# South glazed façade: actual Windows partition validation

2026-10-24. Operator and publisher: Codex, local Windows. Separate Git worktree,
based on latest draft #323 `b1513fd09dbed3585be6b5dd8e4c6e85a55b684e`, stacked
on #322 `07793c3788dbdeefbf9369d2904b95a5e52df416`.

## Verdict

**Offline geometry PASS / GO to a private resource round-trip prototype for
the pinned base-hipster scenario. GTA gameplay acceptance: NOT RUN.
Deployment and a fully isolated loadable opening: NO-GO pending later gates.**

The actual south partition was replayed against the reviewed private #320
primary geometry and #322 entity-set extraction. This is separate from the old
north replay and from CI's synthetic tests. The unchanged #323 adapter passed
first. No actual geometry failure or ownership mismatch required a cut fix.
The continuation adds preserved-measure reporting, explicit unchanged-record
checks and actual-candidate mutation challenges. It does **not** change the
profile, bounds, evidence pin, authorization set, tolerance or partition output.
Initial and audited candidates have the identical SHA-256 digest:

`81edaca5742030a3564302453e3dba053dc341d17d8540c747ace9a1c1755e3b`.

## Inputs and exact authorization

All three independent pins passed before processing geometry:

| Input | Reviewed fingerprint |
| --- | --- |
| #320 primary JSONL SHA-256 | `6825722e87abf39489f04ec8e8a48726f00fc085e30445a1c6d16b4d4ecc05cb` |
| #322 entity-set JSONL SHA-256 | `5b224827985e633f6b83f2efec974cc38153900e8937d9826809ef97e346b594` |
| Complete #322 alternative-evidence Git blob SHA-1 | `ae9153a0f1d55765538dc8e9f742c54a786006d7` |

Full file/instance/model/geometry/primitive/material identities match the pinned
inventory: **497,680 represented source records, 182 authorized identities in
13 groups**. No high-YBN cut is authorized. No new intersecting owner was
admitted. The 32 reviewed weed identities remain protected. Wrong primary/set
bytes, base-cheap, both NVE profiles and unknown profiles all reject before
geometry replay (`south-negative-gates.json`). Changing even whitespace in the
pinned evidence rejects in the regression test.

The raw digests also bind the original extraction's resource hash/flags/metadata
records. This run uses the reviewed extractions; it does not claim to re-extract
or rehash all current installed RPF contents. Host CodeWalker and game-executable
hashes still match #322. A bounded before/after comparison of all 199 archive
paths/sizes/mtimes is equal; this is stat evidence, not full-container hashing.
Source/runtime fingerprints are in `south-validation-provenance.json`.

Opening centre **(1689.965958, 4815.771294, 42.293717)**; 1.50 × 2.30 m.
Unchanged local cut bounds: X [6.95,7.65], Y [-5.25,-3.75], Z [.26,2.56].
The reference window plane is local X 7.3760076363. World corners:

| Corner | World X | World Y | World Z |
| --- | ---: | ---: | ---: |
| A lower | 1689.222443 | 4815.672882 | 41.143717 |
| B lower | 1690.709474 | 4815.869706 | 41.143717 |
| C upper | 1690.709474 | 4815.869706 | 43.443717 |
| D upper | 1689.222443 | 4815.672882 | 43.443717 |

## Removed and preserved measures

These are sums of actual source triangle areas or reconstructed oriented-solid
volumes, **not bounding-box overlap measures**. Areas include multiple authored
layers, both sides and LOD alternatives; do not interpret their sum as a net
physical hole area. “Original/preserved” here refers to the selected primitives,
not the entire named resource. Full precision and each of the 13 owner groups
and hashed source identities are in `south-validation-results.json`.

| Selected owner | Unit | Count | Original | Removed | Preserved remainder |
| --- | --- | ---: | ---: | ---: | ---: |
| `v_51_windows03`, geometries 0–4 | m² | 100 | 31.4526136559 | 14.2757835624 | 17.1768300935 |
| `v_51_reflectproxy`, geometry 0 | m² | 1 | 23.3503002359 | 3.4500000000 | 19.9003002359 |
| `cs2_01_shop_dec2`, geometries 3/4 | m² | 15 | 0.9324000247 | 0.4917197376 | 0.4406802871 |
| Near MLO LOD `1814693341` | m² | 60 | 4.3189552329 | 3.7593606766 | 0.5595945562 |
| `cs2_01_clotheslow_slod`, geometries 0/1 | m² | 4 | 35.7351731045 | 6.8881841903 | 28.8469889141 |
| Interior `v_clotheslo`, root/0 box 98 | m³ | 1 | 1.0813739718 | 0.1113294424 | 0.9700445293 |
| Normal `cs2_01_5`, root/0 box 209 | m³ | 1 | 21.2736693324 | 1.4313317942 | 19.8423375391 |

Selected visual totals: **28.865048166995834 m² removed,
66.92439408686059 m² preserved**. Selected solid totals:
**1.542661236639999 m³ removed, 20.812382068339957 m³ preserved**.
Maximum primitive conservation residual: **3.552713678800501e-15 m²** for
triangles, **9.395968447734049e-10 m³** for boxes, within unchanged 1e-7
absolute/relative tolerance. Every authorized primitive has a positive cut.

All **497,498 unauthorized records** are exact, unchanged remainders with
matching source metadata digests: 495,276 triangles (73,629.80383029554 m²) and
2,222 boxes (6,287.897086454517 m³). Their removed measure is zero. Protected
weed surface intersecting the opening is **0.6432667966657496 m²**, kept intact.
The complete candidate passes recomputation/comparison against the full source
inventory, not only a selected-owner comparison.

## Preservation and scope of proof

- **Sill/floor:** cut starts at Z .26, above the inspected .25098 visual sill;
  floor source geometry remains unchanged. Actual sill and floor mutations reject.
- **Counter/displays/weeds:** no authorization is added for them; all represented
  records remain exact. Separate actual counter, display and weed edits reject.
- **Collision:** box 209/98 remainders conserve volume. Their mutations reject.
  High collision is uncut and a high-collision mutation rejects. All unrelated
  represented collision is exact; no child/resource deletion is used.
- **Other layers/geometry:** exact-inventory comparison rejects unrelated edits,
  including an actual NVE alternative, changed owner/material digest, added
  record and removed record. **13/13 actual-candidate mutation challenges reject.**
- **Other shop instances:** no YMAP/YTYP reference, source resource or installed
  file is written. Thus this in-memory trial changes no world instance. It does
  **not** prove isolation of a future serialized resource: `v_clotheslo` and its
  drawables are shared across seven catalogued placements. Exporting these cuts
  under their global names would be unsafe. Clone/rebind and full sibling-YDD
  entry preservation are still NOT RUN, not inferred from this record oracle.

The oracle represents extracted triangles/boxes, not complete serialized game
resources with every vertex attribute, dictionary sibling, BVH and quantized
field. Pinned raw hashes and the prior zero unsupported-passage candidates
remain extraction coverage evidence; they are not an edited-resource parser.
The prior base-hipster player-sized landing/aisle and portal-2 metadata checks
remain applicable to these unchanged bounds; gameplay, step handling and culling
were not newly tested or certified.

## Concrete next milestone — no deployment

**One private scratch normal-YBN serialize/reload round-trip for box 209.** Load
the original `cs2_01_5.ybn` through the existing CodeWalker tooling, build only
the authorized box-209 cut/remainder (including necessary cut caps), save to a
private output path, reload it, and compare every other primitive, material,
flag, bound transform and acceleration structure semantically. Check the edited
piece's quantized area/volume and seam/clearance after reload. Preserve the
original installed file; do not register or install this prototype.

That is the smallest discriminator toward a loadable authored collision asset,
not permission to implement the whole building or launch GTA. After it passes,
target-only MLO/drawable cloning and exact placement rebind must prevent changes
to the other six shops, followed by visual/YDD and interior-box-98 round-trips,
LOD hierarchy handling and portal visibility. Active base-vs-NVE precedence,
coarser SLOD and runtime collision switching remain gates. Cheap/NVE profiles
stay blocked; no profile switching or cut expansion is a workaround.

## Reproduction, tests and handoff

Use pinned numpy 2.2.6 / scipy 1.15.3 and the same private files:

```powershell
python "$study\south_partition.py" --profile base-hipster --raw "$raw" --set-raw "$sets" --audit > "$scratch\south-validation-results.json"
python -m unittest discover -s $study -p 'test_*.py' -v
```

Local study/catalog tests, catalog validation and whitespace checks pass. The
new stacked draft records final GitHub CI. CI checks source/synthetic behavior
and committed derived receipts; **the Windows replay above is the private-geometry
proof**, and neither is GTA gameplay acceptance.

Allowed writes were this isolated source worktree and private task scratch only.
No game launch, controller requests, installed asset writes, fracture, export,
deployment or merges. Installed/loaded candidate: none. Gameplay/world restore:
NOT RUN / N/A. No installed change required filesystem rollback. Rollback for
this source increment is reverting its commit. Private arrays remain outside Git.
