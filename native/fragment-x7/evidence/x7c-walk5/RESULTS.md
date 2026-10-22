# X7.1 walk5 desktop result — October 22, 2026

**Walkable native breach: PASS in one focused P1 trial. Localized retained-sheet hole: NOT achieved.**

COMRADE / RTX 5090, branch `experiment/astra-001-x7-localized-fracture`, source `6cc034d4`. One RPG shot and one physical player walk, 06:31–06:33 America/New_York. No j550 shot or physics/code adjustment was needed to establish walkability. No merge.

## Build and setup

Blender 5.2.2 / installed Sollumz exported both real walk5 models. CodeWalker dev48 converted/reloaded both GEN9 v171 fragments with six bones and the two-archetype YTYP. Strict `validate_x7c.py --require-exports` passed. Pack SHA256: `FB36DAFD7ABB22756963858629547CE0AAAE0C77B4867848A693D0543ECD9D79`. Conversion, pack and manifest receipts are included; binaries remain in the local deliverable archive.

Afterburner preset 1 was selected before Blender/GTA; nvidia-smi confirmed 460 W against 575 W default. The first F6 attempt produced no log entry; after focusing GTA, the next press produced RenoDX `06:31:48:515 ... F6: DLSS Neural Rendering OFF.` The fresh SHVDN load matched driver SHA256 `6b3aa048a4836529ea59601d04f578e72c389b0a9cec09076da07a7f3341b692`.

## Actual gameplay

Prepared `lsa_x7c_walk5_j1000`, lower-center P1 `(aimu=0, aimv=0.80)`, aligned shooter `pu=0`, `back=4`. Fresh original blocked **9/9**, dormant twin **0/9**. Existing camera: `t=-5.5 u=1.5 z=1.5 lu=0 lz=1.1`.

The real script-fired RPG triggered the existing predictor and native fracture. Swap committed **2 frames / 17 ms before explosion**; commit call **0.087 ms**. Reported near-event maximum **9.888 ms**, no frame over 50 ms. `fallbackUsed=false`; no synthetic explosion, scripted piece removal or traversal collision bypass was introduced.

**All five full-height strips detached**, leaving a broad breach rather than a localized torn hole. The raw 25×20 mask had zero twin/debris hits, 8% other hits, and 5.0 m² marked removed by the existing analyzer. This is a raw sampling result, not a claim of a precisely bounded new 5 m² hole. The screenshots show posts remaining, but post/top/bottom band witnesses were zero; no intact-frame acceptance claim is made.

The read-only walk probes found a **1.6 m lane** centered at local U **0.332 m**, clear at 0.5, 0.9, 1.3 and 1.7 m heights. `x7walk` then used the actual player ped and the existing native straight-walk task. It placed the player on the near side before walking; it did not teleport the player through the fence.

The tracked player crossed the fence plane at **U=0.337 m**, reached the far side in **1.827 s**, stayed inside the fence footprint (`outsideFootprint=false`), and had **0 m maximum rise**. `crossed=true`, `passed=true`. This directly resolves the earlier edge-detour failure. See the complete per-frame player track and before/fracture/player-through screenshots. Fire obscures part of the visual opening; collision probes and physical track supply the traversal evidence.

## Restore and verdict

`x7restore` reacquired a visible original with **9/9 blocked**. GTA was stopped using the existing shutdown helper. All five installation paths were hash/existence-restored to their pre-install state: SHVDN INI, Onigiri dlclist, X7c DLC, driver and allowlist. See `install-restored.json`. No crash observed.

**X7.1 succeeds at the requested practical walkable native breach in this trial. It does not prove localized destruction or repeatability.** The frozen X7a Session A and X7b/X8 gates remain unpassed. The legacy analyzer labels this `WALK5_EXPERIMENT`; its STOP_CONTROL/session-gate output reflects the absent full control matrix, not a failed walk.

Next: keep walk5 as the working walkable baseline. If retaining surrounding sheet is still desired, try one modest increase above j1000 strength on this same geometry and repeat only P1 plus the physical walk. j550 would weaken an already fully detached sheet and is not a useful next tuning direction. No redesign is needed to preserve the demonstrated walkability.
