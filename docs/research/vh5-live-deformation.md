# VH5 — live vehicle HUD deformation, opt-in and performance bounded

Status: implemented in feature PR #327, not merged to main and not yet physically verified in GTA. The first real Buffalo VH3 baseline/impact logs showed 48 valid vectors in both captures, localized front-left displacement up to about 0.607 native units, with low native-call overhead during PARKED snapshots. Those logs prove the API can report spatial damage, **not** that continuous probes at driving speed are hitch-free.

## What this now does

Unlike VH3-C's one-shot matched-pair preview, VH5 continuously runs deformation-native sweeps **while driving** when deliberately enabled.

- **F11 → All Tools & Settings → Cheat Menu → Vehicle Options → Vehicle Diagnostics → VH5 live deformation (experimental) → ON**; overlay mode Full. The feature is OFF by default, per session. No activation when only standard Full HUD or VH4 flight recorder is enabled.
- Begin with a **clean, stationary car** (engine/body HP at least 975; speed ≤0.5m/s). The sampler automatically collects a 48-position clean baseline (eight or more 200ms ticks). A model already showing significant nonzero displacement is refused and turns VH5 off: don't calibrate a wrecked car as pristine.
- Once armed, capture new 48-vector spatial readings incrementally (up to six probes per existing 200ms game-fiber tick; ~1.6s or longer per full scan, with a 400ms cooldown), including while moving. Use the same car's measured bounds and the proven GTA native hash.
- Compare each complete sweep with the reference, recalculating a deformable 26-point model-specific exterior and 4-point cabin; interpolate the published shape in the 5Hz game loop. When the native displacement goes back to the clean baseline after a repair, the outline returns smoothly toward intact.
- Reject malformed, missing, implausible, unmatched or sparsely valid scan data. Require ≥40 valid native probe responses (and mesh reconstruction's ≥36 comparable data plus localized change criteria) before accepting a new scan. Distant regions much weaker than the dominant region get discounted to reduce unrelated dents seen in the Buffalo prototype.
- A manual VH3 capture **pauses VH5 sampling** so the plugin does not double its probe load. Existing VH3 saved-capture preview takes priority in the Full HUD while that explicit preview toggle is enabled. Disable it to see VH5 live updates.

## Gameplay safeguards

- No physics modifications, vehicle repair, memory offsets, DX hooks, graphics mesh access, or disk I/O from VH5.
- Native calls and interpolation run on the existing game fiber. FrameRender only draws a published immutable 2D shape.
- Maximum 6 native calls per 200ms tick **AND** 2.5ms measured probe time budget; an individual call over 8ms disables VH5 immediately. Scans longer than 20s disable it.
- After 3 invalid/incomplete sweeps, disable VH5 without affecting the standard HUD, UI, cheats, other LSA systems or VH4.
- Clear all baseline/mesh state on vehicle changes or exit. Maximum 1,200 automatic sweeps per enabled session (then stop), to bound prolonged research use. No permanent heavy tracing; log initial clean baseline and one progress line every 30 sweeps plus on failure.

These are **guards, not a guarantee of zero hitches on your PC**. The first actual moving-car test remains required.

## GTA acceptance checklist

1. Install the exact PR #327 build, start in Story Mode with an intact Buffalo. Set Full HUD, disable VH3 saved-preview if on, toggle VH5 live ON.
2. Park, let VH5 show `LIVE ARMED`, then begin driving. Normal HUD should remain responsive.
3. Crash front-left once. After a completed scan, the HUD outline should compress in the same area. Measure FPS/frame-time consistency if available.
4. Keep driving for 30–60 seconds; verify no frame spikes or failures. Confirm movement remains consistent with existing vehicle damage, and LSA NPC/menu/gameplay work normally.
5. Repair the car via usual gameplay action. Expect restoration **only if GTA's native displacement resets**; a repair action resetting health alone is not enough.
6. Switch cars: no previous car deformation should carry forward. Check VH5 waits for a clean, parked reference again. Test the off toggle and failure guards.
7. Record screenshot/video and RPH `[VH5]` lines. Run a rear or side collision on a new clean car for directional calibration. Don't assume GTA mesh-vertex fidelity from this 2D representation.

## Limitations

Model outlines still use dimensions and archetype profiles, not the actual YFT rendered vertices. A 48-point sweep is **not an instantaneous real-time mesh capture**: this is live-updating, sampled at intervals (not frame-by-frame). Exact glass damage, tire/suspension failure, detached pieces, deformable doors and minor dents between probes may not be represented. This experimental mode is not automatically enabled for everyone until live-game QA demonstrates acceptable behavior.
