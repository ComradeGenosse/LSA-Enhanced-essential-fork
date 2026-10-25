# VH6 Phase 3 — locally extracted vehicle contours in the F11 vehicle HUD

## Status and source

Integration source is PR #330, stacked on PR #327. The geometry was
extracted on the owner's Windows PC using RPFView 0.11.0 from actual
GTA V Enhanced `buffalo_hi.yft` (High LOD, 64,562 total triangles).
The public PR deliberately includes **no raw YFT/GLB, textures, derived
Buffalo silhouette coordinates, or personal driving logs**.

The extracted 14-vertex body contour, six projected glass rings,
and four named wheel positions are contained in the user's local
`buffalo-geometry.json` and **must be installed locally**. A metadata-only
GitHub manifest is NOT a substitute for that JSON. No rights to redistribute
the game asset are implied.

## What is implemented

- `VehicleGeometryProfile.cs` parses a locally supplied
  `vh6.vehicle-geometry.v1` JSON, validating name, coordinate convention,
  source/native dimensions (32% maximum difference), topology, wheel
  orientation, vertex counts and size (256 KiB). Malformed/unavailable
  data fails closed to the existing procedural archetype silhouette.
- Local JSON is loaded **once when entering a model** and retained in
  session memory, not re-read every frame or native sample.
- `VehicleBodyMesh` preserves true cyclic body outline, glass-material
  polygon rings and four named LF/RF/LR/RR wheel centers, without relying on
  the procedural 26-point outline.
- The ordinary Full HUD renders the locally extracted silhouette and
  overlays the glass rings and correctly positioned wheel statuses. The F11
  Vehicle Diagnostics screen shows `EXTRACTED buffalo ... points` when
  successfully loaded, otherwise a descriptive fallback reason.
- The VH5 measured 48-position deformation pipeline uses the same native
  model bounds to bend the extracted contour and glass rings; smoothing
  and repaired/restored shape also preserve the authentic geometry.
- No new game natives, texture hooks, GTA file modifications or per-frame
  file I/O. All actual 3D source geometry remains outside the plugin.
- Unit tests use **synthetic outlines only**. They cover genuine-schema
  parsing, bad-model rejection, handedness, mismatched dimensions, arbitrary
  polygon topology, deformation and glass smoothing.

## Local installation

1. Complete PR #330's conversion steps on the GTA machine. Keep its real
   `buffalo_hi.yft.glb` and derived `buffalo-geometry.json` outside the
   Git repository and game installation.
2. Build/install an LSA DLL containing VH6 Phase 3 changes from this branch.
3. Run the following PowerShell script from the repository root:

```powershell
.\tools\vehicle-geometry\install-local-geometry.ps1 `
  -GeometryJson 'C:\private-research\buffalo\buffalo-geometry.json' `
  -GameRoot 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced' `
  -Model 'buffalo'
```

Replace the source path with the actual local JSON output path that Codex
created. No artifact bytes need to be uploaded to GitHub.

The copied file is under:

`<GTA Enhanced>\Plugins\LSA\VehicleGeometry\buffalo.json`

If this file is changed, reload the LSA plugin or re-enter a **different**
model first. The loader caches model files for the plugin session.

## In-game acceptance

1. Get a stock Buffalo, select **F11 → Vehicle Diagnostics → Full**.
2. Check **Vehicle model geometry** reports `EXTRACTED buffalo 14 points`,
   not `Archetype fallback`.
3. Look for **FRONT / MESH-DERIVED**, top-down body silhouette,
   glass regions and correctly placed four wheels.
4. Enable VH5 live deformation, park a clean vehicle for baseline, then
   crash the front-left and verify the extracted outline visibly changes.
5. Check a non-Buffalo vehicle: it must use the existing procedural
   silhouette, without exceptions or geometry bleeding between cars.
6. Check normal gameplay, plugin reload, F11 and frame pacing. VH5 remains
   opt-in; actual live-game performance and accurate damage mapping are
   **not established by CI**.

## Remaining visual fidelity limits

This renders a **mesh-derived top-down outline and glass segments**, not
a textured 3D vehicle image. Simplification to 14 contour points means
small hood creases, mirrors, tires and panel seams are not visually exact.
The exported GLB did not label semantically separable doors, fenders,
hood and trunk. To reproduce the complete appearance, a further
*locally rendered sprite/texture layer* or a verified 3D rendering path
would be necessary; this is a separate graphics capability and may
require SDK research. Do not equate raster IoU 0.986 with photorealistic
or post-crash visual fidelity.

Distribution/legal boundary: never commit or publicly serve raw
Rockstar assets, game-derived contour coordinates or prerendered
vehicle imagery unless appropriate rights are established. The
owner's installed local game assets stay local.
