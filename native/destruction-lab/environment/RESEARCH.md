# X8 lab environment controls — sourced design and operational limits (Oct 23 2026)

## Scope and evidence

This is an **opt-in Story Mode-only operator convenience layer** for P2,
not a workaround for the map DLC in draft #310, not a change to X7.3 physics,
and not a proof of gameplay. Runtime API compilation on installed SHVDN
3.9.0.0 and live GTA acceptance remain mandatory.

Primary sources (API implementation and native database):
- [SHVDN v3 Player.cs](https://github.com/scripthookvdotnet/scripthookvdotnet/blob/main/source/scripting_v3/GTA/Player.cs): Player.IsInvincible, WantedLevel, MaxArmor; police-ignore is write-only.
- [SHVDN v3 World.cs](https://github.com/scripthookvdotnet/scripthookvdotnet/blob/main/source/scripting_v3/GTA/World.cs): World.CurrentDayTime, World.Weather.
- [CitizenFX player native IDs](https://github.com/GTANetworkDev/platform/blob/master/Server/Constant/NativeHashes.cs): GET/SET wanted level, MAX_WANTED_LEVEL, SET_POLICE_IGNORE_PLAYER, SET_DISPATCH_COPS_FOR_PLAYER.
- [SET_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME](https://github.com/citizenfx/natives/blob/master/VEHICLE/SetVehicleDensityMultiplierThisFrame.md): must be applied each frame.
- [SET_PED_DENSITY_MULTIPLIER_THIS_FRAME](https://github.com/citizenfx/natives/blob/master/PED/SetPedDensityMultiplierThisFrame.md): must be applied each frame.
- [GTA density native set and per-frame usage in a FiveM codebase](https://github.com/citizenfx/fivem/blob/master/code/components/lovely-script/src/Lovely.cpp): confirms all five density controls use per-frame calls. The GTA native semantics are relevant; **not** suggesting FiveM runtime or resources.
- Baseline X7.3 script: existing PrepareSite() snapshots player invincibility and max wanted, sets invincible/maxWanted=0; RestorePlayer() reinstates those, and X7Prepare() already pins clock to midday temporarily. This feature must compose with that behavior.

| Requested setting | Mechanism | Snapshot / limitation |
| --- | --- | --- |
| Invincible ON | Game.Player.IsInvincible=true | Getter available: restore exact previous bool; it does not disable world explosions or collision |
| Wanted locked 0 | GET/SET wanted level, max wanted=0; tick reapplies if necessary | Store prior current/max wanted level; X7 PrepareSite will snapshot zero if this mode already active |
| Dispatch disabled | SET_DISPATCH_COPS_FOR_PLAYER(player,false) | **No documented prior-state getter**; on disable set true (usual default), disclose possible conflicts with other mods |
| Police ignore player | SET_POLICE_IGNORE_PLAYER(player,true) | Write-only; set false (usual default) on disable, NOT a proof of restoring other mods' prior preference |
| Heal & armor | ped.Health=ped.MaxHealth; ped.Armor=Game.Player.MaxArmor | Deliberate permanent refill, not reversed on disable; never revert health after explosions |
| RPG ammo | HAS_PED_GOT_WEAPON + GET_AMMO_IN_PED_WEAPON; GIVE_WEAPON_TO_PED if missing, else SET_PED_AMMO to 10 only when below | Track preexisting RPG and ammo and selected weapon. Remove newly granted RPG or restore prior ammo on disable; only if original player Ped identity still matches |
| Fixed weather | World.Weather=Clear | Getter available, fail if Unknown; restore weather snapshot; conflicting weather mods may override during test |
| Fixed clock | World.CurrentDayTime=12:00 | Snapshot and restore TimeSpan; no PAUSE_CLOCK, SET_TIME_SCALE or physics freezing |
| Ambient traffic | SET_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME; SET_RANDOM_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME; SET_PARKED_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME | per-frame, broad population control **not truly radius-limited**; only applied when player inside nominated lab radius; stops immediately on exit |
| Ambient pedestrians | SET_PED_DENSITY_MULTIPLIER_THIS_FRAME; SET_SCENARIO_PED_DENSITY_MULTIPLIER_THIS_FRAME | per-frame same limitation; **does not delete existing vehicles/peds**, remove missions, roads, or streaming |
| Additional candidates rejected | SET_EVERYONE_IGNORE_PLAYER, global ENABLE_DISPATCH_SERVICE, SET_ROADS_IN_AREA, CLEAR_AREA_OF_VEHICLES/PEDS, time scale or explosive-bullet cheats | More invasive to ambient behaviors/physics or irreversible from public state; not needed for isolated RPG fracture |

## P2 contract

Run in a **separate locally compiled survey driver** (native/destruction-lab/build_runtime.py);
do **not** enable on normal mod startup, main, or GTA Online:

    x8labsetup enable=1 approved=1 x=<real-centre-x> y=<real-centre-y> z=<real-centre-z> radius=75 population=1
    x8labstatus
    ... x8audit / x8prepare / x8shot / x8walk / x8restore per existing P2 ...
    x8labrestore

- The real audited center coordinates are compulsory; not a teleport, not an IPL/map-loader, and not evidence that the custom lab map loaded.
- Requires player already within radius, Story Mode, idle native contexts (X7/X8).
- Enabled state is volatile at runtime start; setup refuses duplicate activation.
- Sets Interval=0 while active (per-frame multipliers); restores 200 ms at shutdown; active tick continues even if a P2 experiment is in progress.
- Density suppression defaults **ON**, but can be disabled via population=0 to compare with normal ambient population.
- Police and weather/clock effects are globally visible during the enabled period; only the *per-frame density overrides* are gated on player position.
- Disable refuses while X8 lease is active; complete X8 restore first. Script abort attempts cleanup and applies the normal-default police flags.
- The actual installed native SHVDN build could still reject an API or expose a game-specific behavior. Stop before destructive testing if compilation or setup fails; do not guess.
- No automatic RPG firing. No ownership changes, invincible NPCs, physics overrides, forced section fracture, changing X7.3 selector, clearing traffic, or deleting unrelated entities.

## Concrete acceptance and cleanup gates (local)

1. Compile complete generated survey driver against installed SHVDN. Verify loaded script SHA.
2. Story Mode, player inside surveyed radius: before-state wanted/max, invincible, ammo, selected weapon, time/weather; issue setup once and record status.
3. Confirm invincibility, wanted=0, police non-response, RPG ammo, noon/clear sky, population decrease over new spawns while in-radius. The latter is only best-effort; existing actors may remain.
4. Leave radius: density overrides cease without deleting entities, but other global effects remain active until restore.
5. Call restore with no X8 active lease. Verify original snapshots for clock/weather/wanted/invincible/ammo/selected weapon, normal dispatch/ignore defaults, and 200ms interval.
6. Repeat one bounded abort case with **no live fracture** to confirm cleanup, and an invalid-input setup that makes no changes.
7. Preserve source/loaded/installed hashes, log warnings and any uncertain state. Shut down GTA and restore all changed paths/addons via P2 runbook.
8. Do **not** claim exact dispatch/ignore restoration if other mods changed them; report best-effort limitation explicitly.

## Why not just cheat codes?

PAINKILLER expires after five minutes; LAWYERUP removes only one wanted star per invocation. More importantly, console cheats neither provide repeatable state snapshots nor safe P2-controlled status/rollback. Scripted scoped overrides are materially more reproducible.
