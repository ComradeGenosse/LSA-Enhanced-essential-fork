# VH3-C — Real-capture mesh preview (OFF by default)

## Purpose

Use a **completed and matched VH3 baseline/damaged pair** to display a 2D
deformation prototype in LSA's Full driving HUD. This is deliberately *not*
continuous damage tracking. It does not run any new native calls while
driving and it does not change the car's game geometry or damage handling.

The first real GTA Enhanced Buffalo capture (2026-10-25) returned 48/48
valid probes in both scans, with a clean zero baseline and front-localized
vectors after a visible impact. We used the private user-supplied capture
**locally for evaluation only**. Raw capture data, world locations,
identifiers, log files, screenshots and user-specific metadata were **not
committed to this repository**.

A separate synthetic test approximates the observed scale and signs to
exercise the mesh reconstruction under Windows CI without exposing the logs.

## How to use the in-game preview

1. Install the build from the updated PR #327 (this code is NOT in main).
2. Get into the same car and use **F11 → All Tools & Settings → Cheat Menu →
   Vehicle Options → Vehicle Diagnostics**.
3. Choose **Overlay mode = Full**.
4. Enable **VH3 deformation experiment**, capture an undamaged baseline
   while parked, then damage the same car and capture again while parked.
5. Enable **Preview last paired VH3 mesh**. The Full HUD will display
   the warped polygon labeled `VH3 CAPTURE REPLAY` when the paired
   captures have enough usable localized deformation data.
6. Turn that toggle OFF to show the normal undamaged vehicle silhouette.

No file import exists yet: a pair from an earlier session can be replayed
by the offline MeshPreview command, but will NOT automatically appear in the
game when you launch a new session. The preview is session-only.

### Safeguards

- Preview is OFF by default and never automatically enabled by a capture.
- No 48-probe sampling is enabled by preview. VH3 itself is independent.
- Only successful, matched, same-vehicle baseline + damaged snapshots from
  this session can become a preview. Pairing only follows disk save success.
- The mesh is reconstructed **once on the game fiber**, not on FrameRender.
  FrameRender accesses a published read-only shape. No disk I/O on draw.
- A new baseline or vehicle change invalidates the old preview geometry;
  disabling preview returns the original model silhouette.
- The same strict geometry gates remain: minimum 36 comparable valid
  probes, 3 changing samples, bounded displacement and non-crossing
  ordered outline. If the gate rejects data, normal silhouette remains.
- The output is based on approximate model dimensions and 2D interpolation,
  not exact .yft triangles, all panels, physics bones or GPU vertex buffers.

## Next calibration decision

The observed Buffalo capture gives a plausible front-left dent, but
lesser rear/side vectors also change the outline. This may include damage
from other impacts; one capture alone cannot establish true panel mapping.
Before enabling continuous live deformation we still need a second controlled
impact direction, preferably rear or isolated side, on a fresh car and visual
comparison from consistent top/side camera angles. The optional VH4 5Hz flight
recordings and per-probe diagnostic sidecars help attribute impact history.

**Status:** Native implementation candidate; pinned Windows CI and physical
GTA preview acceptance are distinct. Never claim the HUD accurately tracks
real deformation live until actual in-game visual checks pass.
