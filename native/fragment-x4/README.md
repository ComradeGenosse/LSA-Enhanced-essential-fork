# X4 first destructible Los Santos wall

Offline Story Mode only. Based exactly on X3 (`d16a4e9c`). X2/X3 sources and evidence are untouched.

`WpsBreachLabX4.3.cs` is the X3-0.3 lab driver plus an X4 block. It takes one vanilla wall prop, hides it **and its collision** at runtime, spawns the frozen X2 GEN9 native-fragment wall (`lsa_x2_concrete`) in its place with the same heading, and anchors it with the X2/X3 native fixed joint. Nothing in the game files changes; the hide is a runtime-only model hide that ends when the game exits or `x4restore` runs.

Target: `prop_fnccorgm_02e` (hash 1185366416, corrugated metal fence, `v_fences.rpf`) at 1065.758, -1773.716, 34.851, Elysian Island, upright. It is not overridden by the NVE, forest or LA Roads packs (checked against `mod-toc.json`).

## Commands (file bridge, `WpsBreachLab/command.txt`, one per line)

```
x4setup verified=1 hash=1185366416 tx=1065.758 ty=-1773.716 tz=34.851 px=1072 py=-1772.5 pz=36.5 pu=1.5 back=9 hold=15
x4cam   t=-6.5 u=3.2 z=1.7 lu=0.2          # optional evidence camera (off: x4cam off=1)
x4fire  mode=rpg slowmo=0.15 slowms=7000   # real RPG projectile; mode=native uses a calibrated explosion
x4walk  slowmo=0.35                        # PLAYER is tasked to walk through the opening
x4restore                                  # removes replacement, removes the model hide
```

## Probe note (important)

The lab's raw `START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE(..., 17, 0, 0)` ray crashes GTA a few frames after it first hits the replacement fragment wall in the city (X3's desert tests never hit this). `World.Raycast` (SHVDN, flags 17) is stable, so X4 grid probes use it by default (`ray=native` re-enables the raw call; do not). The raw rays used for the neighbour check are unreliable after restore, see the report.

## Deploy / restore (manual, nothing Rockstar-derived is committed)

1. Install the frozen X2 pack at `onigiri/dlcpacks/lsa_destruct/dlc.rpf` (sha256 `180618AD...AF347`) as in X2.
2. Put `WpsBreachLabX4.3.cs` alone in a `scripts-x4` folder and set `ScriptsLocation="scripts-x4"` in `ScriptHookVDotNet.ini` (X2/X3 scripts stay out of the way). The name must not end in `.4.cs`.
3. Launch, press F6 once, then drive the commands above.
4. Restore: copy the original INI back, delete `scripts-x4`, check the INI, `scripts/WpsBreachLab.3.cs`, `dlclist.xml` and the pack hashes.
