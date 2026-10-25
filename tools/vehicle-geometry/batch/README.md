# VH8 — Automated private vehicle art library

This replaces the *per-car manual workflow* with a batch GLB renderer.
Do not commit outputs: the original GLBs, HUD geometry JSONs and generated
PNGs are derived from Rockstar's source content and should remain in your
private installation.

### What it currently supports

- **Four-wheel automobiles** with four explicit GLB nodes named
  `wheel_lf`, `wheel_rf`, `wheel_lr`, `wheel_rr`
- GTA V Enhanced **high-LOD glTF Y-up** exports with front = glTF -Z
- One locally rendered transparent top-down image, normalized 2D outline,
  glass-material regions and wheel centers per valid model
- A bounded per-batch JSON manifest recording PASS/FAIL and input hash
- Graceful rejection of unsupported layouts (motorcycles, aircraft, boats,
  missing wheel nodes, wrong coordinate axes). No fabricated shapes.
- LSA already loads `<model>.json` and `<model>-shaded.png` when the
  player enters that model. Unsupported cars retain the older generic HUD.

### Install tools on the PC with extracted GLBs

```powershell
python -m pip install -r tools/vehicle-geometry/batch/requirements.txt
```

Export the source vehicles using RPFView locally. Different stock/DLC car
models live in **different RPF archive paths**: inventory paths from the
actual game version, rather than guessing all of them are in x64e.rpf.
Keep a model => source archive mapping outside the public repo.

### Convert one batch (20 models by default)

```powershell
python tools/vehicle-geometry/batch/render_vehicle_library.py `
  --source "C:\LSA-private\vehicle-glbs" `
  --dest "C:\LSA-private\generated-library" `
  --max-models 20
```

For a targeted test batch:
```powershell
python tools/vehicle-geometry/batch/render_vehicle_library.py `
  --source "C:\LSA-private\vehicle-glbs" `
  --dest "C:\LSA-private\generated-library" `
  --models buffalo,adder,sultan `
  --max-models 20
```

Source names accepted: `adder_hi.yft.glb`, `adder.yft.glb`,
`adder.glb`, or any folder containing them. If two exports of one model
are present, choose the one with the highest verified LOD before placing it
in the source directory; source discovery is deterministic.

Each PASS produces `<model>.json` and `<model>-shaded.png`.
Copy only these paired files to the local GTA install:

`<GTA Enhanced>\Plugins\LSA\VehicleGeometry\`

The output manifest is `_vh8-batch-manifest.json`. Preserve the original
GLBs in a private archive for future rendering improvements.

### Limitations and next step

The renderer preserves model-specific proportions and material-shaded
detail. It is **not photorealistic**: export-specific shader effects,
bones, transparency and complex textures may be approximated. The source
scene may contain invalid geometry and must be checked. Some vehicles
have different wheel-node conventions and will be skipped until adapters
are written.

The prior VH7 **72 independent texture-tile warp is disabled** because a
real Buffalo replay showed excessive global distortion and seams.
VH5 continues to sample true GTA spatial deformation when explicitly ON,
and reports shape changes with a perimeter outline instead of moving image
tiles. An accurate dynamic image requires continuous local-space
deformation of a connected 2D textured triangular mesh (or a known-safe
shader/mesh renderer), not disjoint rectangle translation. Do not enable
an unvalidated approximation for all cars.

Run pure synthetic smoke test (never bundles Rockstar assets):

```powershell
python -m unittest discover -s tools/vehicle-geometry/batch -p "test_*.py" -v
```

Bulk extraction itself must be run on the user's GTA computer. The
processor is in GitHub; the resulting private asset library must not
be pushed to a public repository.
