# VH6 Buffalo geometry preparation

This package extracts a GTA V Enhanced model locally, converts an RPFView GLB export into compact GTA-local HUD geometry, and validates that conversion. It does not add geometry to gameplay code or modify a GTA archive.

## Local extraction

Use RPFView 0.11.0 or newer with Enhanced keys set up. Run the wrapper with the official RPFView CLI, game root, and a dedicated output directory outside the installation:

```powershell
.\tools\vehicle-geometry\extract\export_rpfview.ps1 `
  -RpfViewCli 'C:\path\to\rpfview-cli.exe' `
  -GameRoot 'C:\path\to\Grand Theft Auto V Enhanced' `
  -OutputRoot 'C:\path\to\private-research\buffalo'
```

It selects the stock `x64e.rpf` paths explicitly, exports High LOD for `buffalo_hi.yft` and `buffalo.yft`, disables texture search, and rejects output within the game directory. Keep the YFT and GLB local unless redistribution has been cleared.

## Conversion

Python 3.10+ and the standard library are sufficient:

```powershell
python .\tools\vehicle-geometry\convert\glb_to_hud_geometry.py `
  'C:\private-research\buffalo\x64e.rpf\levels\gta5\vehicles.rpf\buffalo_hi.yft.glb' `
  --json 'C:\private-research\buffalo\buffalo-geometry.json' `
  --svg 'C:\private-research\buffalo\buffalo-outline.svg'
```

The converter parses GLB accessors and the node hierarchy; projects actual triangles to GTA-local XY; excludes only the four source nodes named as wheels; rasterizes the other surfaces; extracts the outer ring; and simplifies it. Defaults: 2.5 cm grid, 4.5 cm RDP tolerance. It preserves source node, mesh, material, and triangle-count metadata. It does not infer hood/trunk/door/fender labels where the asset provides none.

`render_mesh_projection.py` creates a material-colored top-down projection of source triangles. `render_synthetic_preview.py` creates a separate synthetic front-left deformation preview; its displacement is illustrative and is not based on gameplay logs.

## Coordinate frame and output

RPFView emits this model in glTF Y-up. Named Buffalo wheel nodes establish the axis/sign conversion: GTA X = glTF X, GTA Y = -glTF Z, GTA Z = glTF Y. The front wheels are on positive GTA Y; left wheels are negative X. HUD output uses front Y=0, rear Y=1, and left as negative X.

The output contains the compact contour (X centered and scaled by full width, Y front=0/rear=1), glass-material projection rings, wheel AABBs/centers in GTA-local meters, source-part metadata, the 48-point VH3 probe layout, and nearest probe/region associations for contour vertices. Those are integration aids, not GTA mesh vertices or panel membership. Roof probes overlap in a top-down projection.

## Validation commands

Portable utility tests:

```powershell
python -m unittest discover -s tools/vehicle-geometry/validate -v
```

Genuine Buffalo validation requires the locally exported stock `buffalo_hi` GLB:

```powershell
$env:VH6_BUFFALO_GLB='C:\private-research\buffalo\x64e.rpf\levels\gta5\vehicles.rpf\buffalo_hi.yft.glb'
python -m unittest discover -s tools/vehicle-geometry/validate -v
```

Without `VH6_BUFFALO_GLB`, the genuine-model suite explicitly skips. A synthetic or absent input is never reported as real Buffalo validation.

## Distribution status

This branch contains extraction/conversion code, schema, sanitized source metadata, and tests. It intentionally contains no `.rpf`, `.yft`, `.glb`, `.obj`, textures, captures, or derived contour coordinates. Distribution rights for the simplified Rockstar-derived geometry remain unresolved, and no suitable existing authorized private staging repository was available. The real export and previews stay in the local research directory. This is tooling preparation only; it does **not** satisfy geometry handoff or enable Phase 3.
