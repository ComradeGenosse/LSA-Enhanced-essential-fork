# X7.1 j1300 / j1400 — October 22, 2026

**Both thresholds produced a genuine walkable doorway with both outer strips surviving. Both detached three middle strips, not the exact two-strip target.**

COMRADE / RTX 5090; branch base `4644818f` plus the j1300/j1400 model definitions. Two real script-fired RPG shots, same fresh five-strip asset, P1 `(0,0.80)`, `pu=0`, `back=4`, approximately 07:24–07:26 America/New_York. No runtime driver or geometry changes, synthetic blasts, scripted fracture/removal or collision bypass.

## Build and setup

Blender 5.2.2 / installed Sollumz exported the six-model walk5 pack. CodeWalker dev48 converted/reloaded all six GEN9 v171 six-bone fragments and the six-archetype YTYP. Strict actual-export validation passed; all 11 focused unit tests passed. Vertex/index/bounds fingerprints match the earlier walk5 assets exactly: `57a48ed1183c2f277aa5eebd301eec048c1e69b70addfd4ace3fd04435eca206`. Strip mass remains 27 kg; root and native anchoring remain unchanged. New thresholds use strength/health K, minimum damage force K/5, transmission zero. Pack SHA256 `CFD1FC30A46A0C7A065DC06E332CCA4D87444FA09C9A4000F45BF3726B78F4A7`.

Afterburner remained at preset 1's measured 460 W / 575 W default cap. The new Story Mode load matched driver SHA256 `6b3aa048a4836529ea59601d04f578e72c389b0a9cec09076da07a7f3341b692`. Desktop input again failed to activate GTA; the user explicitly confirmed focus and DLSS5 OFF. No F6 OFF entry exists for this launch, so OFF is user-confirmed, not independently log-verified. The Afterburner/taskbar overlay remains visible in screenshots. Both shots ran at roughly 38–39 FPS in this same loaded world.

## Actual results

| Measurement | j1300 | j1400 |
|---|---:|---:|
| Fresh original / dormant twin witnesses | 9/9 / 0/9 | 9/9 / 0/9 |
| Native strips detached | 3 | 3 |
| Strip states, negative-U to positive-U | attached, missing, missing, missing, attached | attached, missing, missing, missing, attached |
| Dense twin blocking / raw removed area | 40% / 3.0 m² | 40% / 3.0 m² |
| Clear walk lane | 1.2 m | 1.5 m |
| Player plane crossing U | +0.164 m | -0.023 m |
| Walk time | 1.861 s | 1.839 s |
| Outside footprint / maximum rise | false / 0 m | false / 0 m |
| Actual player walk passed | true | true |
| Swap before explosion | 1 frame / 26 ms | 2 frames / 52 ms |
| Commit call | 0.081 ms | 0.059 ms |
| Reported near-event frame maximum | 28.053 ms | 27.583 ms |
| Original restored after trial | 9/9 | 9/9 |

The native part count, dense per-strip collision masks and screenshots agree: strips 2–4 detached; the two outer strips stayed attached. The authored missing span is about **1.522 m**. The lane finder samples actual collision at 0.5/0.9/1.3/1.7 m heights and reported narrower clearance for j1300, potentially including debris/other hits; do not equate its lane width to authored missing width. Raw removed area is the existing mask-grid measurement, not exact polygon area.

Both physical walks used the actual player ped and the existing straight-walk native task. The helper places the player on the near side before walking; crossing is tracked continuously through the fence plane, with no teleport through it, no edge detour and no climb. Full tracks are preserved. Both shots had `fallbackUsed=false`, no late swap and no reported near-event frame over 50 ms.

j1300 fire obscures the lower opening. The immediate j1400 screenshot was black during a transient and is not used as visual proof; the later clear j1400 player-through screenshot shows the doorway and the player beyond it. Nearby NPCs were present. No repeatability claim beyond these two distinct-threshold observations, and no perfectly matched comparison with earlier j1000/j1800 launches.

## Restoration and conclusion

After each trial the visible original reacquired at 9/9 collision witnesses. GTA was stopped and all five installation paths hash/existence-restored to the original backup: INI, dlclist, X7c DLC, driver and allowlist. No crash observed. See install-restored.json.

**Practical localized walkable breach: demonstrated at j1300 and j1400. Exact two-strip / approximately 1 m doorway: not achieved.** The frozen X7a Session A and X7b/X8 gates remain unpassed; the legacy analyzer's STOP_CONTROL is expected because this was a standalone walk5 probe without its full control matrix.

For a personal mod, j1400 is a useful current baseline: outer sheets survive and the player genuinely crosses the doorway. If the exact narrower doorway still matters, the next small threshold comparison lies between j1400 and j1800 (for example j1600), keeping the same geometry and real-player walk check. No further shots were made and nothing was merged.
