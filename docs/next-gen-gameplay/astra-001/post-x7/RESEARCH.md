# Technical evidence and design decisions

Evidence labels are defined in [README](README.md). Repository paths below refer
to #300 `39eb1601`; re-inspect the integrated generator after #301 lands.

## What the existing evidence settles

Primary project evidence, rather than milestone titles:

- [X1](../07-X1-RESULTS-20261020.md), [X2 final](../10-X2-FINAL-VALIDATION-20261021.md),
  [X3 partial](../12-X3-REPORT-20261021-PARTIAL.md) and
  [closeout](../13-X3-PHASE1-CLOSEOUT-20261021.md): native destruction is viable;
  strict traversal and debris strategies have documented exceptions. X3 n8
  registered only 6/8 rockets; that is not an engine cap. Cold 405/506ms spikes
  and unattributed prop growth remain limits, not solved performance claims.
- [X4 report](../14-X4-REPORT-20261021.md): the corrugated prop's own collision
  disappears under model hide; the wider static-building problem was not tested.
- [X6 acceptance](../../../../native/fragment-x6/evidence/acceptance/summary.json)
  and [screenshots](../../../../native/fragment-x6/evidence/acceptance/): matched
  procedural twin footprint, real player-through evidence and restored files.
  Reviewing original-armed versus twin-preview images shows a lighter surface
  and different rust/weathering on the twin. The silhouette result is stronger
  than material fidelity; a seamless appearance swap is not already established.
- [X7.2c results and photographs](../../../../native/fragment-x7/evidence/x72c/RESULTS.md):
  per-object protection works for the tested RPG and independently rooted strips,
  including shooting a protected neighbor. Wrong command-selected pairs still
  break the chosen pair; blast falloff alone cannot supply location selection.
- [#300 correlated live evidence](../../../agent-operations/2026-10-22/p2smoke-repair/README.md)
  and [FINAL.json](../../../agent-operations/2026-10-22/p2smoke-repair/FINAL.json):
  command, physical outcome, world restoration and filesystem rollback are
  independently recorded. One failed prediction exposed the original to damage;
  simply removing hide cannot repair that original. The exact collision-versus-
  target-plane timing discrepancy remains unresolved. Retain the qualified
  horizon policy; do not invent a universal 60ms guarantee.

**I:** reuse those mechanisms rather than build a new solver or repeat the
threshold ladder. **U:** multiple X7 instances, automatic-selection acceptance,
arbitrary player input, rearming after a previous blast, stream reconstruction
and save/load remain separate gates.

## Converting an ordinary asset: practical local workflow

**S — resource boundaries.** YDR supplies drawable/shader data; YDD is a drawable
dictionary; YTD supplies texture dictionaries; YFT adds fragment physics and
skeleton; YTYP supplies archetype metadata; YMAP supplies instances and LOD
relationships; YBN supplies collision. Embedded textures and collision can make
dependencies differ by asset. See official [drawable](https://docs.sollumz.org/documentation/drawables.ydr),
[fragment](https://docs.sollumz.org/documentation/fragments.yft) and
[CodeWalker extraction](https://docs.sollumz.org/tutorials/creating-interiors/importing-from-codewalker)
documentation. CodeWalker's [YmapEntityDef implementation](https://github.com/dexyfex/CodeWalker/blob/485d56bec00262ed7fa472261cce7bbc6202b96e/CodeWalker.Core/GameFiles/FileTypes/YmapFile.cs#L1453)
tracks position, orientation, scale, bounds and parent/child relationships.
Heading and model hash alone do not describe a general world instance.

**I — inventory before cutting.** Locally record source RPF paths/hashes, asset
generation, archetype, model pivot/bounds, complete placement matrix, shader
parameters, texture names/dependencies, all LOD owners and collision resources.
Check installed NVE/mod overrides using the existing local inventory. Leave
Rockstar extracts, converted meshes and textures outside Git/distribution. This
PR uses only already-authored custom assets. Distribute recipes/authored examples,
not vanilla source or converted derivatives.

**I — no-edit round trip gate.** Export/import an unchanged candidate first.
Require bounds/pivot within 1mm, unchanged shader/texture references, unchanged
exterior UV/color/normal data within serialization tolerance, and matched
silhouettes in all retained LODs. Inspect a material-lit preview and both sides.
If the exporter cannot preserve the asset's shader, choose a simpler asset or
author a visually convincing original twin as X6 did. Exact material fidelity
is desirable, not worth weeks of shader reverse engineering for a personal mod.

**S/I — author reusable pieces.** Sollumz's [prop setup](https://docs.sollumz.org/documentation/fragments.yft/prop-setup),
[bone physics](https://docs.sollumz.org/documentation/fragments.yft/bone-physics)
and [collision physics](https://docs.sollumz.org/documentation/fragments.yft/collision-physics)
describe the skeleton, rigid parts, per-bone collision/physics and dynamic
archetype setup. Use natural panel/board/mortar seams and few large pieces.
Preserve exterior geometry and corner attributes; add only cut caps/reveals and
mod-authored interior materials. Interpolate UVs/colors at new vertices and
preserve custom exterior normals. Closed thickness matters for believable edges.
Use a few simple collision shapes per rigid piece, with matching seams; do not
leave a full-wall collision bound on the anchored root. The existing recipe
already demonstrates these rules for corrugated metal.

The current [vertex-buffer builder](https://github.com/Sollumz/Sollumz/blob/e124bddf7c0db12a61655aa98d23d0e7008b3b69/ydr/vertex_buffer_builder.py#L162)
handles UVs, colors, normals, tangents and bone weights. **U:** that capability
does not guarantee that a boolean/cell-fracture operation preserves them.
Avoid whole-mesh auto fracture for the first wall. Reuse source LOD meshes where
possible; author section-aware damaged LODs or limit the supported damaged view
range. A distant intact parent LOD can visually seal a real hole. Source
[LOD tools](https://docs.sollumz.org/documentation/drawables.ydr/level-of-detail-lods-editing)
do not solve that world-parent relationship automatically. Existing X7 XML has
High geometry, with lower drawable LOD flags zero; preserved damaged LODs are
not an already implemented capability.

**S — Enhanced tooling and stale documentation.** Current Sollumz source
`e124bddf` supports native plus XML I/O and GEN8/GEN9 targets; optional
Windows-only PyMateria provides binary I/O. See [dependencies](https://github.com/Sollumz/Sollumz/blob/e124bddf7c0db12a61655aa98d23d0e7008b3b69/dependencies.py#L33),
[operators](https://github.com/Sollumz/Sollumz/blob/e124bddf7c0db12a61655aa98d23d0e7008b3b69/sollumz_operators.py#L62)
and [preferences](https://github.com/Sollumz/Sollumz/blob/e124bddf7c0db12a61655aa98d23d0e7008b3b69/sollumz_preferences.py#L56).
Older XML-only documentation is not current authority. Current
[fragment export source](https://github.com/Sollumz/Sollumz/blob/e124bddf7c0db12a61655aa98d23d0e7008b3b69/yft/yftexport.py#L77)
also includes damaged drawables/composites and glass paths despite older
unsupported-feature notes. Neither is necessary now.

The official [Enhanced conversion tutorial](https://docs.sollumz.org/tutorials/asset-conversion-for-gtav-enhanced)
requires CodeWalker dev48+ for its workflow. Public CodeWalker
[YFT save](https://github.com/dexyfex/CodeWalker/blob/485d56bec00262ed7fa472261cce7bbc6202b96e/CodeWalker.Core/GameFiles/FileTypes/YftFile.cs#L79)
uses GEN9 version171 and `EnsureGen9`; public source is not proof of the exact
distributed dev build. **I:** retain the repo's tested Blender5.2.2/Sollumz2.9
recipe and XML→CodeWalker conversion/pack receipts. Record actual tool hashes
on the later operator receipt. No tool upgrade is needed for X8.

**I — batch boundary.** Automate inventory/hashes, naming, known-family cuts,
bone/collision linkage, manifest generation, export checks and packing. Manually
approve topology, caps, cut layout, collision owner, material seams, LODs and
physical scale. A second family using data/recipe changes is the generalization
test; no evidence supports universal one-click city conversion.

## Collision ownership and lifetime decide eligibility

**S:** [collision documentation](https://docs.sollumz.org/documentation/collisions.ybn)
and the [interior collision workflow](https://docs.sollumz.org/tutorials/creating-interiors/collisions)
distinguish independently streamed collision resources/layers, including normal
and hi@ resources. A visual removal can leave player or weapon collision.
**G:** X4 clears this fence. **U:** generic Los Santos masonry/buildings.
Test both player sweeps and weapon/projectile hits; reject a candidate if any
relevant owner remains. Only a curated site justifies separate map/YBN patches.

Pinned SHVDN Enhanced `b5314686` [Entity](https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/blob/b5314686ab534d9cec8914625a0f5ab2dde528ea/source/scripting_v3/GTA/Entities/Entity.cs)
supports physical props/peds/vehicles. Its separate read-only
[Building wrapper](https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/blob/b5314686ab534d9cec8914625a0f5ab2dde528ea/source/scripting_v3/GTA/Entities/Building.cs)
does expose model/transform and existence; current X4Census already discovers
buildings. Discovery does not make them fragment Props or grant collision
removal. `IsPersistent` means mission lifetime, not disk saves. SHVDN scripts
share resource ownership, so script ownership alone is not per-mod deletion
authority. Preserve explicit owned-handle contexts and native parent attribution.
RAGE Plugin Hook's [IPersistable documentation](https://docs.ragepluginhook.net/html/T_Rage_IPersistable.htm)
likewise describes exemption from cleanup, not save serialization. Its old alpha
documentation is conceptual corroboration only; it is not Enhanced compatibility
evidence and does not justify moving this working SHVDN lab to another host.

CitizenFX native references below describe native interfaces; their comments
are **S**, not stock Enhanced gameplay proof or FiveM capabilities available to
SHVDN. [Model hide](https://github.com/citizenfx/natives/blob/3432156872baedaf18421bebb238f511468e6b0a/ENTITY/CreateModelHideExcludingScriptObjects.md)
is model+sphere scoped, excludes script objects and can survive map reload.
It is not an exact-instance hide or disk-save feature. The small .15m sphere
worked at the tested site; audit intersecting matching neighbors and witness them.
[Remove hide](https://github.com/citizenfx/natives/blob/3432156872baedaf18421bebb238f511468e6b0a/ENTITY/RemoveModelHide.md)
does not itself prove restored collision. Keep exact tuple, reacquire original,
check 9/9+visibility and preserve RestorePending on failure.

**I:** resource staging and retirement must be explicit. Bound admission using
object/collider pool headroom and owned counters, not distance alone. SHVDN
[World](https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/blob/b5314686ab534d9cec8914625a0f5ab2dde528ea/source/scripting_v3/GTA/World.cs)
exposes capacities; [NativeMemory](https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/blob/b5314686ab534d9cec8914625a0f5ab2dde528ea/source/core/NativeMemory.cs)
guards scripted detachment at collider capacity. This is a resource hazard, not
a calibrated natural-fracture budget. Begin with two layouts and existing
conservative admission guards. Cull only native-confirmed debris belonging to
an owned root, revalidated immediately before mutation. Delete no merely-new
nearby props; freeze/cull strategy performance remains unqualified by X3.

## Damage policy without a custom physics engine

**S/G:** `SET_DISABLE_FRAG_DAMAGE`, `SET_DISABLE_BREAKING` and
`SET_ENTITY_CAN_BE_DAMAGED` are object/entity scopes. Independent X7 props make
section-specific protection practical; a monolithic 30-child wall cannot be
assumed to offer the same per-child controls. Reuse `X7ActivateSelective` and
`X7SetDormantOne`, including `SET_ENTITY_COLLISION(..., true, true)`.
Do not substitute SHVDN's property setter blindly: its keepPhysics choice differs.

**I:** use small authored material presets (metal sheet, masonry, wood), not a
real-world energy model. The preset owns mesh/collision, mass, joint strength,
damage health/minimum force, transmission and accepted trigger classes. Initial
RPG policy is discrete: unprotect selected intact sections; native impact owns
separation and motion. No global weapons.meta/explosion.meta change is needed.
Bullets may produce only decals initially; hitscan first-hit transfer and
vehicle-contact timing need their own trigger tests. A callback after native
damage cannot be assumed to replay the original impulse correctly.

**U:** serial impacts. Keep surviving roots, union only confirmed broken section
IDs, and never respawn the whole layout to rearm. The selector must eventually
exclude already-broken candidates and avoid treating a shot through an old hole
as another wall hit. A residual blast can still act after a flag change; a fixed
safe timeout has not been measured. Test two spaced hits before promising widening.
[FIX_OBJECT_FRAGMENT](https://github.com/citizenfx/natives/blob/3432156872baedaf18421bebb238f511468e6b0a/OBJECT/FixObjectFragment.md)
repairs children; it would heal existing destruction. Opaque fragment-damage
health natives are not a supported persistence format.

## Minimum useful persistence

**I:** one small versioned JSON file per explicit named mod save slot. Record
catalog/asset revision, authored placement ID and a sorted monotonic broken-sheet
set. Save only after native-detachment attribution plus conservative collision
evidence confirms the result. Group count alone is not a damage bitmap. Keep
uncertain state flagged for reconciliation. An explicit slot selector is enough;
automatic GTA save-slot identification is not required initially.

Use temp+atomic replace and one previous valid backup. Store no handles, debris,
velocities, exact physics or health internals. Corruption/revision mismatch leaves
that placement disabled/logged until resolved, rather than applying a guessed
mask. This mod-world file is separate from P2 character memory; it does not
create another character store or physical action owner.

**S:** every sec1 root retains a rail; secp also retains an end post after its
sheet child breaks. **I:** extend the original recipe to generate two static
root-only remnant models. Replay intact sections as full YFTs and broken sections
as those remnants. Omitting an entire broken section loses the surviving frame;
respawning full intact YFTs heals the breach. Preload everything, suppress the
original only when reconstruction is ready, and apply no explosions or impulses.
Debris may disappear while holes persist. Far world LOD visuals still require a
bounded supported range or authored damaged LOD handling. Streaming reload and
process/save-slot reload are separate acceptance tests. No structural solver or
event-sourced database is needed.
