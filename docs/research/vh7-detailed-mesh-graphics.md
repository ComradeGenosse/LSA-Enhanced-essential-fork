# VH7 — Detailed source-mesh Buffalo rendering, local-only

## Verified local extraction/rendering

The owner provided `VH7-Buffalo-Source-Handoff.zip` containing a 4.36 MiB
High-LOD GLB, original stock GTA V Enhanced `buffalo_hi.yft`, 15 material
definitions and 9 PNG images. The manifest reports 64,562 triangles in 24
meshes. GLB positions, normals, UV0, colors, and indices are readable.
Game-local front is +Y (glTF -Z), left is -X, roof height is glTF +Y.

An offline software orthographic renderer used the actual GLB geometry,
normal lighting, material classes and limited source-texture sampling to
generate a detailed **top-down 512x1290 RGBA PNG**; it visibly distinguishes
roof, glass, hood, trunk, wheel positions, lights and body edges. It is not
a GTA shader-accurate/photorealistic render: full source shader material
parameters, glass transparency, the original bone skin and precise body
paint are not represented. All Rockstar-derived geometry, generated sprite
pixels, masks, original asset textures and 57-point source-derived contour
are local/private, NOT included in this repository.

The local handoff ZIP `VH7-Buffalo-Local-HUD-Assets.zip` contains
`buffalo.json` and `buffalo-shaded.png`, as well as optional layer images,
preview, and a PowerShell installation script. The local user can download
it from the ChatGPT conversation and extract directly into the GTA install
tree. The JSON is a more detailed 57-point contour derived from the
actual source-mesh orthographic projection.

## How LSA renders it

When **Full** Vehicle Diagnostics HUD displays a model with validated
local geometry `Plugins\\LSA\\VehicleGeometry\\buffalo.json`:
- The game fiber loads `Plugins\\LSA\\VehicleGeometry\\buffalo-shaded.png`
  using documented RPH `Game.CreateTextureFromFile` **once per model**.
  It refuses invalid PNG format, excessive file size/dimensions or more than
  8 cached model sprites. Game files stay untouched.
- The regular FrameRender paints the detailed source render with a single
  documented `Rage.Graphics.DrawTexture` call, and overlays confirmed
  wheel status at source-derived wheel centers.
- If VH5's experimental *measured* deformed 2D geometry is active, 6x12
  cropped UV tiles are displaced using its existing 48-point-measurement
  output's contour movement. An orange outline reports the new measured
  perimeter. This is experimental *piecewise 2D texture approximation*,
  not triangle-by-triangle 3D mesh deformation and not game graphics hooking.
  The extra cropped draws occur only when VH5 is active and reporting
  measurable deformation; the regular intact frame uses a single draw.
- If no validated local JSON or PNG is found, use the previous mesh-
  derived wireframe / generic archetype HUD. It never fetches assets
  from GitHub or the network.
- F11 Vehicle Diagnostics exposes a **Detailed model render** status:
  `LOCAL 3D SOURCE RENDER` means the local PNG loaded; absence is explicit.

## Installation

Install an LSA build containing this PR (PR #330 stacked on #327, not main),
then extract `VH7-Buffalo-Local-HUD-Assets.zip` locally. Run:

```powershell
.\install_vh7.ps1 -GameRoot 'C:\<actual GTA V Enhanced installation folder>'
```

Use `-Force` only if replacing an existing Buffalo JSON/sprite.

After installation, start GTA, enter a Buffalo, set
**F11 → Vehicle Diagnostics → Overlay mode = Full**.
Check:
- Geometry: `EXTRACTED buffalo 57 points` (count may vary if private
  regeneration changes tolerance).
- Detailed model render: `LOCAL 3D SOURCE RENDER`.
- HUD label `FRONT / 3D-MESH RENDER`.

For damage, enable VH5 **only** after parking a completely undamaged
Buffalo and letting it acquire its clean reference. The static sprite then
becomes experimentally UV-tile warped against VH5's measured deformed
outline when a sweep reports actual displacement.

## Important limitations/acceptance

All new rendering code compiled against the pinned RPH SDK in GitHub
Actions, but there is **no claim of in-game GTA visual acceptance**:
check alpha rendering, correct orientation, 4K scaling, UV tile alignment,
and FPS/frame pacing after damage. Disable VH5 if damaged texture rendering
is too expensive. The extraction does not label individual hood/trunk/
door/fender bones or original YFT vehicle deformation weights, so it cannot
exactly reproduce arbitrary actual in-game bent 3D panels. The genuine
body appearance is now much closer to the model, but not equal to a live
render of GTA's damaged mesh.
