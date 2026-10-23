# X9 Windows replay and alternative façade section

Operator/publisher: Codex, local Windows, 2026-10-23. Based on latest draft #321
`1d81bfcdaac402baf1dd95fffb519a05dce8911b`, itself stacked on #320/#319.
Read current AGENTS.md, operating standard, PC playbook, controller runbook,
roadmap/current contracts and prior study. User owns this offline handoff;
Codex owns its source, validation and publication. No live operator takeover.

## Decision

**Original north wall: NO-GO for passage.** Real subtraction now passes after an
authorization fix, but preserved display collision still blocks it.

**South / local positive-X glazed façade: GO for the next bounded offline
partition/authoring step under an explicitly pinned hipster profile; NO-GO for
deployment now.** It opens into the real shop-floor room, behind the cashier
counter, with a clear landing and 4.55 m aisle sweep. This is a window/façade
breach candidate, not a newly discovered solid masonry panel. No unconditional
GO is claimed for the unknown currently loaded profile. The cheap-clothing set
has posters across this section; preserving those visual objects is an unresolved
blocker for that profile. Do not relocate displays or silently switch profiles.

No fully qualified solid-wall destruction target is established. If the target
must be solid masonry, or this glazed/profile-specific candidate is unacceptable,
the existing catalog's next choice remains **v_guardtower at
(1569.8, 2680.4, 44.6)**. Its compact shell is only catalog triage, not geometry
acceptance; no new building survey was performed here.

## Actual private replay, not synthetic acceptance

`replay-results.json` contains the fixed real replay: **497,680 source records,
74 authorized identities, conservation and strict candidate comparison PASS**.
Triangle area and oriented-solid volume are checked at the existing 1e-7
absolute/relative tolerance. Six real-candidate mutations are rejected: triangle
remainder, box remainder, protected remainder, missing record, extra record and
owner/material source digest. Unedited represented geometry remains exact under
the strict in-memory oracle. This is not verification of a serialized edited
resource or arbitrary alternate tessellation.

Reviewed raw SHA-256:
`6825722e87abf39489f04ec8e8a48726f00fc085e30445a1c6d16b4d4ecc05cb`.
Fixed candidate digest:
`91131b8387b4fd090e87c3c9d590b962672d11c82b4c43adf1aa77725efde9d2`.

The first actual #321 replay passed its own overly broad oracle: it authorized
**43 prop_weeddead_nxg02 triangles / 0.3559966993 m²**, because it treated the
intersection inventory as authorization except for a few excluded names.
That was an unauthorized scope expansion. The fix admits only reviewed
structural/visual wall dependencies, then applies the existing full owner/ID
identity checks. Weed cut area is now **0**, and the same 0.3559966993 m² is
reported as protected intersection. Display meshes remain protected, as does
root/0 display box 1 (1.0578314295 m³ intersects the original cut prism).
The public `verify` function also now rejects missing authorized source IDs.

Normal collision box 237, high triangles 3008/3009 and interior box 241 remain
separately partitioned. Their removed measures are respectively 1.4221890767 m³,
3.4500010166 m² and 0.0687809326 m³. Their remainders and all other represented
records pass exact expected-candidate comparison. No installed collision changed.

Fresh extraction with unchanged #321 reader produced 4,702 JSONL records;
all **4,701 non-run records are identical** to #320, including **91 resource
hashes**. The whole raw digest changes because the run timestamp changes; the
reviewed hash guard was retained, not weakened. `fresh-comparison.json` records
both raw digests and identical semantic content digests. Fresh scanning parsed
**15,570 YBNs, retained 9, zero errors**. Game executable and CodeWalker DLL
hashes match #320. Both fresh and expanded-set extraction leave the 199 archive
path/size/mtime records unchanged. This is not a full-content RPF rehash.

## Exact promising opening and preserved route

Reference plane: actual `v_51_windows03` model 0, geometry 1, triangle 0,
local X = 7.3760076363. Local lateral limits Y = -5.25 to -3.75;
Z = 0.26 to 2.56. Width 1.50 m, height 2.30 m.

| Corner | World X | World Y | World Z |
| --- | ---: | ---: | ---: |
| A lower | 1689.222443 | 4815.672882 | 41.143717 |
| B lower | 1690.709474 | 4815.869706 | 41.143717 |
| C upper | 1690.709474 | 4815.869706 | 43.443717 |
| D upper | 1689.222443 | 4815.672882 | 43.443717 |

Centre **(1689.965958, 4815.771294, 42.293717)**. Outward normal approximately
(0.131216, -0.991354, 0). Coordinates are reproducible derived plane coordinates,
not a claim of submillimetre authoring accuracy. Inspection cut depth is local
X [6.95,7.65]; it is not permission to delete all intersecting objects.

Conservative rectangular sweeps contain a 0.35 m radius, 1.85 m tall upright
capsule at feet Z .28. Landing: X [6.05,6.75], Y [-4.95,-4.25]. Aisle continuation:
X [6.05,6.75], Y [-4.95,-.4]. Both have **zero actual mesh/collision surface
intersections, zero box containment, zero unsupported collision candidates**.
Both archived clothing entity-set alternatives were separately transformed and
checked, including actual YFT lilo geometry and its oriented BoundBox collider;
their landing/aisle intersections are also zero. This proves a bounded aisle
inside room 1, not unrestricted circulation around the whole counter or shop.

Exterior approach X [7.65,9] at the same Y/Z envelope has no collision hits.
It intersects thin weed meshes; those remain preserved, not treated as rigid
blocking walls or cuttable assets. Ground ray at local X 8.5 hits Z .1264204;
interior floor at X 6.4 hits Z .1793859. The uncut visual sill rises to about
Z .25098; opening starts at .26 and the body envelope at .28. This leaves a
roughly .125 m visual step from sampled outside ground. Offline standing
clearance is demonstrated; actual game step/traversal is not.

## Actual dependencies and variants

`alternative-evidence.json` lists full paths, model/geometry/entity IDs and actual
clipped areas for each dependency, with normal/high alternatives kept separate.

| Layer | Finding at this exact section |
| --- | --- |
| Interior collision | `v_clotheslo.ybn` root/0 **box 98**, a long positive-X wall collider. Root/0 also contains protected display primitives, so deleting the child is forbidden. |
| Normal world collision | `cs2_01_5.ybn` root/0 **box 209**; extends inward to about X 6.988, requiring the full inspected cut depth. Preserve all of its remainder. |
| High collision | No high-YBN polygon intersects this opening in the complete retained regional query. Do not invent a high collider from root bounds or reuse north-wall high IDs. Both high resources were included in the query. Loaded resolution behavior remains a runtime gate. |
| HD visuals | `v_51_windows03` geometries 0–4, `v_51_reflectproxy` geometry 0 triangle 8, `cs2_01_shop_dec2` geometries 3/4. The main shell has no solid face across this window rectangle. Keep the .251 sill and all counter/display geometry. |
| MLO / portal | Actual room-1 shell/window relationship and floor rays place the landing in `V_51_ShopFloorRm`. Existing **portal 2**, room 1 → limbo 0, flags 8, lies at X 7.365801, Y [-6.213129,-1.0090392], Z [.07909787,3.465098], spanning this section. Its flag/culling behavior must still be validated; no new portal is assumed necessary merely from metadata. |
| Near/coarser LOD | MLO near LOD hash **1814693341** has actual intersections. `cs2_01_clotheslow_slod` geometries 0/1 each have triangles 2/3 intersecting. Exterior `cs2_01_clothshop_lod` has no intersection at this exact window rectangle. Preserve dictionary siblings and the #320 hierarchy. District slod3 remains uninspected. |
| NVE | Base/NVE primary geometry and all extracted set alternatives were queried as separate archived alternatives. NVE Lights can replace the target YMAP; NVE Interiors can replace the MLO. Existing window asset is shared; do not globally overwrite it. Profile precedence and target-only references are unresolved. |
| Optional sets | Both sets have complete root-mesh coverage after enabling YFT extraction. `clotheslowcheap` adds actual `v_51_posters` triangles across the aperture. Neither set intersects the landing/aisle, including the two lilo props. Hipster is the cleaner bounded authoring profile; activation is not proven. Fragment root drawables and PhysicsLOD1 bounds were inspected, not runtime fragment state. |

The bounded perimeter triage used 1.5 m windows at 0.5 m spacing, followed by
actual triangle clipping and reconstructed solid checks on promising sections.
North/rear wall sections run into displays, garment meshes or partitions; the
front's obvious clear interval is the existing entrance. A shallow south query
looked clear but a straight 1.8 m penetration runs into the counter; the verified
route instead lands in the real aisle and turns. No display deletion was used
to manufacture clearance. This finite scan is not proof that every possible
oblique aperture on the building has been exhausted.

## Smallest next implementation and blockers

Pin one supported profile and the exact placement first. For the hipster case,
make **one offline in-memory cut/remainder candidate for this glazed rectangle**:
boxes 209/98, the listed window/decoration/reflection faces and intersecting LOD
faces only. Preserve sill, counter, displays, weeds and dictionary siblings.
Reuse this verifier; do not keep polishing the rejected north opening. For a
cheap profile, stop until poster preservation has an explicit acceptable plan.

After that candidate passes, an instance-specific clone/rebind and resource
round-trip are still required before any installed change. Other six shop
instances, flags/materials, full normal-collision resource remainder, NVE
placement precedence, LOD transitions and portal visibility must survive.
No resource writer, fracture, deployment or GTA launch was performed here.

Rollback is reverting this source commit. Installed/loaded candidate: none.
Requests, gameplay, world restoration: NOT RUN / N/A. Filesystem restoration:
no installed writes; archive stat inventories unchanged. Private arrays, DLLs,
keys, asset exports and game payloads remain local outside Git.

## Reproduce and validation

Build the existing reader as in README. Without `X9_ENTITY_SETS`, its extraction
matches #320 except the run timestamp. For the additional bounded set check,
set `$env:X9_ENTITY_SETS='1'` before running the reader into another private
scratch directory. It now includes the shop's set YDRs/YFTs and PhysicsLOD1
collision bounds. Keep both raw outputs private.

```powershell
$env:X9_RAW = 'C:\private\reviewed-320\focused.jsonl'
python "$study\cut_verifier.py" --audit > "$scratch\replay-results.json"
$env:X9_SET_RAW = 'C:\private\entity-sets\focused.jsonl'
python "$study\alternative_sections.py" > "$scratch\alternative-evidence.json"
python -m unittest discover -s $study -p 'test_*.py' -v
```

Pinned numpy 2.2.6 / scipy 1.15.3. Final local study and catalog tests, catalog
validation and whitespace checks pass; see the stacked draft's CI for the
remote result. Synthetic tests and committed-evidence checks are regression
gates; the separate Windows replay above is the actual-geometry evidence.
