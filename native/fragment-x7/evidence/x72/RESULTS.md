# X7.2 localized destruction reliability — October 22, 2026

**Verdict: walkability is reliable; localization is not. j1400 is NOT ready for X7.3 visual polish.** Repeating the j1400 P1 shot gave a different detachment pattern than X7.1, and one off-center shot removed the whole fence instead of the area around the hit.

COMRADE / RTX 5090, branch `experiment/astra-001-x7-localized-fracture` at `4402896d` (PR #296, draft, not merged). Same walk5 j1400 pack (SHA256 `CFD1FC30...78F4A7`) and X7 driver (SHA256 `6b3aa048...b692`) as X7.1; the five installed file hashes matched the X7.1 install manifest exactly. No driver, geometry or asset changes; no synthetic blast, scripted fragment removal or collision bypass.

## Setup

Afterburner profile 1 selected before any 3D work; the power-limit slider reads 80% (the 460 W / 575 W setting measured in X7.1). I could not read watts from here, so this is a slider reading, not a power measurement. GTA was stopped and relaunched once to clear a stuck window focus. After Story Mode loaded, F6 was pressed once and RenoDX logged `F6: DLSS Neural Rendering OFF.` at 08:20:20 (`logs/reshade-f6.txt`), so DLSS5 OFF is log-verified this time.

## Results (fresh original 9/9, dormant twin 0/9 before each shot)

| Measurement | X7.1 j1400 (center) | X7.2 j1400 repeat (center) | X7.2 j1400 off-center U=+0.65 |
|---|---:|---:|---:|
| Strips detached (native parts) | 3 | **4** | **5** |
| Strip states, negative-U to positive-U | attached, missing x3, attached | missing x4, attached | missing x5 |
| Outer strips surviving | both | right only | none |
| Walk lane | 1.5 m | 1.2 m | 1.6 m |
| Player crossed / passed | yes / yes | yes / yes | yes / yes |
| Crossing U, outside footprint, max rise | -0.023, no, 0 m | +0.159, no, 0 m | +0.261, no, 0 m |
| Swap before explosion | 2 frames / 52 ms | 2 frames / 19 ms | 2 frames / 18 ms |
| Commit call | 0.059 ms | 0.087 ms | 0.063 ms |
| Near-event frame max | 27.6 ms | 10.4 ms | 10.9 ms |
| Fallback blast used | no | no | no |
| Original restored after trial | 9/9 | 9/9 | 9/9 |

Strip states come from the dense twin collision mask (5 columns per strip, `summary.json`). The center repeat lost its left outer strip, which survived in X7.1. The off-center shot at U=+0.65 detached all five strips, including the strip farthest from the hit, so destruction did not follow the hit location. The walk lane was inside the footprint with zero rise each time, so the opening is a genuine walkable breach, just too large.

## Interpretation and next step

Native fracture, correct twin collision, hot-swap timing (all swaps 2 frames before the explosion, commit calls under 0.1 ms) and restoration (9/9 twice, files hash-restored) all held. What fails is detachment extent: at j1400 the RPG blast carries enough force to detach most or all strips, and the result varies shot to shot. j1800 resisted entirely (0/5, X7.1), so the usable band is narrow and lies between them. The smallest next fix is one `j1600` model on the same geometry, then repeat one center shot and one off-center shot. That needs a Blender/Sollumz export and CodeWalker conversion on Windows and was not attempted here.

## Limits

One repeat and one off-center shot only; no statistical reliability claim. The off-center test used U=+0.65 on one side only. The X7a Session A and X7b/X8 gates remain unpassed. Full per-frame tracks and sanitized per-run logs are in `logs/` in the local evidence folder; this PR carries `key-events.jsonl` (result, frame-time, mask, opening, walk and restore events; each 25x20 mask is stored as its single repeated row) and `summary.json`. Screenshots (`screenshots/`, five JPEGs: before, after-shot and player-through for the repeat; after-shot and player-through for the off-center shot) are in the local evidence folder and not pushed from the cloud session. Their bytes differ from the originals because the transfer re-encoded them; the content was checked by eye. GTA was shut down and all five install paths (INI, dlclist, X7c DLC, driver, allowlist) are hash-restored (`install-restored.json`). Nothing merged.
