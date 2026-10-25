# F11 Cheat Menu — first implementation candidate

This adds a **Cheat Menu** entry to the existing RAGENativeUI F11 menu. The first
implementation covers gameplay-only **Vehicle Options**, **Vehicle Favorites** and
**Player Options**. It does not yet implement general NPC/prop spawning, weather,
teleportation or persistent police suppression.

## Controls

F11 → Cheat Menu → Vehicle Options:
- Repair / clean / set current vehicle on ground (you must be inside a vehicle).
- Spawn vehicle by model: enter a GTA model name, including installed addon models.
- Save current vehicle as favorite (if its model name can be resolved).
- Add favorite by typed model name (supports addon vehicles not yet in the world).
- Favorites submenu: spawn or remove each saved model.
- Delete last spawned vehicle (only a vehicle created by this menu, and only if
  its occupant checks are clear).

F11 → Cheat Menu → Player Options: restore health, armor, clear wanted level,
toggle invincibility.

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
- [ ] GTA Enhanced acceptance: F11 open/back/F7 coexistence, spawn stock/addon
  vehicle, invalid model refused, repair/clean/flip, add/spawn/remove/restart
  favorites, occupancy-protected deletion, player actions, paused/cutscene
  safety, plugin reload and log review.
- [ ] Confirm exact deployed DLL hash and game/RPH/Essential versions. Do not
  interpret GitHub/CI success as gameplay validation.

Rollback: revert this isolated change and redeploy the prior loader DLL. Back
up/remove `Plugins/LSA.CheatFavorites.json` only if you no longer want favorites.
