# ASTRA-001 X5 - Just-in-time destruction (experimental, draft)

First playable proof that an ordinary Los Santos wall can stay completely untouched until an incoming RPG, then be swapped
for a destructible fragment wall a few frames before impact, so the real explosion breaks it physically.

Base: X4 (PR #291). Design: Astra's X5 research (PR #292, separate). Nothing here changes X2-X4.

## How it works

1. `x5prepare` finds the original prop (X4 recipe: `prop_fnccorgm_02e`, Elysian Island) and spawns the frozen X2 native-fragment
   wall (30 chunks, native joint anchor) at the original's footprint centre as a **dormant twin**: invisible, collision off
   (physics kept), frag damage/breaking/damageable disabled. The original is not touched (witness rays: original 9/9, twin 0/9).
2. `x5shot` tracks the real RPG projectile every frame (`World.GetNearbyProjectiles`), computes time-to-contact along the wall
   normal with an on-course check, and commits when `ttc <= 40 ms + 1.5 x frameMs`.
3. The commit is one script tick with no yields, no logging, no model requests: twin damage/collision/visibility on, then
   `CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS` hides the original. The real rocket then explodes against the twin.
4. Reactive fallback (`fallback=1` or `predict=0`): late swap on first explosion plus the calibrated native rocket blast. Not needed in the demos.
5. `x5restore` removes the twin, anchor and ownership-verified debris (X3 guard), calls `REMOVE_MODEL_HIDE`, re-checks the original.

Verbs: `x5prepare`, `x5shot`, `x5walk`, `x5restore`, `x5cam`. The built driver is committed as `WpsBreachLabX5.3.cs`; it is reproducible with `python3 build_x5.py` (X4 driver + `x5block.cs`).
Built `WpsBreachLabX5.3.cs` sha256 `ad6f8878d826b69e20c534eb4470c6aa999236d365b7321d9e590d004bd86958`. Script name must not end in `.4.cs`.

## Results (offline Story Mode, scripted RPG at about 12 m/s, 9-10 m range)

| Run | Commit before explosion | Native parts | Median frame | Worst frame near swap | Frames >50 ms |
|---|---|---|---|---|---|
| s1 | 4 frames / 37 ms (ttc 51 ms, 0.60 m from face) | 16 | 9.3 ms | 12 ms | 0 |
| s2 | 3 frames / 29 ms (ttc 50 ms, 0.59 m from face) | 16 | 9.8 ms | 11.7 ms | 0 |

- Commit call cost 0.07-0.09 ms. No fallback, no crash, no visible stutter in either run.
- Walk-through: after s2 the player crossed the wall plane at u=-0.011 inside the footprint with 0.04 m rise (`x5_player_result.passed=true`); a screenshot shows the player standing in the opening.
- Before combat the original was untouched (9/9 witness, visible); after `x5restore` the original is back and blocking (9/9 witness after the first cycle; after the second cycle a fresh `x5prepare` re-witnessed 9/9 and a screenshot showed the intact corrugated fence). Install files were restored to their pre-test hashes and GTA was closed.
- Raw rows: `evidence/x5-key-rows.jsonl`.

## Limitations / next problems

- The replacement is the X2 concrete slab (3 x 2.5 x 0.2 m), not matched to the corrugated-metal fence it replaces; neighbouring fence panels were damaged by the blast in s1.
- Only script-fired rockets were tested (observed speed about 3-12 m/s). A real launcher shot (`mode=weapon`) and a fast shot were not run; at high speed the 40 ms horizon plus frame-scaled lead should be revisited.
- The opening has knee-high rubble across part of its width; the lane finder is strict (needs 0.9 m clear at 0.5-1.7 m), so `x5walk` accepts `u=` to walk a chosen lane. The clear lane in s2 was about 1.3 m wide above 0.9 m.
- `x5_restored` witness can report 0 on the second cycle because the original prop handle goes stale after `REMOVE_MODEL_HIDE`; re-preparing and the screenshot confirmed the original was back. Fix: re-find the original by model/position before witnessing.
- Cleanup correctly skipped three handles it could not prove were ours (blast-damaged neighbours); they reset on game restart.
- Not verified: the F6 (DLSS5 off) press happened while the game was paused.
