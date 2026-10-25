# VH3-B — Vehicle-specific 2D silhouettes and deformable offline mesh

**Implementation status:** pure geometry and replay prototypes completed; exact GTA YFT mesh extraction NOT done. Physical GTA acceptance NOT RUN. Synthetic deformation is NEVER fed into the live HUD.

## What ships in this candidate

- In Full HUD, the static placeholder car graphic is replaced by an **approximate model-specific top-down silhouette** generated on the game fiber from model name plus actual RPH bounding dimensions. On invalid/missing dimensions the existing static car diagram is used.
- Seven archetypes have distinct hood, cabin, rear and wheel-position proportions: supercar, coupe, sedan, muscle, SUV, pickup and van. Twelve named stock models get extra individual hand-tuned proportions; additional known names map to an archetype. Unknown add-ons use conservative measured-bound heuristics.
- Shapes are constructed as a **26-vertex ordered exterior outline** and **4-vertex cabin**. Renderer uses supported existing Rage.Graphics rectangles along the outline, with no DX12 hook, native mesh write, game asset modification or external dependencies.
- Car width:length scales with RPH model dimensions. It is still an artistically approximate outline, **not a representation extracted from GTA vehicle .yft mesh geometry**.
- Deformable mesh engine is RPH-free and can run entirely offline: paired full 48-point VH3 captures are matched strictly by ID, model, handle, bounds, region and validity. Weighted local signed XY displacements bend nearby outline and cabin points; motion is clamped, invalid/far probes ignored, insufficient evidence results in an unchanged shape. A displaced frontend does not distort the rear.
- Current live GTA HUD shows **only the model-specific undamaged outline**; *experimental deformation of this outline requires validated capture pairs*. No attempt is made to infer physical crumpling from body-health percentages or the old four anonymous probes.

## Offline demonstration

Requires installed .NET 8 SDK; no GTA, mods or Python dependencies:

\`\`\`powershell
dotnet run --project tools/vehicle-deformation/MeshPreview/MeshPreview.csproj -- demo .\vh3-preview
\`\`\`

Generates **28 SVG previews**: 7 representative stock models × undamaged, simulated front-left impact, left-side impact, and rear impact.

To replay **real, paired VH3-A captures** after collecting them in-game:

\`\`\`powershell
dotnet run --project tools/vehicle-deformation/MeshPreview/MeshPreview.csproj -- replay "C:\...\baseline.csv" "C:\...\damaged.csv" ".\vh3-capture-replay"
\`\`\`

This writes \`baseline.svg\` and \`deformed.svg\`; the output expressly labels it an **experimental displacement prototype** or **insufficient valid change**. Input file parsing enforces exactly 48 indexed positions, matching model bounds and consistent capture metadata. Colors and polygons are offline research visuals, not verified GTA geometry.

## GO / NO-GO

**Current decision: NO-GO for live deformation.**

Proceed to visual deformation in the actual HUD only when VH3-A demonstrates reliable, repeatable regional correspondence between full X/Y/Z captures and actual visible crushing, acceptable frame times, sensible vehicle model bounds and repair reset behavior on GTA V Enhanced. See \`docs/research/vh3-deformation-feasibility.md\`.

Do **not** assume a 2D silhouette equals the rendered .yft mesh. Future research could use explicitly provided/imported per-model top-down contours extracted offline from supported GTA asset tools. The current geometry is a good UI prototype, not a model extraction capability.

## Acceptance and regression

- Windows pinned SDK compilation and pure input/mesh tests must pass.
- Synthetic offline replay must produce all 28 SVG examples without rejected capture pairs or inverted front/rear axes.
- In GTA, verify that switching between different stock and add-on vehicles actually changes silhouette, is stable after vehicle change/reload, and never hangs, flickers or draws over the pause map.
- Check that the tire highlighting remains based only on GTA puncture state and never claims wheel/axle health based on unverified RPH wheel slots.
