# VH9 — Connected-triangle texture deformation (offline first)

**Status:** working offline Python renderer with synthetic regression tests; **NOT integrated into GTA FrameRender, NOT GTA-verified, OFF by design.** Branch stacks on VH8 / PR #330 (which stacks on PR #327). The VH7 72-piece/tile image distortion remains disabled.

## What is implemented

- A single **connected shared-vertex triangular grid** across the local VH8 source-rendered PNG, with each warped output pixel sampled from original UVs by inverse barycentric mapping. Adjacent triangles share all vertices and texture coordinates; no independent rectangles are translated.
- Localization from true **paired VH3 48-point** baseline/damaged `dx/dy/dz` measurements, matching `capture_id`, model, handle, bounds, probe index/position and phase. GTA-local X maps to texture X; GTA-local positive Y maps to upward texture motion; Z affects signal validity/severity only, not 2D displacement.
- Image-space positions account for VH8's 5%-on-each-side raster padding; one smooth Gaussian influence field naturally decays away from the impact.
- Wheel-region and glass-region stiffness, conservative 7.5% normalized movement clamp, automatic damping, and rejection of inverted/degenerate triangles, poor triangle area, extreme edge stretch or insufficient evidence.
- A **fail-closed error** (no deformed output) on bad or weak captures. No synthetic scene can be mistaken for verified GTA data: results mark `synthetic_not_gta` or `real_vh3` explicitly.
- A PNG and adjacent `.vh9.json` audit report with comparable probes, changed probes, maximum texture movement, vertex/triangle count, accepted damping strength, and explicit `in_game_enabled:false`.
- No extra game-native reads, no F11/menu changes, no loader changes and no writes to GTA archives. Normal game behavior is identical to VH8.

## Prerequisites

Python 3.10+; install in the GTA owner's **local development environment**:

```powershell
python -m pip install numpy opencv-python-headless pillow
```

The owner's privately exported pair `buffalo.json` and `buffalo-shaded.png` (or any validated VH8 model pair) are required. These and all output previews remain local. Never commit Rockstar GLB, YFT, PNG, JSON-derived geometry or personal VH3 driving captures.

## Synthetic previews (not evidence from GTA)

From repository root:

```powershell
python tools/vehicle-deformation/vh9_connected_mesh.py `
  --sprite 'C:\LSA-private\generated-library\buffalo-shaded.png' `
  --geometry 'C:\LSA-private\generated-library\buffalo.json' `
  --synthetic front-left `
  --out 'C:\LSA-private\vh9-front-left.png'
```

Also try `--synthetic side` and `--synthetic rear`. These are deliberately fabricated inputs used to inspect front/side/rear locality, not game-verified crumpling.

## Genuine paired VH3 replay

Enable VH3 in **F11 → All Tools & Settings → Cheat Menu → Vehicle Options → Vehicle Diagnostics**. With the same clean vehicle and parked:
1. Enable **VH3 deformation experiment** and select **Capture undamaged baseline**. Wait for the 48/48 completion.
2. Drive into a wall or another vehicle, park that **same car**, then select **Capture after impact**. Wait for 48/48.
3. Match the baseline and damaged CSV files under `Plugins\LSA\Logs\VH3\` (not the `.diagnostics.csv` sidecars).
4. Run locally:

```powershell
python tools/vehicle-deformation/vh9_connected_mesh.py `
  --sprite 'C:\LSA-private\generated-library\buffalo-shaded.png' `
  --geometry 'C:\LSA-private\generated-library\buffalo.json' `
  --before 'C:\GTA-logs\VH3\baseline.csv' `
  --after 'C:\GTA-logs\VH3\damaged.csv' `
  --out 'C:\LSA-private\vh9-measured.png'
```

Replace paths and model as appropriate; example CSV names are placeholders. Real capture values may all be zero or noisy despite obvious in-game crumpling: the tool **must refuse**, not invent, visual damage.

## Test and release gates

```powershell
python -m unittest discover -s tools/vehicle-deformation -p 'test_vh9*.py' -v
```

Synthetic tests verify localized front-left, side and rear shifts; opposite-end preservation; positive triangle areas; explicit foldover rejection; invalid geometry/orientation; correct 48-row paired capture validation; and fail-closed insufficient data.

**Not yet solved:** per-panel material deformation; physically exact crumple; correct conversion for every asset renderer variant; visually certified real Buffalo replay; efficient real-time in-game rendering. The existing GTA HUD still displays its stable unwarped image and separate VH5 perimeter damage outline. Do **not** wire this Python rasterizer into the game or silently re-enable VH7's bad tile warp. In-game support must have a separately benchmarked and validated native/GPU texture-triangle rendering path with explicit experimental toggle and fallback.

## Review checklist

- Visually compare the generated **measured** PNG against front-left, side and rear real-game screenshots, and record residual distortion or gaps.
- Confirm opposite-end body/roof/wheels do not shift implausibly. Reject artifacts even if numerical triangle safety passes.
- Review false negatives when GTA native vectors are all-zero; they indicate missing physics information, not a solver failure.
- If a real scene fails a gate, use its sidecar audit report to diagnose before tuning thresholds.
