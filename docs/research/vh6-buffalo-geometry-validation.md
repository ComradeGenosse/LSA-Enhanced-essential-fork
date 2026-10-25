# VH6 Buffalo extraction and geometry validation

## Scope and result

This is local offline geometry preparation. Stock `buffalo_hi.yft` was parsed from the GTA V Enhanced base archive `x64e.rpf\levels\gta5\vehicles.rpf`, exported as glTF 2.0 GLB with RPFView CLI 0.11.0, and converted from genuine model triangles. The original YFT and GLB stay in the local research directory. The public branch includes tooling and sanitized metadata only.

## Source and conversion evidence

- `buffalo_hi.yft`: SHA-256 `280B518DDF52C60AC951A45255C8716909389EC35B1BCD60D3E629D621AE350C`; resource version 171; 80 bones; High LOD contains 24 mesh nodes and 64,562 triangles.
- `buffalo.yft`: SHA-256 `027C74E5874200B793DB92A87851E8D23036897DCCB7A09C3A6BE621103D5417`; 80 bones; High/Medium/Low/VeryLow LODs contain 18,744/7,129/2,151/393 triangles.
- Export used `--no-texture-search`; no textures were exported or used. The game archives were read only.
- The converter found 24 High-LOD mesh nodes, including the four named wheels. The high LOD contains 64,562 triangles total; 18,424 belong to the four wheel nodes, and the contour projection uses the other 46,138. The simplified outer contour has 14 ordered points. Material-only window projection contains 6 rings. Triangle raster vs simplified contour IoU is 0.98606. The contour is non-self-intersecting; winding is normalized for HUD coordinates.
- Full source scene extents: width 1.94727 m, length 5.02051 m, height 1.39183 m; width:length ratio 0.38786. Extents include the named wheel nodes.
- Repeated conversion yielded equivalent parsed data. Four genuine-source tests passed locally: GLB/triangle parsing, dimensions and handedness, contour quality/simplicity, and deterministic/schema invariants.

## Coordinate and feature interpretation

RPFView GLB is Y-up. Named `wheel_lf`, `wheel_rf`, `wheel_lr`, and `wheel_rr` nodes verify GTA X = GLB X, GTA Y = -GLB Z, GTA Z = GLB Y; front = positive GTA Y, left = negative GTA X. Output uses front Y=0, rear Y=1, negative X=left. Wheel centers and AABBs are in the local geometry JSON.

Mesh/material names do not semantically isolate hood, trunk, doors, bumpers, or fenders. The local output keeps source names and labels other components ambiguous. Window rings come from materials with “glass” in their names; they are not semantic cabin boundaries. The 48 VH3 probes are regenerated from the checked-in `VehicleDeformationGrid.Build` formula and associated to nearest contour vertices as estimated influence anchors; roof projection and nearest associations are not exact surface correspondence.

The high-LOD preview is an orthographic, material-colored projection of source triangles, without textures or occlusion. The contour preview annotates material-derived window rings and named wheel centers. A separate front-left crash image is synthetic, not a capture replay. Local paired VH3 CSVs were examined separately; logs, probe coordinates, capture IDs, screenshots, and per-probe results are not included publicly.

## Validation limits

Run `python -m unittest discover -s tools/vehicle-geometry/validate -v` for portable checks. Set `VH6_BUFFALO_GLB` to the locally exported genuine `buffalo_hi` GLB for Buffalo-specific tests. Offline checks do not establish model appearance in GTA, deformation-native correctness, panel correspondence, or an LSA integration. No Phase 3 or Phase 4 code is included.

## GitHub distribution gate

The public repository is accessible, but source-derived contour/rings/wheels are omitted. No suitable existing authorized private geometry staging repository was available; unrelated private repositories were not used. The local GLB-derived geometry and previews remain on the user machine. VH6 is **NOT READY for Phase 3 handoff**, despite successful local extraction and conversion.
