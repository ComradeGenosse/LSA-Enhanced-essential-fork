# E0 ground-truth program — implementation roadmap (proposal only)
**2026-10-19.** This document is a future-work plan, not authority to change `main`, PR #285, LSA gameplay, any game files, IPL state, or to implement destruction.

## Decision / recommended first implementation phase

**First phase: GT0 — offline provenance and ray-policy diagnostic harness.** One focused, research-only PR (future separate authorization); no GTA runtime required and no changes to the existing `Trace` function. Produce a private-catalog validator, a complete active-source candidate graph specification, pre-registered trace-filter comparison plans and deterministic offline unit tests. Do not deploy new DLLs, move the player, shoot or modify buildings. The already-known `flags=17` / `optionFlags=7` omission should be investigated first using a **planned**, non-destructive future runtime experiment, not retroactively "corrected" by rewriting baseline readings.

**GT0 scope:** 
- Parse and validate PRIVATE catalogs against [`verified-material-catalog.schema.json`](./verified-material-catalog.schema.json); reject unbounded arrays/rays and nonfinite locations, path traversal and sample-ID collisions. Verify append-only observations and no status promotion from a hash match alone.
- Offline full-scene *candidate* collision index: merge source YBN hierarchy, YMAP physicsDictionary, archetypes, embedded/placed candidate bounds and base/patch/DLC/mod *variants*, with explicit unknown winner. Preserve original single-YBN results as immutable baseline and output nearest competing hits. Missing assets -> an explicit incomplete coverage warning; no inferred active winner.
- Ray matrix planner for original anomalies: preserve baseline (trace=17, options=7), predeclare 17/0, 17/4, 81/0, 81/4 and cautiously optional 511/0. Keep original ray geometry private and unchanged; do not run native calls in GT0.
- Stable parent/child sample revisions for new offsets or camera viewpoints, with test-time sample IDs. No silent deletion of rejected/ambiguous candidates.
- A deny-by-default public evidence exporter: report only aggregate counts, codes, anonymized sample ordinal and hashes of run artifacts; FAIL if private XYZ arrays, Rockstar XML/YBN content, local user paths, complete material tables, screenshots or secrets would be included. Scrubbing JSONL field-by-field is preferable to regex-only stripping.
- Validate offline tooling with synthetic *internal test fixtures* rather than Rockstar or realistic in-world coordinate claims. All fixture data synthetic and visibly tagged.

### GT0 acceptance gate (all pass)
1. The candidate builder reports ALL plausible hit colliders in priority order, with deterministic tie/overlap markers. A standalone-YBN-only test must visibly flag "INCOMPLETE_WORLD_SOURCE_SET".
2. Synthetic transform tests cover local/world YBN distinction, nested transforms, YMAP rotation/scale, opposite faces, AABB pruning, skew-box rejection, material slots and overlapping dual colliders.
3. Status invariants: missing active source, missing identity or missing live visual results cannot yield CONFIRMED, even with a matching hash and 1 cm thickness.
4. Parser rejects invalid sample IDs, nonfinite values, missing hashes, impossible rays, duplicate observations, undocumented baseline changes and private exports.
5. Existing baseline CSV and correction evidence remain byte-for-byte unchanged. The two material misses, two wall mismatches and all ten inside-solid misses remain explicitly present in its regression test plan.
6. Repository diff contains only safe source/tests/docs/examples without GTA-derived coordinates or assets. CI passes with no locally installed game.
7. Gate is reviewed before any live-feature PR is proposed.

## Phases and hard boundaries

| Phase | Mode | Deliverables | Acceptance gate | Requires local GTA? |
| --- | --- | --- | --- | --- |
| **GT0** — remote provenance/spec (FIRST) | Remote | Catalog schema validator, candidate-scene index with competing sources, safe public export, filter-matrix plan, synthetic regression suite | Seven gates above; no live claims; no binary artifacts | No |
| **GT1** — install/source fingerprint verification | Local extraction + remote analysis | Private manifest of active installation hashes, Onigiri/NVE/LA Roads mount candidates, IPL state log, candidate-owner ranking, alternative collider lists | Source completeness explicitly scoped; every candidate tagged WINNER_PROVEN or UNKNOWN; no assumption that visible mesh = collision | No game for extraction; runtime state requires GTA |
| **GT2** — focused non-destructive native diagnostics | Local GTA + isolated E0 lab; separate approved PR | Bounded flags/option matrix on unchanged anomalous rays, completion/hit/normal/material/entity results; external face offset controls; 2+ game sessions | Quantify whether filtering explains misses; preserve all initial observations; strict rollback, safe streaming and no unintended natives | Yes |
| **GT3** — visual camera + screenshot evidence | Local GTA + external capture handshake; separate approved PR | Camera framing, on-screen ray/normal markers, paired context/close-up screenshot hashes, optional CodeWalker private review views | No unexplained camera ownership collision; player/camera restoration; screenshot/run-ID equality; timeout never passes | Yes |
| **GT4** — catalog qualification | Offline review + local rechecks | CONFIRMED/AMBIGUOUS/REJECTED catalog, per-sample identity chains, resolved anomalies or explicit blockers, multisite class coverage | >=3 observations across >=2 independent GTA sessions, independent unique source match, hit/normal/tolerance and private visual proof for CONFIRMED | Yes |
| **GT5** — downstream handoff (future decision) | Research | Stable physical-test contract for E1 ballistics and destructibility experiments | No feature proceeds with ambiguous source, identity or geometry unless explicitly treated as a negative/unknown control | No new runtime work until separately approved |

## Ownership and work isolation

**Remote agent responsibilities (can proceed without owner's PC):**
- Review public repo evidence and relevant upstream formats/natives.
- Design JSON schema, offline validator, geometry index, score/identity/tie logic, query matrix, QA suites and acceptance gate.
- Identify missing sources explicitly; do not fabricate active IPL/mod precedence or runtime measurements.
- Commit safe code/docs to an approved separate feature branch/PR **only in a subsequent implementation task**, not as part of this investigation.

**Local agent responsibilities (owner's actual GTA machine):**
- Access licensed installed game resources and CodeWalker generated private staging; keep outputs outside the public repository.
- Gather full YBN/YMAP/YTYP/embedded candidates and actual mod manifest/profile; establish whether NVE and LA Roads collision replacements exist and are mounted (names alone do not prove collision replacement).
- Maintain original CodeWalker candidate lineage; map any changed active source separately from expected data.
- Launch story-mode GTA through known-good unrestricted RPH interactive flow, permit frames to advance (do not presume minimized/alt-tab state will process every game fiber).
- When separately implemented/approved, let the guarded E0 diagnostic suite teleport to privately recorded safe *pavement*, load navigation and collision, frame camera and overlay, execute read-only checks, capture screenshots by verified external tool and restore player/camera.
- Keep screenshots, entity traces, raw spatial logs, material tables and game/mod files local; publish only safe aggregate summary.

**Single source of authority:** private immutable catalog and append-only runs with asset provenance. Public Git is *not* a suitable store for the private references. GitHub branches are not a confidentiality boundary.

## GT2 safe runtime inspector: proposed state machine

`DISABLED -> OWNER_OPT_IN -> WAIT_SAFE_SINGLEPLAYER -> VALIDATE_PRIVATE_SITE -> REQUEST_NAVMESH -> PICK_SAFE_PAVEMENT -> RELOCATE/FREEZE -> WAIT_COLLISION_STABLE -> SET_CAMERA_OR_MANUAL_VIEW -> DRAW_OVERLAY -> CAST_BOUNDED_RAYS -> CAPTURE_HANDSHAKE -> RETURN_POSITION/CAMERA -> VERIFY_RETURN_COLLISION -> DONE/FAILED`

**Per-sample stop conditions:** no navmesh; no safe pavement; collision timeouts; Online/mission/cutscene/teleport identity change; result state not completed; invalid game handle; unexpectedly active scripted camera that cannot be restored; invisible/ambiguous target; screenshot acknowledgement missing; original player return mismatch; ownership conflict. Record failure and stop without changing E0 acceptance.

- Reuse proven GT pre-shot transport gate: >=800 ms continuous successful collision polling with >=3 successful observations. Note: this only confirms the player-area collision state, not the referenced primitive.
- The owner must launch GTA interactively; RPH cannot be made a true headless geometry oracle by invoking CI. Unattended per-site work is **conditional on safe game state and frame advancement**.
- Every runtime mutation must be bounded and reversible: player/camera/focus only; read-only ray calls, no bullet/explosion, entity creation, IPL changes, world-model hiding or slow motion.
- Retain old baseline observations. GT2 creates new experiment IDs and result rows. Never classify a new flag-induced hit as the original baseline passing.

## Candidate discovery and matching algorithm (GT0/GT1)

1. Verify hashes and parse installed candidate archive entries, DLC and mod alternatives into versioned source graph. Do not select active winner from filename similarity alone.
2. Resolve coordinates without double-transform: base world-space YBN source as-is; relative/placed YMAP archetypes and MLO collision get explicit transform chains. Reject unknown frame/transform.
3. For each face/box, compute private world-space bounding region, local normal, material index and primitive ID from asset digest+bound path+polygon/face. Do not assume box thickness means architectural wall.
4. For each planned ray, filter broadphase candidate bounds, then perform nearest-hit collision computation for every plausible variant. Emit sorted hit list, geometric ties, source coverage count and why candidates were excluded.
5. Report whether selected source primitive is unique at hit position/normal. If two possible colliders are within 0.02 m and 10 degrees with unresolved active precedence, result is AMBIGUOUS even if their material hashes match.
6. Attach semantic object category from human CodeWalker/visual inspection, not from material/geometry alone.
7. Plan negative controls on adjacent space (and safe offsets) to distinguish overlapping world faces; auto-generated offsets are proposals until verified against local surroundings.

## GT2 experiment design: four anomaly families

**Material #2/#6:**
- Compare baseline flags 17/option7 to 17/0, 17/4, 81/0, 81/4 while keeping identical start/end; record native completion, hit and first-hit changes. Use near/offset probes and independent visibility at same camera target. A hit under 81/0 with same geometry is evidence for query filtering, not final object identity.
- Check original source region vs all candidate loaded YBN/placed bounds with selected IPL/mod evidence. If every variant misses, classify candidate as AMBIGUOUS (or REJECTED after full proof of absence). Do not replace sample silently.

**Wall #3/#4:**
- Reconstruct the full ordered collider intersections for each exterior ray, including different handles/materials and possible nearby frames. Inspect the exact intended object from context and close-up views.
- Try short external face rays at independently modeled locations and offsets, and measure each face against its intended source primitive. Do not measure between faces belonging to two different colliders and call the result one wall.
- Preserve original errors (+0.09509277515625 m and +0.25473022703125 m) and source box dimensions; don't change references to get below tolerance.

**Inside-solid 0/10:**
- Compare start-outside vs just-inside vs midpoint; cast outward and reverse, vary filters. Distinguish "does not report start-inside exit" from "reference box is not the active collider."
- If native ray returns no exit, treat dual **external** face sampling as the thickness technique; record start-inside failure as a first-class limitation/negative control.

## Quantified completion targets (proposed, not past results)

- For each material category we eventually trust, >=3 independently source-distinct **CONFIRMED** sites (not all three on one object), or explicit documented coverage shortfall.
- Individual CONFIRMED samples: >=3 complete measurements across >=2 interactive GTA launches; exact expected raw native material hash, <=0.02 m hit-position deviation, <=10° normal deviation (with independently checked winding), identifiable active source and no unresolved overlap.
- CONFIRMED simple solid: outside-face pair proven to one collider, <=0.01 m thickness deviation across accepted repeats; forward and reverse handles must not contradict. Zero/identical handle alone does not prove one primitive.
- For the persistent anomalies, produce a test differentiating top-ranked hypotheses. No blanket pass target of 30/30 is valid if it is achieved by discarding exceptions.
- Collision readiness and return: successful bounded nav/collision gates, no unhandled native exceptions, <=0.05 m positional and <=1° heading return error as reported by natives. Camera ownership and focus returned without disturbing existing LSA cameras.
- Every screenshot: locally hashed, marked with run/sample ID, enough context to identify visible object and close-up surface; no screenshot means no CONFIRMED.
- If an invisible collider or visible collision-less mesh occurs, keep explicit observation records. Status remains AMBIGUOUS unless a negative-control classification is independently verified.

## Required local prerequisites before GT2/GT3

- Genuine game + RPH setup: documented GTA Enhanced 1158.16 and RPH 1.132.1428.17748, with versions re-read if changed; verified lab artifact DLL receipt, no backup DLL in Plugins.
- Working CodeWalker Enhanced/Gen9 dev48 and private extracted asset ZIP or staging directory; 30+10 baseline samples with immutable hash and the complete rejected candidate pool.
- Private inventory of active Onigiri loader, NVE and LA Roads packages, mod mount order candidates, original and DLC/patch archives; active IPL evidence when accessible. Never upload archive files or full manifests.
- Attended initial console setup and safe story-mode player spawn; an interactive desktop session where GTA continues receiving frames.
- Chosen safe camera viewpoints, screenshot tool (OBS/desktop capture or separately tested equivalent), storage directory and screenshot handshake. RPH does not have a proven built-in PNG capture contract from current evidence.
- Controlled fail-safe to restore player/camera on abort and owner-manual recovery instructions for a crash; separate sample/run IDs and enough local disk space.
- Approval for each future code/installer deployment. No need to give remote research agent licensed Rockstar resources.

## Protecting privacy and publication

- Add `PRIVATE_LOCAL_ONLY` prefix metadata to all raw catalogs. Preserve original absolute installation paths only locally.
- Public docs may cite branch evidence but must not include full GTA sample location/ray coordinates, embedded proprietary material tables, proprietary meshes/bounds, XML, asset ZIPs or full visual scene captures.
- Treat sanitized public evidence in old research branches as read-only. Report any accidentally public sensitive fields separately rather than copying them.
- Future CI uses synthetic fixtures and source-code formatting/tests. Running CI neither launches GTA nor validates any real collider.
- No mod/IPL toggling, collision replacement, shoot test or world destruction within GT0–GT4.

## End state / decision gate

The downstream E1 bullet penetration experiment can rely only on (a) individual CONFIRMED catalog entries with distinct material/body geometry and (b) explicitly labeled AMBIGUOUS/REJECTED negative controls. If the active source or actual hit primitive cannot be established, do not treat it as truth, even if material and distance happen to match. This is the principal acceptance requirement for dependable destruction research.
