# X7.1 stronger walk5 trial — October 22, 2026

**j1800: no fracture and no doorway. j3200 built but not fired.**

COMRADE / RTX 5090, same five-strip asset and P1 `(0,0.80)`, `pu=0`, `back=4`. One native RPG diagnostic at approximately 07:04 America/New_York. Base branch commit `510e352a`; only the walk5 model ladder/validator/test/documentation were extended. The runtime driver was unchanged.

## Build and setup

Added j1800 and j3200 with the same existing relationship: strength/health K, minimum damage force K/5, zero force transmission. Original j1000/j550 models remain. Blender 5.2.2/Sollumz exported all four; CodeWalker dev48 converted/reloaded GEN9 v171 six-bone fragments and a four-archetype YTYP. Strict export validation passed. All four vertex/index/bounds fingerprints match `57a48ed1183c2f277aa5eebd301eec048c1e69b70addfd4ace3fd04435eca206`; each strip remains 27 kg. Pack SHA256 `CAAA214775887458012FAD4D6832CB7A4AF28155A9F6F67C6C249C0E00E36BB3`.

Afterburner remained running at 460 W / 575 W default. Desktop input repeatedly failed to activate GTA, so the user manually focused GTA and explicitly confirmed DLSS5 OFF. **This launch has no F6 OFF entry in ReShade.log; OFF is user-confirmed, not independently log-verified.** The screenshot shows the Afterburner overlay/taskbar and about 39 FPS. The earlier j1000 trial was about 120 FPS and used another player character; these are not perfectly matched frame/character conditions.

## Actual result

Fresh original witnesses **9/9**, dormant twin **0/9**. The shot committed the hot swap two frames before the detected explosion; `projectileSeen=true`, `late=false`, `fallbackUsed=false`. Commit call 0.080 ms, commit-to-explosion 52 ms; reported near-event maximum 28.028 ms, zero frames over 50 ms.

**Zero native strips detached.** The dense mask retained 100% twin blocking (all five strips attached-like), removed area 0.0 m²; after-shot twin witnesses **9/9**. The existing `x7walk` probes returned `no_clear_lane_0.9m`, so no physical walk was attempted through an intact fence. No scripted fracture, fake blast or forced collision bypass.

j3200 was not fired: j1800 already retained the entire sheet, and raising strength/health/minimum damage force further is not the useful next tuning direction. This is a reasoned decision, **not measured j3200 behavior**. No intermediate threshold was tried without a new request.

`x7restore` reacquired the visible original at **9/9**. GTA was stopped; all five installation paths hash/existence-restored. See the rollback receipt, actual sanitized logs, collision-mask analysis and screenshot. The legacy analyzer's Session A STOP_CONTROL is expected for this standalone walk5 probe; no X7a/X7b/X8 acceptance is claimed.

## Conclusion and next step

The requested two-adjacent-strip doorway was **not achieved**. Earlier j1000 detached all five strips and allowed a physical crossing; this j1800 shot detached none. Those two observations bracket a sharp transition but do not establish its exact threshold or repeatability under matched conditions.

Next useful small trial: an intermediate K (for example j1300 or j1400), same five-strip geometry and P1/back=4, with consistent game focus/frame conditions. Check adjacent missing strips and surviving outer strips, then require the real player walk. Keep j1000 as the demonstrated broad walkable-breach baseline. No merge.
