# LSA Destruction Lab — X8 deterministic map-entity test scene

**Status:** cloud-side authoring prototype, based on draft X8 PR #309; **NOT
installed, converted or accepted in GTA**. No known safe coordinates are
embedded. Separate draft PR; X7.3/X8 physics and the P2 protocol are unchanged.

## Why this exists

The October 22 X8 preflight stopped with 3/18 ambiguous approach-collision
rays at world fence A. Testing the mechanics at arbitrary urban fences mixes
destruction bugs with environment/streaming/terrain bugs. Instead build two
**real CMapData/YMAP map entities**, using Rockstar's **unchanged**
`prop_fnccorgm_02e` archetype, on a locally qualified empty level surface.
They are not SHVDN CreateObject/script-owned props. This preserves the
map-hide vs. script-exclusion distinction of our X7.3 replacement path.

The map contains exactly two upright, unit-scale original fences, A/B,
**30 meters apart**, oriented **90° apart**. No floor, custom physics,
duplicate model, new YTYP, trainer, traffic modifications or YBN. Ground and
nearby environment remain vanilla/NVE and MUST be audited locally. We
intentionally don't use off-map coordinates before proving a solid ground plane.

## Cloud / offline workflow

Python 3.9+ with no third-party dependencies:

~~~sh
python -m unittest discover -s native/destruction-lab/tests -p 'test_*.py' -v

# Deterministic synthetic coordinates, marked NOT_DEPLOYABLE:
python native/destruction-lab/generate_lab.py --fixture --output /tmp/x8-lab-fixture

# This MUST fail until a real GTA site is chosen by the local operator:
python native/destruction-lab/generate_lab.py \
  --site native/destruction-lab/site.template.json --output /tmp/x8-lab
~~~

For a real candidate, the local operator copies site.template.json to an
untracked site.json, fills actual *native-verified* x,y,z of the **map-object
pivot at the chosen ground** (not player-ped pelvis Z), heading, sets
surveyed=true and provides a short evidence identifier. That input is
**operator-attested, not game-verified by this Python script**:

~~~sh
python native/destruction-lab/generate_lab.py \
  --site /LOCAL/PRIVATE/site.json --output /LOCAL/PRIVATE/lab-build
~~~

Generated files:

- `lsa_destruction_lab.ymap.xml` — genuine CodeWalker CMapData XML with 2
  CEntityDefs; no manually spawned entities.
- `placements.json` — absolute pivot/yaw, model hashes, QA requirements and
  stable SHA-256 of the XML. Classification stays `PROPOSED_UNVERIFIED_IN_GTA`.
- `p2-operator-commands.txt` — **review-only**, registration and audit
  command suggestions. It does not contain a shot, prepare or auto-restore.
- `NOT_DEPLOYABLE.txt` — only with --fixture, forbids deploying synthetic
  coordinates. Do not use fixtures to qualify a real location.

The generator refuses empty/unattested site data, non-finite numbers, outside
conservative coordinate limits, unsafe evidence fields, bad yaw, and
insufficient lane separation. Each run emits byte-identical XML and manifests.

## Local Codex / P2 handoff (not authorized by this PR)

1. With normal, **unmodified GTA Enhanced** and the user's existing map stack,
   survey a genuinely flat, empty site large enough for two 30m-apart lanes,
   approach shots, and on-foot traversal. Prefer a secluded existing paved
   surface. Verify world collision and grade at *both future fence pivots*;
   inspect surrounding YMAP/YBN/props, road/traffic path and DLC overrides.
   If either pivot has different terrain Z, **reject the site** rather than
   pretending one flat base Z fits. Record actual survey coordinates and
   provenance privately. Do not reuse October 22 failed A/B coordinates.
2. Generate source XML with site.json. With GTA stopped, the optional
   **experimental offline pack builder** can convert XML using the installed
   CodeWalker assemblies and produce `dlc.rpf` in a **fresh output folder**:

   ~~~powershell
   powershell -NoProfile -File native/destruction-lab/pack_lab.ps1 `
     -CodeWalker 'C:\\Path\\To\\CodeWalker30_dev48' `
     -BuildDir 'C:\\Private\\lab-build' `
     -OutputDir 'C:\\Private\\lab-pack' -ConfirmedLocalSurvey
   ~~~

   It never installs or edits the game. The local operator must independently
   **reload the binary `.ymap` in CodeWalker**, verify both entities, and
   compare the DLC's `content.xml`/`setup2.xml` mounting to a known-working
   **GTA Enhanced** map DLC before proceeding. The pack script is untested
   against local CodeWalker binaries; manual CodeWalker conversion is the
   fallback. This is not a FiveM resource:
   **never** install fxmanifest.lua or use a FiveM server workflow.
3. Package the verified binary as a separate
   `lsa_destruction_lab/dlc.rpf` map DLC via the proven Onigiri/Game Enhanced
   approach; first inspect a known-working local map DLC for metadata and
   mounting, because Enhanced packaging was **not** verified in cloud CI.
   Keep all lab paths separate from `lsa_fence_x7d`. Stop the game,
   hash-backup every changed file before install and create an exact rollback
   receipt. Do not patch Rockstar or NVE archives directly.
4. Start one owned P2 session per
   [GTA controller runbook](../../docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md).
   Verify **both objects are truly streamed map entities** (`prop_fnccorgm_02e`),
   at exactly those pivots and intended native headings with **unit/upright**
   basis. If not, reject: no hidden fallback spawn. Qualify 9/9 source
   collision, **0/9 dormant twin**, 18 unobstructed approach rays, ground grade
   and physical player path. The generated registration suggestions are only
   safe after checking real runtime values; X8's verified=1 token does
   **not** verify the site by itself.
5. With user authorization after qualification, run existing X8 sequential
   prepare / single RPG / automatic section selection / physical walk /
   real 9/9 restore on A, then on differently oriented B. Max **one physical
   lease** at a time; B must remain unaffected during A. Check actual native
   object deletion, no debris/hidden original, nearby sentinels intact.
   Do not change damage profile, fire synthetic explosions, force traversal,
   relax native collision gates or begin X9.
6. If A is unsuitable, record it and select a better *site* before testing;
   a site failure does not automatically invalidate X8 fracture. If collision
   ownership is unknown, **no RPG** at that fence. A failed restoration is
   a stop for destructive testing and #308 remains its own issue. Before
   leaving, stop GTA, hash-restore all installed files and release P2.

## Design boundaries

- Source XML is a layout and serializer, **not binary GEN9 validation**.
- One origin Z requires flat ground; no self-authored floor/YBN/navmesh.
- The engine may treat an add-on YMAP differently from vanilla map-scene
  variants; the X7.3 map-hide behavior must be verified, not assumed.
- X8 still only supports **sequential**, not concurrent prepared fences.
- Native RPG fracture, exact pair selection, traversal and post-shot
  restoration **have not yet been measured** in this lab.
- No automatic game install, automatic site selection or PC access occurs.
