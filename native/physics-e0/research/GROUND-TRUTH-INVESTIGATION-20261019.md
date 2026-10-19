# E0 — GTA Enhanced material and geometry ground truth: investigation
**Date:** 2026-10-19  
**Scope:** research and design only; no GTA gameplay changes, no destructive systems, no main/PR #285 edits.  
**Source baseline:** PR #285 head `6f4a9fa0eb599ccc876b04749cbcd91588a21363`, correction evidence commit `636d271aead80d5b803f1b888a8fed35919ed62e`.  
**Overall verdict:** existing E0 observations establish raycast callability and partial material/thickness agreement; **zero catalog entries currently meet this report's CONFIRMED standard** because independent live collider identity and visual inspection are missing.

## 1. Sources and scope of inspection

Repository primary sources (links include line anchors where especially relevant):

- [E0 code: `native/physics-e0/Probes.cs`, Trace and material/wall measurement](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/6f4a9fa0eb599ccc876b04749cbcd91588a21363/native/physics-e0/Probes.cs#L598-L744); [teleport and collision gate](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/6f4a9fa0eb599ccc876b04749cbcd91588a21363/native/physics-e0/Probes.cs#L218-L420).
- [E0 sample settings, gate and Joaat policy: `Core.cs`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/6f4a9fa0eb599ccc876b04749cbcd91588a21363/native/physics-e0/Core.cs#L10-L185); [candidate-to-private lab conversion](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/6f4a9fa0eb599ccc876b04749cbcd91588a21363/native/physics-e0/asset-research/convert_codewalker_candidates.py#L18-L83).
- [Source extraction and archive/manifests](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/physics-e0-asset-extraction-20261019/native/physics-e0/asset-research/Extract-E0Assets.ps1); [primitive decoding, transforms, rank/selection](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/physics-e0-asset-extraction-20261019/native/physics-e0/asset-research/analyze_e0_assets.py); [standalone single-YBN ray verifier](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/physics-e0-asset-extraction-20261019/native/physics-e0/asset-research/Verify-E0Geometry.ps1#L16-L51); [extraction findings and limitations](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/physics-e0-asset-extraction-20261019/native/physics-e0/asset-research/README.md).
- [Initial launch/smoke](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/e0-smoke-20261019/native/physics-e0/evidence/2026-10-19-launch-blocker.md), [initial 40 live samples](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/e0-live-40-samples-20261019/native/physics-e0/evidence/2026-10-19-live-40/FINDINGS.md), [correction run, anomalous confirmations and provenance](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/e0-correction-verification-20261019/native/physics-e0/evidence/2026-10-19-correction/FINDINGS.md), [baseline comparison](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/e0-correction-verification-20261019/native/physics-e0/evidence/2026-10-19-correction/baseline-comparison.json), [correction manifest](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/tree/research/e0-correction-verification-20261019/native/physics-e0/evidence/2026-10-19-correction).
- Primary external format/natives documentation: [CodeWalker README (YBN/YMAP/YTYP and LOD)](https://github.com/dexyfex/CodeWalker/blob/master/README.md), [CodeWalker Bounds.cs](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/Resources/Bounds.cs), [shape-test trace/option flags](https://github.com/citizenfx/natives/blob/master/SHAPETEST/StartShapeTestLosProbe.md), [shape-test result contract](https://github.com/citizenfx/natives/blob/master/SHAPETEST/GetShapeTestResult.md), [camera activation](https://github.com/citizenfx/natives/blob/master/CAM/RenderScriptCams.md), [destination collision loaded native](https://github.com/citizenfx/natives/blob/master/ENTITY/HasCollisionLoadedAroundEntity.md).

These are evidence of the named source revisions, not permission to publish underlying Rockstar data. Research is limited by the private asset bundle's absence from this remote session; only sanitized findings and public tool source were available. Nothing here is a live new GTA observation. Existing `E0-ACCEPTANCE.md` begins with a stale "no GTA run" statement; the linked newer dated evidence supersedes that historical text.

## 2. Evidence audit: shown versus not shown

| Topic | Established | Still not established |
| --- | --- | --- |
| Extraction | CodeWalker 30_dev48 with Gen9=true decoded the bounded installed Enhanced dataset: 98 files including 17 YBN, 30 YMAP, 27 YTYP; 92/92 referenced archetype hashes resolved. | Complete live-world graph, embedded drawable/fragment bounds and exact runtime asset precedence. |
| Offline selection | 113/200 source-YBN surface proposals and 69/100 wall pairs matched; **30 surfaces / 10 walls** were selected from passing cases. 30 surfaces represent **12 indices**, not 30 distinct materials. | Object identities, visual semantics, access, active runtime materials, true architectural wall type. The chosen sample set is selected on a matching single-YBN ray, not randomized across the entire active scene. |
| Encoding | `GeometryCenter` and child `CompositeTransform` are applied; wall-like boxes decoded and cross-checked using CodeWalker nearest-hit methods. | All transforms for placed/MLO/embedded bounds, collision winding/face flags, margins, independently identified outer face. |
| Native calls | In corrected GTA Enhanced 1158.16 / RPH 1.132.1428.17748: E0.0/E0.1 read-only matrix calls completed, E0.2 all 30 rays completed, E0.3 all 10 wall pairs completed. | That a hit maps to the *intended* CodeWalker primitive or architectural object. |
| Materials | 28/30 hit and matched `joaat(materialName + '_' + index)`; 2 missed, none returned a wrong material on hit; bare-name hashes matched 0/30. | 30/30 coverage, complete or universal hash translation, identity of the two missed surfaces or whether they were intentionally filtered by shape-test flags. |
| Thickness | 10/10 paired forward/reverse hits; 8/10 measured thicknesses within diagnostic 0.01 m; other two disagree by +0.09509277515625 m and +0.25473022703125 m. | Both faces belonging to one primitive: anomalous pairs have distinct reported entity handles; wall 3 also changes material across faces. The 1 cm threshold was analytic, not pre-registered engine accuracy. |
| Inside-solid | All 10 midpoint-to-end casts completed with no hit, repeat across two primary runs. | Native ability to report exits when starting *inside* a solid, plus whether the chosen midpoint was inside the actual active collider. |
| Streaming | Corrected run verified 35 consecutive successful collision polls over 816 ms, safe navmesh destination and successful return (0 m native position error, 0° native heading error); independently documented earlier gate failures were fixed. | Per-asset streamed collider residency or active DLC/IPL winner. Stable streamed readiness is **not** a proof of correct asset selection. |
| Repeated checks | Baseline and corrected material/wall primary outcomes identical; delayed confirmations at ~506–520 ms preserved all four anomalies. | Alternate ray directions, option-flag perturbations, visual/object identity, mod A/B tests. |
| Reproducibility | Final CI artifact, hash receipts, sanitized JSONL and analyzer passed; no E0 exceptions reported. | Repeated sessions with unique runtime identity evidence and camera/overlay captures. |

### Important code-level finding: the default trace may intentionally omit desired surfaces

`Trace(a,b,flags=17,ignore=0)` calls `START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE` with **optionFlags=7** ([source](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/6f4a9fa0eb599ccc876b04749cbcd91588a21363/native/physics-e0/Probes.cs#L602-L615)). The documented [trace flags](https://github.com/citizenfx/natives/blob/master/SHAPETEST/StartShapeTestLosProbe.md) define 17 = world | objects; it omits the dedicated glass flag 64. The documented option bits define 7 = IgnoreGlass | IgnoreSeeThrough | IgnoreNoCollision. Thus **a candidate with glass/see-through collision characteristics may be excluded by the E0 query by design**. This is a leading, directly source-supported hypothesis for some misses and MUST be tested with controlled read-only flag variants before blaming coordinates or streaming. It is **not yet verified** that GTA Enhanced's synchronous native treats every such surface exactly like the documented general GTA flags, or that either specific missing sample is actually excluded for this reason.

Recommend a bounded comparative matrix on the **same unchanged rays**: (trace=17, option=7) baseline; (17,0); (17,4); (81,0); (81,4); optionally (511,0) with suitable single-player safe exclusion and performance bounds. Record every raw hit, position, normal, material, entity and the option combination. A hit under alternate flags tests filtering, **not** identity by itself. Maintain original baseline observations and keep new tests separate.

## 3. Four persistent anomaly groups: ranked hypotheses

Rank is investigative priority, not a measured likelihood. These are causal **hypotheses**, none established as root cause.

**A. Material samples #2 and #6 — both completed but no hit, including delayed repeat.**

1. **Query-category and option filtering (highest priority):** `Trace` filters glass, transparent/see-through and no-collision cases and does not request glass category. Target class may have one of those flags. Counterfactual: same source ray becomes a surface hit after read-only trace/option adjustment.
2. **Wrong source or layered active collision:** offline ray sees isolated source YBN but GTA streams a different patch/IPL/mod collider or does not load that primitive. Counterfactual: asset and mod/IPL inventory identifies a competing or excluded winner at the target.
3. **Surface sidedness, winding, ray approach or primitive footprint:** very thin/one-sided surfaces or transformed/interior geometry could fail from original direction; perturb normal and small position grid offline, then compare live.
4. **Insufficient per-primitive residency or coordinate precision:** weaker after 816 ms readiness and repeated misses; per-primitive loading is nevertheless not guaranteed by entity-level readiness.
5. **Hash naming mismatch alone:** low as explanation for a **miss** (no hit). Do not treat hash zero from a missed ray as evidence of a wrong mapped material.

**B. Wall #3 — reverse ray hits a different entity and a different material; measured 0.59771728515625 m vs 0.50262451 m source.**

1. **Two real colliders / overlapping or adjacent primitives along the ray:** highly supported by within-pair entity/material disagreement.
2. **Wrong active YBN/placement/IPL/DLC or embedded collision precedence:** source-YBN-only check cannot rule out competing loaded geometry.
3. **Ray crosses a beveled face, stacked trim or non-opposing geometry; reference "box thickness" was never actual wall thickness.**
4. **Float/margin effects alone:** less plausible for 9.5 cm *and* entity/material changes; retain as low-priority until site inspection.

**C. Wall #4 — reverse ray hits a different entity with same material; measured 0.75860595703125 m vs 0.50387573 m source.**

1. **Different but same-material colliders/overlap** (entity disagreement is direct evidence, even though material matches).
2. **Mismatched patch, source selection, YMAP transform or additional drawable bounds.**
3. **Ray intersects adjacent frame/post instead of the intended opposite face.**
4. **Precision/margin-only error:** low-priority for 25.5 cm mismatch.

**D. Inside-solid rays — 0/10 report an exit hit.**

1. **Native shape-test start-inside behavior / only boundary entry rather than exit reporting:** leading *mechanism hypothesis*, not a verified engine invariant.
2. **Actual midpoint not in the active collider**, particularly where multiple colliders replace the selected offline box.
3. **Backface/flags/collision category/sidedness** makes exit invisible to default flags.
4. **Wrong assumed normal or coordinate frame** for interior/embedded primitives.

Test control: cast in both directions from points **outside** each verified face, with known distance, then sweep the start position in/out along the normal; do not use "midpoint" tests as the only penetration exit estimator. Explicitly record hit states instead of converting a miss into a zero-thickness wall.

**Streaming repair does not explain the four anomalies alone:** they reproduced with verified ready polling and delayed retests. Also avoid interpreting different session-local entity integers across *runs* as identity changes; compare their equality only within a consistent run, and note that entity handle 0 or world/static aggregation does not establish primitive identity.

## 4. World-geometry model and identity resolution

### Required offline association graph

The current extraction captures bounded source files and references, but does not establish each candidate's complete current-world ownership. Build a private immutable graph:

1. **Archive revision -> resource:** exact RPF entry path, resource version, SHA-256 of decoded payload, SHA-256 of enclosing archive, base/patch/DLC/Onigiri/NVE/LA Roads variant and potential mount order. Do not label an archive "active" merely because it exists.
2. **YBN -> collision hierarchy:** bounds node path, CompositeTransform chain, local/world frame designation, geometry center, primitive index/type, vertex or box dimensions, material slot/index, surface collision flags, computed face/normal, broadphase AABB and competing primitive IDs.
3. **YMAP -> placement:** entity ordinal/hash, parent LOD, archetype hash, placement/rotation/scale, physicsDictionaries and optional IPL/MLO membership. *Static world YBNs already in world space must not receive a duplicate YMAP transform.* Placeable/MLO/embedded geometry must receive its actual transform composition.
4. **YTYP -> archetype and dependency:** identify asset type, drawable/fragment reference, collision relationship and origin; drawable mesh/texture is useful for sighting, **not** ground truth for collision.
5. **Interior and DLC:** MLO/entity transforms, portals/rooms, IPL activation, streamed interiors, patch and mods. A candidate is AMBIGUOUS if it depends on a winner not independently identified.
6. **Potential collision set:** query *all* candidate colliders at each world-space ray (base, patch, dependent placed bounds, overlapping props) using AABBs and then precise intersection. Emit sorted hits with distinct source IDs; mark non-unique matches and ties, never only first passing source-YBN hit.

Upstream CodeWalker [describes YTYP archetypes, YMAP placements, YBN bounds and an LOD hierarchy](https://github.com/dexyfex/CodeWalker/blob/master/README.md). Our [extractor](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/physics-e0-asset-extraction-20261019/native/physics-e0/asset-research/Extract-E0Assets.ps1) already collects `CEntityDefs`, parents and `physicsDictionaries`. But its archive manager excludes mod directories in the base scan, gathers overrides separately, and does not prove runtime mount precedence. The [verifier](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/research/physics-e0-asset-extraction-20261019/native/physics-e0/asset-research/Verify-E0Geometry.ps1#L16-L51) casts one YBN at a time. Those are the principal provenance gaps.

### Independent identity: evidence hierarchy

- **Resolvable script object:** completed live hit + nonzero valid dynamic entity handle; independently record entity type/model/transform where supported; reconcile against offline placement and candidate bounds. A matching handle alone is insufficient for a specific primitive within that model.
- **Static world (common case):** a native may return zero or a non-descriptive owner. Never invent `GET_COLLISION_PRIMITIVE_ID` or assume the runtime exposes a static YBN path. Identity must be triangulated from independently established active source/placement, unique offline competing-hit analysis, live position + normal + filter perturbations, and annotated viewpoint. If several colliders satisfy the same tolerances or runtime precedence is unknown, status remains AMBIGUOUS.
- **Useful negative controls:** nearby off-target ray that misses; lateral ± small offsets within a chosen face, and an outside-face opposite ray, plus selected flag alternatives. Distinguish a real face from an incidental nearby object. Preserve source ordinal and all candidates, including rejects.
- **Visual association:** screenshot and overlay show human-recognizable context, source label and hit marker but do not prove collision identity. CodeWalker source view may be added locally with copyright-safe private retention.

Never equate material hash equality with identity. Never equate equal dynamic handles with distinct per-triangle IDs. Never deduce that no entity handle means no collision.

## 5. Verified material catalog: design

See [`verified-material-catalog.schema.json`](./verified-material-catalog.schema.json). **The schema contains no sites, asset data or GTA-derived coordinates.** Actual catalog is a PRIVATE, outside-repository artifact; stable opaque sample IDs may be referenced publicly only if they do not leak the private dataset.

Each entry carries: immutable ID and lineage; material class, table provenance, source numeric index and expected native hash with derivation; source YBN path + decoded digest + bound path + polygon index + face identity + transform chain; candidate YMAP/YTYP/archetype/IPL provenance; private world target, safe player spawn, optional observation camera and look direction; planned ray(s), expected hit/normal/thickness; raw per-run live results and query flags; actual handle/type/model if resolvable; active mod/build/stream-state evidence; independent identity evidence; screenshot/overlay references; ordered attempts and three-valued final status (CONFIRMED, AMBIGUOUS, REJECTED). Do not overwrite an old attempt when refining a ray: create a new revision or child sample and maintain `supersedes`.

Prioritize **multiple physically and source-distinct sites** (suggest >=3 CONFIRMED per major material category before generalizing): concrete, brick, ordinary/bulletproof glass, wood/hollow wood, metal/hollow metal, chain link, doors and windows. Current 12 material indices in one block are insufficient for broad coverage; include other categories only when verifiable. "Wall" must require semantic inspection, not merely a thin dimension on a box primitive. Windows and doors may combine static frame plus independently spawned object and glass; model each as constituent colliders, not a single assumed slab.

### Status evidence gates

**CONFIRMED** (all required): a complete ray result on a safe streamed live session; independently supported *unique* source/object identity; active archive/IPL/mod and game-build provenance; expected hash agreement for the exact query flags; world hit within 0.02 m and expected normal within 10° where a face normal is meaningful; >=3 reproducible primary measurements including at least two independently launched game sessions; annotated, private in-game camera screenshot with readable overlay and matching run ID; an on-target and an adjacent off-target control; no unexplained overlapping candidate within tolerance. For a *thickness* entry additionally both external faces must independently map to one intended primitive or verified paired structure, with error <=0.01 m on all qualifying measurements and no unresolved competing collider. These are **proposed engineering gates**, not documented engine guarantees.

**AMBIGUOUS:** any missing independent identity, source-precedence proof, screenshot, repeated live evidence, expected category, uniquely disambiguating ray, or unproven streaming/flag behavior; conflicting yet interpretable results; invisible collision of unknown source; visible art with no independently characterized collision. This includes all current 30+10 as catalog candidates unless new evidence is collected. Raw live calls can be marked OBSERVED without promoting catalog status.

**REJECTED:** repeatable contradiction after documented streaming and flag controls (wrong active object/material, inaccessible/absent expected collision, invalid source transform, failed thickness bound or non-unique face that cannot be disambiguated) with retained contradictory logs and reason. Rejection is about the *catalog candidate's claimed identity*, not a declaration that a material never exists in GTA.

**Visible but non-colliding:** record visible mesh provenance and a carefully bounded set of failed rays/flags. It can be a valid non-collision negative control but not a confirmed penetrable wall until identity/collision is independently shown. **Collision but invisible:** record positive raw hits and competing-hit analysis; keep AMBIGUOUS until classified (e.g., invisible gameplay blocker, interior boundary or disabled/hidden model). Do not silently substitute prettier targets.

## 6. Automated visual / native inspection architecture

**Safe orchestrator (separate opt-in E0 diagnostic mode, not an LSA gameplay integration):**

`PRIVATE CATALOG -> preflight/safety -> safe teleport -> navmesh + collision settling -> source-aware camera framing -> overlay -> bounded read-only ray matrix -> external screenshot handshake -> restore state -> PRIVATE structured evidence -> offline auditor`

1. Validate offline catalog, sample hashes, stable IDs, ray lengths, safe teleports and game/mod profile; refuse online, mission, cutscene, invalid player handle or unauthorized source variant.
2. Preserve position, heading, current camera/focus/FOV as actually accessible, selected state and prior loaded area; use existing safe pavement/navmesh selection and strict destination collision gate; abort rather than drop the player on target geometry.
3. Use in-game CAM natives (`CREATE_CAM` / `SET_CAM_COORD` / `POINT_CAM_AT_COORD` / `RENDER_SCRIPT_CAMS`), test compatibility with current RPH runtime, and carefully restore prior script-camera ownership. Do not disrupt other mods' cameras; if an existing scripted camera is not safely restorable, switch to read-only overlay/manual viewpoint.
4. Render `DRAW_LINE`, `DRAW_MARKER` and optional normals/face labels every frame at the intended target. Use near/mid/far views, readable unique sample ID, measured and expected position, run ID and query flags. Overlay rendering is a visualization, not geometric proof.
5. Execute bounded, read-only variants of `START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE` + `GET_SHAPE_TEST_RESULT_INCLUDING_MATERIAL`; record state 2 requirement, hit/normal/point/hash, entity handle, all flags and time/destination readiness. If entity handle valid, get model/type and world transform; classify unresolved world geometry explicitly.
6. Screenshots require a **separately verified capture mechanism** (Windows desktop/OBS capture, or separately tested screenshot API). Base GTA/RPH CAM and DRAW natives are not a demonstrated file screenshot API. Use a run-ID/filename acknowledgment protocol with timeout; mark screenshot MISSING on failure instead of inventing it. Keep screenshots local and private.
7. Restore camera/render/focus, player position/heading and collision; release owned navmesh region and freeze, preserve existing non-owned world state. On failure, stop further samples and require manual recovery.
8. Emit append-only private `catalog-observations.jsonl`, `manifest.json`, screenshot hashes and a report with FAILED/AMBIGUOUS cases preserved. Public export is strictly field-allowlisted and sanitized.

**Headless:** archive analysis, schema validation, ray/geometry matching and scoring work without GTA. RPH/game natives, live streaming, visual camera and ground-truth screenshots **require GTA running and advancing frames**. It can be **semi-automated** after owner launches GTA in interactive single-player: queue every safe test unattended but freeze/abort on focus/pause, native timeout, screen capture failures and unsafe state. No assertion of truly headless live-world simulation. Never attempt unattended vehicle driving, firing or destruction.

### Operations / feasibility matrix

| Operation | RPH/natives plausible | External/manual requirement |
| --- | --- | --- |
| Read-only traces and shapes, hit flags, materials, dynamic entity model (when valid) | Yes, existing E0 proof for rays; extra model metadata requires new live test | Independent source cross-check |
| Safe navmesh/collision transport and recovery | Yes, corrected E0 proof for tested environment | Owner launches single-player and maintains render loop |
| Camera + in-world overlay | Documented natives, **not yet verified in this E0 build** | Visual acceptance and UI/camera ownership testing |
| Native screenshot to a file | Not established | OBS/Windows capture or a separately verified capture bridge |
| Static collider's original YBN/primitive filename direct from native handle | **Not established and must not be promised** | CodeWalker + mod manifests + independent correlation |
| True active IPL/DLC/mod selection | Some queryable native IPL state; incomplete for all asset loaders | Private installation manifest and optional safe manual A/B |
| No-GTA candidate discovery and selection | No live natives needed | Local asset extraction / offline Python/CodeWalker |

## 7. Acceptance criteria and method

Pre-register thresholds; never choose them after seeing failures.

- **Material:** state=2 and hit=true, raw indexed expected hash exactly equals raw native hash for a specific flagged query; other variants kept separate. A filtered-out material is AMBIGUOUS until option-flags control resolves it.
- **Physical position:** actual vs offline expected entry <=0.02 m; expected normal angle <=10° after documented winding/face orientation correction, else AMBIGUOUS or REJECTED after repeats. Source identity proof is required even if geometric values match.
- **Thickness:** two *external* face intersections, independently assigned to the same primitive/verified structure, within 0.01 m of the decoded thickness. Opposing handle mismatch is a hard stop to single-object CONFIRMED; two zeros or equal handles do **not** prove same primitive. Document non-planar/compound geometry separately.
- **Streaming:** >=800 ms continuous successful polled collision state and >=3 polls (existing validated E0 gate) + destination within private site safe bounds + valid story mode; additionally record per-target ray readiness, camera visible/loaded state and retry after delay. Gate alone never proves source identity.
- **Mod/IPL:** exact game build, mod-loader DLL fingerprints, mod manifest/mount order and active IPL evidence where queryable; absent active precedence leaves identity AMBIGUOUS. Optional controlled A/B only with explicit owner consent; no default IPL changes.
- **Repetition:** >=3 primary reads in >=2 independently launched sessions, stable source hash/flags, no unaccounted shifts, plus small negative control rays. Record every miss, exceptions, non-completion, and all retries as attempts.
- **Screenshot:** at least context and close-up readable views with target marker/normal, run ID and camera pose; hash files and cross-reference ray evidence. Pixel image alone is not identity proof.
- **Transport:** destination and return verified; aim for return within 0.05 m and 1° native reporting; timeout/mismatch aborts subsequent sites and reports BLOCKED/RESTORE_FAILED. A completed run without return evidence is not unattended-safe acceptance.

## 8. Local prerequisites, privacy and limits

**Already available in sources:** latest lab artifact and installer; corrected transport gate, safe unattended pre-shot runner, private sample conversion utility; CodeWalker extraction scripts, CodeWalker dev48 on owner machine, installed Enhanced 1158.16/RPH 1.132, private 30+10 dataset reported in local workspace. Asset files and private schema inputs were NOT fetched to this remote investigation.

**Still needed locally:** owner launches GTA Enhanced **single-player** under unrestricted interactive RPH; verify current artifact receipt; keep local CodeWalker executable/private archives and extracted YBN/YMAP/YTYP; baseline and mod-profile fingerprints for Onigiri/NVE/LA Roads; verify visual scene and stable render/focus; choose safe camera viewpoints; choose and validate actual screenshot capture tool; add private per-site semantic labels and competing source/placement hypotheses. For the two misses first test an opt-in safe filter matrix on unchanged original rays. For two walls do independent candidate collider analysis and external dual-face rays. No manual teleport to unverified wall coordinates.

**Never publish:** Rockstar resource binaries, XML exports, derived meshes/vertex arrays, original material tables, entire private manifests, local sample coordinates/rays, proprietary screenshot captures, local installation paths revealing identity, raw logs that contain private coordinates or tokens, or archive ZIPs. GitHub branches in this public repo are public. Commit code, schema and sanitized aggregate tests only. Use deny-by-default export and verify a diff/file-pattern guard before push.

## 9. Recommended implementation

Start **GT0: remote-only source graph + schema/validator + collision-filter experiment specification**, not new wall sampling and not destruction. Its acceptance: offline tests demonstrate correct transform selection and collision winner/tie reporting; schema requires explicit provenance and missing fields remain null; no leaked private coordinates; unchanged E0 baseline retained; new flag variants predeclared with per-ray comparisons; no game binary, DLL deployment or runtime modification. See [roadmap](./IMPLEMENTATION-ROADMAP-20261019.md) for GT1–GT4 local gates. GT0 should be proposed as an independent PR later, only after research approval.

**Research conclusion:** measured agreement is promising and indicates CodeWalker plus GTA natives are useful together. It is **not** yet authoritative physical ground truth. Resolve intentionally ignored ray categories and source/primitive identity before any penetration or destructible-world architecture depends on it.
