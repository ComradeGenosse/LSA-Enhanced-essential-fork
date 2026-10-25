# Unified LSA Quick Controls and Cheat Menu — implementation candidate

The controller **L4 + R4** chord-hold and **F11** now open the same **Quick Controls** dashboard. A stable eight-row layout shows actual status and common actions without losing the existing F11 menu pages. **All tools & settings** opens the existing advanced menu, including **Cheat Menu**, **Vehicle Options**, **Vehicle Favorites**, and **Player Options**.

Quick Controls shows vehicle status (when telemetry exists), repair (disabled on foot), vehicle HUD Off/Minimal/Full (session override), player invincibility ON/OFF, actual wanted stars, current NPC context, vehicle favorites, and the advanced menu. NPC actions open the existing identity-fenced Current NPC page, which remains accessible from advanced tools too.

This implementation does not yet include general NPC/prop spawning, weather, teleportation or permanent police suppression.

## Controls

Quick Controls → All tools & settings → Cheat Menu → Vehicle Options:
- Repair / clean / set current vehicle on ground (you must be inside a vehicle).
- Spawn vehicle by model: enter a GTA model name, including installed addon models.
- Save current vehicle as favorite (if its model name can be resolved).
- Add favorite by typed model name (supports addon vehicles not yet in the world).
- Favorites submenu: spawn or remove each saved model.
- Delete last spawned vehicle (only a vehicle created by this menu, and only if
  its occupant checks are clear).

Quick Controls → All tools & settings → Cheat Menu → Player Options: restore health, armor, clear wanted level,
toggle invincibility.


## Vehicle diagnostics and mod telemetry

Quick Controls also allows changing the HUD mode immediately. The full diagnostic page is under **All tools & settings → Cheat Menu → Vehicle Options → Vehicle Diagnostics**.

HUD sampling remains read-only. Direct GTA engine, body, fuel tank and burst-tire values are separate from per-wheel RPH `Health` and `TireHealth` getters, with the latter displayed as **raw, Enhanced-runtime-unverified wheel slots** rather than mapped corners or calibrated health percentages. Four fixed `GET_VEHICLE_DEFORMATION_AT_POS` samples display anonymous chassis probe magnitudes only. Major body damage, raw wheel/tire declines and chassis-probe changes appear in a bounded per-vehicle event history.

**No verified API exposes ImmersiveSantos's brake-failure flag, steering bias, internal engine damage, or named suspension faults.** Those remain unavailable; lateral movement remains merely an inferred hint. Runtime validation in GTA Enhanced with the actual installed mod stack is necessary before presenting additional damage claims. See `docs/vehicle-diagnostics-vh1.md`.

## Persistence / limitations

Favorites are stored in `GTA5_Enhanced.exe/Plugins/LSA.CheatFavorites.json`
(version 1, at most 32 normalized model names). They are independent of P2
character memories, the companion, browser editor and AI providers. The file is
created on the first favorite change. It is bounded, validated and written via
an atomic temp-file replacement. No game entities persist in the favorites file.

Model spawning uses RPH's validated `Rage.Model` and `Rage.Vehicle` constructor,
with a max of 16 simultaneously tracked vehicles. No auto-teleport into seats,
no deletion of ambient/character vehicles. Restarting the plugin clears *the
session's spawned-vehicle tracking*, not the favorites.

Car repair uses RPH's normal vehicle repair methods; third-party handling and
damage mods may have additional state that this does not reset. The native
ground-placement helper may fail on obstructed geometry.

## Verification and release

- [ ] Build exact RPH/RNUI-pinned production project on Windows:
  `node tools/native-sdk/compileProductionNative.mjs`
- [ ] Run pure UX tests including persistence:
  `dotnet run --project native/enhanced/input-tests/InputTests.csproj -c Release`
- [ ] GTA Enhanced acceptance: F11 and L4+R4 open the same quick root, quick/advanced Back navigation, F7 coexistence, spawn stock/addon
  vehicle, invalid model refused, repair/clean/flip, add/spawn/remove/restart
  favorites, occupancy-protected deletion, player actions, paused/cutscene
  safety, plugin reload and log review.
- [ ] Confirm exact deployed DLL hash and game/RPH/Essential versions. Do not
  interpret GitHub/CI success as gameplay validation.

Rollback: revert this isolated change and redeploy the prior loader DLL. Back
up/remove `Plugins/LSA.CheatFavorites.json` only if you no longer want favorites.
