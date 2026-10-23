# Exact section offline partition / isolation handoff

Operator/publisher: Codex, 2026-10-23. Stacked on #320 head
`a01014219d9fb7f2c93e5ced1b8932f89f01e812` (itself on #319/#318).
Scope: repository Python, tests, CI and this plan only. No installed assets,
GTA, P2, resource writer, fracture or deployment. Rollback is reverting this
source commit. Stop rather than survey/rebuild the district, relocate displays,
or change other shops to satisfy a passage test.

## Decision

**An isolated surface/solid subtraction is mathematically achievable; a safe,
usable isolated opening at this exact section is NOT demonstrated and remains
NO-GO for deployment.** The known display intersects the passage and must remain
unchanged under this task. Cutting it is not an acceptable way to pass. No
existing portal covers the section. Full private-geometry verification is
NOT RUN here: this Linux workspace has neither the private `focused.jsonl` nor
the Windows installed archives. Derived intersections cannot reconstruct the
original triangles or oriented solid corners. CI tests the algorithm and checks
committed evidence coverage; it does not validate proprietary game geometry.

## Partition contract

`cut_verifier.py` uses the #320 MLO-local frame and exact lateral/vertical limits
Y [-3,-1.5], Z [.18,2.48]. X [-7.8,-7.1] is the previously inspected wall-depth
envelope, **not authorization to delete every object in that volume**. Only the
full file/instance/model/geometry/primitive/source-ID identities already listed
in `cutPrism.actualSurfaceIntersections` may be cut. Display meshes and child 0
collision are explicitly protected. All other input geometry, including floor,
sill, neighboring structures, nonselected triangles and dictionary entries, is
preserved. The wider passage prism is never a deletion region.

Triangles are clipped successively against six planes. Each rejected polygon
is one disjoint remainder; retained vertices stay on the original face and
winding is preserved. Oriented boxes use their actual reconstructed corners,
convex halfspaces and plane intersections, not AABB substitution. Solid
remainders include implicit cut caps. Area and volume must sum to their source
within 1e-7 absolute/relative tolerance. This is floating-point offline analysis,
not quantization/export seam certification. Material/owner identity is hashed
with each source. The strict candidate oracle rejects missing/extra records,
metadata changes and any changed fragment, including outside the opening.
Alternate tessellation is deliberately rejected; resource serialization, vertex
attribute interpolation, winding of serialized caps, BVH rebuilding and
quantized round-trip validation are not implemented.

The private adapter reads all transformed triangles from the existing #320
reader/transform code, groups box faces back into solid corners, and partitions
normal `cs2_01_5` box 237, high `hi@cs2_01_8` triangles 3008/3009, interior child 1
box 241, shell, overlays, decoration and near LOD intersections separately by
archive path. Protected display collision box 1 is measured but never cut.
All other supported triangles/boxes are retained in the candidate inventory.
Unsupported primitives are not represented as editable candidates; the reviewed
raw digest plus #320's zero unsupported passage candidates is mandatory. This
is an oracle for this in-memory representation, not an arbitrary edited YBN
validator or proof of complete extraction/entity-set coverage.

For a bounded private replay, follow README's extraction instructions with the
same reviewed data, then (stdout is derived measures/digests only):

```powershell
$env:X9_RAW = "$scratch\raw\focused.jsonl"
python -m pip install numpy==2.2.6 scipy==1.15.3
python "$study\cut_verifier.py" > "$scratch\partition-measures.json"
```

A digest mismatch stops; refreshed assets require a new reviewed evidence
baseline. `partitionVerified` only certifies the generated candidate against its
source, never deployment. Keep raw data and candidate polygons private. The
adapter retains them in memory and cannot write game resources. Output always
labels deployment BLOCKED. Existing extraction limitations still apply.

## Instance-specific clone/rebind plan (not executed)

1. Freeze an active profile first: base or NVE interiors, NVE Lights on/off,
   DLC precedence, entity sets and exact hashes. Produce separate immutable
   before/after dependency graphs for each supported profile; never mix archive
   alternatives into one assumed loaded scene. An unknown profile must refuse
   loading the patch.
2. Allocate unique target names/hashes (collision check required), e.g.
   `x9_1693_clotheslo`, unique physics dictionary and unique edited interior
   drawable archetypes. Clone the selected base **or** NVE MLO definition,
   rooms, portals, entity sets, extensions and collision dictionary; rebind only
   edited cloned interior entity archetypes to private drawables. Unedited
   resources remain shared read-only. Never replace global `v_clotheslo.ybn`,
   `v_int_51.ytyp` or global shell archetypes.
3. Resolve the exact MLO placement at (1693.4592,4823.674,40.883717), quaternion
   (0,0,-.6590842,.7520692), to its full YMAP path/index/GUID in each active
   profile. Preserve transform, entity flags, room/entity-set links and streaming
   fields; change only that placement's archetype reference. Do not select by
   name/proximity alone. This placement rebind is not yet authored or verified.
   Assert the other six catalogued shop placements and their dependency graphs
   are identical. Base and NVE clones require independent diffs.
4. For the exterior, clone/rebind shell entity 5/GUID 2224805978 and selected
   decoration dependencies only in the winning `cs2_01_strm_1` (or hei variant).
   NVE Lights' rounded transforms and same GUIDs require exact profile matching.
   Replacing a vanilla YMAP alone is insufficient. Preserve all other entries.
5. World collision cannot be isolated by MLO rebinding: replace only the named
   normal/high YBN resources with complete copies whose selected primitives
   have been partitioned. Preserve every other polygon, material, child transform,
   flags and acceleration bounds. This is still a shared spatial resource;
   require full-resource semantic and unrelated-region collision comparisons,
   not just the hole rays. No whole-child removal. Unknown collision layer stops.
6. Clone the affected YDD drawable entries/LOD archetypes and rebind the target
   hierarchy while retaining all unrelated entries and parent relationships.
   Account for entity 147 -> local 18, MLO LOD entity 137 -> local 0, and coarser
   `cs2_lod` entity 13. Near LOD hash 1814693341 and shell LOD require cuts;
   the district coarser mesh was not fully surveyed. If safe persistence requires
   unbounded district reconstruction, STOP; this task does not authorize it.
7. Validate a complete reference diff: only the target placement's reachability
   changes, every other clothing shop still resolves the original resources,
   and no global same-name override is introduced. Unique naming alone is not
   proof. Resource authoring, loader registration and runtime isolation are open.

## Visibility and deployment blockers

A new shop-floor room 1 <-> limbo 0 portal must be designed at the actual opening,
with correct winding, corners, flags, room bounds/attachments and entity-set
behavior. No current portal can simply be reused. Portal authoring and both
view directions, room transitions and exterior/interior occlusion must be
validated. Baked shadows, overlays, reflection proxies, occluders, LOD culling
and streaming/pop-in remain unresolved; subtraction alone cannot certify them.

Displays remain a physical/visual obstruction in base and NVE. Floor/sill and
roughly 0.10–0.12 m threshold require capsule clearance checks without lowering
or deleting floor. Normal/high collision switching needs consistent results.
Full private replay, export round-trip checks, profile precedence, clone/rebind
reference proof, coarser LOD policy, visibility and loader registration all block
deployment. Runtime traversal/restoration/performance and fracture are later,
separately authorized gates, not work performed here.

## Validation and next bounded action

Ten local tests pass: four inherited geometry tests and six new tests covering
triangle boundary/winding, oriented solid conservation/disjointness, protected
display obstruction, per-layer preservation mutations, invalid inputs and
committed ownership coverage. An initial triangle fixture expected a rectangle
larger than its triangle intersection; fixture corrected, final tests pass.
GitHub CI runs the same suite alongside catalog validation. See the stacked PR
checks for the remote result; CI has no installed game data.

Next: replay the verifier against the exact private digest on its authorized
host and inspect derived measures, without writing assets. Preserve the blocked
verdict if displays still obstruct; do not broaden the region or relocate them.
Read current AGENTS.md and agent-operating-standard before any PC work; use the
latest PR head, not an old summary. Installed/loaded identity, requests, gameplay,
world restoration and filesystem restoration: NOT RUN / N/A.
