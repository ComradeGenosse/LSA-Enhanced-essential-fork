# X9 read-only existing-wall investigation (2026-10-23)

Read-only: CodeWalker.Core 30_dev48 under .NET 8, GTA V Enhanced archives mounted read-only. No GTA launch, no game/NVE file changed, no asset bytes copied. Evidence files hold names/coordinates/bounds only.

## Verdict: NO-GO for sp1_03_wall_01_o and ch2_04_wall10 (stopped after two unsuitable). cs6_03_05gasmc01 not inspected per scope.

### 1. sp1_03_wall_01_o
- YDR: x64m.rpf\levels\gta5\_cityw\sanpedro_01\sp1_03.rpf\sp1_03_wall_01_o.ydr (259 KB). YTYP: sanpedro_metadata_001_strm.ytyp (also in patchday1ng/2ng). YMAP: sp1_03_strm_0.ymap idx 5 (base + patchday1ng/2ng + onigiri NVE lights_meta copy, same guid 1154234174).
- World pos (-604.083, -1653.910, 22.465), identity rotation, scale 1. lodLevel ORPHANHD, parentIdx -1 (no LOD parent), lodDist 148, no _lod model.
- Archetype/vertex bounds 101.4 x 145.2 x 11.0 m (bs radius 88.7). World AABB (-654.8,-1726.5,17.0)..(-553.4,-1581.3,28.0).
- All 3 geometries use the `decal` shader; 2042 verts occupying 89 of 3723 2 m XY cells, in 37 separated occupied-cell clusters (a coarse spatial statistic, not a topology/triangle-connectivity proof). It is a wall-decal overlay layer over the sp1_03 building block, not a masonry wall. No embedded bound.
- Collision: 17 base YBN composites overlap; all children are merged BoundBVH meshes 30-370 m wide (e.g. sp1_03_0.ybn child 1: 256 x 188 x 47 m, 6825 verts). No independent wall-owned collision was identified by this AABB-level scan. Deleting an entire overlapping shared YBN would damage neighbours; selective polygon surgery remains untested.
- Neighbours <=15 m in same ymap: 28 (sp1_03_build_001_d/wd, windows, props).

### 2. ch2_04_wall10
- YDR: x64o.rpf\levels\gta5\_hills\cityhills_02\ch2_04.rpf\ch2_04_wall10.ydr (863 KB). YTYP: cityhills_02_metadata_008_strm.ytyp. YMAP: ch2_04_strm_1.ymap idx 104, plus apa_/hei_ch2_04_strm_1 DLC copies (parentIdx 385/395 differ) and onigiri lights_meta_sp copy.
- Pos (512.017, 276.235, 103.586), identity rotation. HD entity with LOD parent ch2_04.ymap idx 395 (lodDist 400, childLodDist 100, 1 child). lodDist 100.
- Bounds 72.0 x 26.2 x 3.1 m; 390 verts occupying 19 of 518 2 m XY cells, in 13 separated occupied-cell clusters (not proven connected components of its triangle mesh). One same-ymap neighbour, ch2_04_wall10dcal.
- Collision: 3 YBN composites overlap (ch2_04_18.ybn, hi@ch2_04_21.ybn, ch2_roadsb_0.ybn); children are merged BVH meshes 115-264 m wide; no independent wall collision owner was identified from the scanned bounding boxes. The precise triangles intersecting the proposed breach were not attributed.

### Not inspected
cs6_03_05gasmc01: archetype bounds 51.5 x 25.4 x 3.5 m, ymap cs6_03_strm_1 idx 10 at (1042.83, 2660.62, 40.10), parentIdx 163, DLC copies in patchday1/2ng, mpheist, mplowrider.

### Rule-of-thumb finding
For **these two inspected objects**, the drawable covers many scattered spatial patches and the overlapping collision resources are broad, shared area BVHs. Neither is an acceptable X8-style whole-prop hide/replacement target. This does **not** prove that every existing Los Santos masonry wall is non-isolatable, or that surgical per-triangle offline YBN editing is impossible. AABB overlap does not establish a specific wall triangle's collision owner. No live GTA collision test was run.
