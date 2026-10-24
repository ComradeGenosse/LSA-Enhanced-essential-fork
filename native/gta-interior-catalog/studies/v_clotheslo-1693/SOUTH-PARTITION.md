# X9 south glazed façade — cloud implementation / local replay handoff

Local continuation: [SOUTH-VALIDATION.md](SOUTH-VALIDATION.md) records the completed
actual Windows replay and strict mutation audit. The cloud-only/NOT RUN status
below is retained as the original #323 handoff, not the current replay verdict.

**Stage:** OFFLINE SOURCE ONLY, NOT GTA/deployment acceptance.
**Parent:** draft PR #322 head `07793c3788dbdeefbf9369d2904b95a5e52df416`.
**Bounded objective:** in-memory subtraction and preservation oracle for the alternative *south glazed* aperture at `v_clotheslo`. Do not revive the north wall or imply masonry behavior.

## Exact pinned target

- World center `(1689.965958, 4815.771294, 42.293717)`; 1.50 m wide × 2.30 m high.
- MLO-local cut prism: `X [6.95, 7.65], Y [-5.25, -3.75], Z [0.26, 2.56]`.
- Four world corners, floor/sill probes and player aisle are in #322's `REPLAY-AND-ALTERNATIVES.md` and `alternative-evidence.json`.
- **Only profile admitted by the oracle:** offline `base-hipster`. This is an explicitly selected archive/optional-set scenario, **not evidence of the actual loaded game profile**.

## Authorizations and invariants

`south_partition.py` reuses the existing triangle/convex-solid cut oracle but supplies the south bounds explicitly; old north defaults remain unchanged. It reads the entire **pinned #322 alternative-evidence JSON Git blob** and requires the reviewed private primary and entity-set SHA-256 digests. A changed evidence file or changed private extraction **fails closed**.

The approved 13 source-owner groups are: base `v_51_windows03` geometries 0–4, base `v_51_reflectproxy`, `cs2_01_shop_dec2` geometries 3/4, two named MLO/near LOD owners (`1814693341` and `cs2_01_clotheslow_slod`), interior `v_clotheslo.ybn` root/0 **box 98** and normal world `cs2_01_5.ybn` root/0 **box 209**. Exact authorized primitive IDs and full owner/file/instance/model/geometry/material are taken from the immutable #322 evidence and matched against every real source record.

**Protected:** all other source records, weed triangles, sill, floor, counter, displays, unrelated collision, other YDD entries and other shop instances. Protected weed intersections are recorded, not deleted. New unexplained geometry intersecting the aperture or an unavailable reviewed source ID is a **hard error**.

- No high-YBN cut is authorized: #322 found no actual high-polygon intersection in this section; root-bounds alone do not justify cutting one.
- The cheap optional set's `v_51_posters` intersect this exact aperture; `base-cheap` is **blocked**, not cosmetically ignored.
- NVE's 56/96 differing primary definitions are not remapped or certified by the base adapter. `nve-hipster` and `nve-cheap` both fail; separately recompute actual NVE transforms before reconsidering.
- Existing room-1 ↔ limbo portal 2 spans the opening in metadata; culling/visibility still requires independent proof.
- The sampled ~0.125 m exterior-to-sill step and player-sized landing/aisle are prior offline evidence, not actual in-game walkability.

## CI and reproducible replay

The existing X9 catalog workflow compiles Python and runs the full `test_*.py` study suite, including seven new south-specific tests for pinned evidence, profile gating, owner identity, distinct north/south bounds, convex volume, protected weeds/counter/sill, mutations and fail-closed obstructions. **CI does not have the private asset arrays** and must not claim to have executed the real replay.

For the **local Windows operator only**, after reading current `AGENTS.md`, `docs/agent-operations/OPERATING-STANDARD.md` and the existing CodeWalker handoff, use a separate worktree for this PR head:

```powershell
$study = '<checkout>\native\gta-interior-catalog\studies\v_clotheslo-1693'
$raw = '<private #320 reviewed scratch>\focused.jsonl'
$sets = '<private #322 entity-set scratch>\focused.jsonl'
python -m pip install numpy==2.2.6 scipy==1.15.3
python "$study\south_partition.py" --profile base-hipster --raw "$raw" --set-raw "$sets" > '<private scratch>\south-partition-results.json'
```

Required result: nonempty reviewed cuts in every authorized group, conservation checks, strict full-inventory candidate comparison, no unauthorized changes, unchanged vegetation, and result labelled `deployment: BLOCKED`. The script does not emit mesh/vertex arrays. If private raw files are missing, changed, or hashes mismatch, return **NOT RUN**, never replace evidence or bypass checks. A derived-only redacted summary and hashes may be pushed later, not proprietary geometry.

## Open blockers after a successful replay

Actual active DLC/NVE profile; normal/high collision switching; **serialize → reload/quantize → recompare** of edited resources and unaffected owners; unique per-placement MLO/YMAP clone/rebind without modifying the other six clothing shops; LOD hierarchy and coarser district SLOD; portal 2 visibility and shadow/reflection behavior; collision/route and restoration inside GTA. These are later gates, not performed here. Do not edit installed RPFs or attempt fracture/deployment from this branch.

**Rollback:** revert this source-only branch/PR. No host or game files were modified by cloud implementation.
