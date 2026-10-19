# E0 — Isolated WPS native capability census

This is an EXPERIMENTAL, opt-in, independently loaded GTA V Enhanced RAGE Plugin Hook lab. Nothing is activated on startup unless the operator explicitly enables the **read-only pre-shot suite** via `autoRunPreShot: true`. The startup suite can never run E0.4+. It does not link to Essential, promoted characters, ACT, Memory K, Director, or any gameplay system. **GTA Online / FiveM are prohibited.**

## Genuine SDK build

Use Windows, Node 24, Python 3 and a .NET 8 SDK. From repository root run:

    node tools/native-sdk/compilePhysicsLab.mjs
    dotnet run --project native/physics-e0/tests/CoreTests.csproj -c Release
    python tools/physics-e0/analyze.py --self-test

The builder restores the real NuGet RagePluginHook 1.124.0 SDK, verifies its SHA-256 against the project's production pin, compiles the actual .NET Framework 4.8.1 plugin and produces **dist/physics-e0/LSA.WPS.Lab.dll** plus a build receipt. It does not distribute RagePluginHook.dll, RPH itself, or a fake SDK. The owner's installed RPH 1.132 / GTA 1.0.1158.16 still requires in-game verification; genuine SDK compilation is not a runtime compatibility test.

## Install, operate and roll back

1. Copy only the built LSA.WPS.Lab.dll into your game's **Plugins** directory.
2. Copy `LSA.WPS.Lab.example.json` to `Plugins/LSA.WPS.Lab.json`, set `"enabled": true`. You can leave coordinates at zero for the unattended E0.0/E0.1 smoke tests: E0.1 uses a read-only player-local fallback ray. For the material/wall acceptance probes and all destructive tests, you must still supply real, verified locations. By default **no tests start automatically**; use `WPSE0Auto`, or explicitly set `"autoRunPreShot": true` to run the safe sequence after loading the plugin.
3. For material/thickness experiments, copy LSA.WPS.Lab.samples.example.json to Plugins/LSA.WPS.Lab.samples.json and provide precise CodeWalker-observed surfaces (at least 30 for E0.2, 10 for E0.3). Sample fields: label, ax, ay, az, bx, by, bz, expectedMaterial, materialIndex, expectedThicknessM. Never invent sample coordinates.
4. Load the plugin using RPH in story-mode free roam, then use its console commands. A safe pre-shot suite requires no movement or shooting. RPH must load the DLL; merely putting it in `Plugins` is not proof that it is loaded.
5. For rollback, issue WPSE0Cancel; unload the plugin, close GTA, and remove the lab DLL/JSON. Logs can be archived separately. No base-game archives or GTA saves are modified.

Commands:

| Console command | Action |
| --- | --- |
| WPSE0Status | Show active test, safe-suite progress, manifest filename and verdicts |\n| WPSE0Auto | Start unattended, **read-only E0.0 -> E0.1 -> E0.2 -> E0.3**; stops before E0.4 |
| WPSE0Start E0.0 | Start exactly one selected probe (E0.0 through E0.12) |
| WPSE0Mode single | E0.4 manual fire modes (single, burst, auto, shotgun, npc); E0.9 modes props or fragments |
| WPSE0ArmBudget | Single-use arming required before E0.9 |
| WPSE0Cancel | Cancel active probe, delete owned entities, restore reversible mutations |
| WPSE0Reset | Cancel, clean up, clear only in-memory verdicts |

Dangerous operations require **separate explicit JSON opt-ins**: permitBullet, permitExplosion, permitHide, permitIpl and permitTimeScale. All default false. A capped entityLimit (1–2000) controls E0.9, max eight objects created per game frame, with an automatic frame-time watchdog. No test touches an already existing game/ped object. E0.7 requires mapModel and known coordinates; E0.8 requires verified fragModel and child 0–3; E0.11 requires a separately verified vanilla IPL identifier.

The plugin enforces single-player, no cutscene/loading/mission, and a 90-second watchdog per probe. If GTA crashes during a time-scale or IPL test, restart to recover temporary session changes, and validate the original world with probe measurements; do not assume that restoration succeeded. Aggressive experiments are only safe in an empty area, away from civilian peds and vehicles.

## Unattended, remote-friendly pre-shot suite

**Option A: one console command.** With `enabled: true` and the plugin loaded, enter `WPSE0Auto` once. It runs E0.0–E0.3 sequentially and stops automatically. Use `WPSE0Status` for progress and `WPSE0Cancel` to stop. No second GTA launch is needed. All intrusive permit flags can remain false. The suite does **not** run E0.4, shoot, spawn actors/props, change time scale, hide geometry, toggle IPLs or trigger explosions.

**Option B: no console interaction after RPH loads the plugin.** In `Plugins/LSA.WPS.Lab.json`, set `"enabled": true` and `"autoRunPreShot": true`. Load the DLL using RPH; the runner waits up to 15 minutes for an actual game player ped in safe story-mode free roam, then executes the same E0.0–E0.3 plan automatically. It will not run in GTA Online, missions, cutscenes or while loading. Both `enabled` and `autoRunPreShot` must be true. Keep `autoRunPreShot` false when you want to run manual tests without the suite starting.

**What is and isn't automatic:** E0.0 needs no setup. E0.1 tests read-only native callability; without configured locations, it uses a short ray near the player and records that it was uncalibrated. E0.2 only verifies material hashes if **30 actual CodeWalker-labeled surface samples** were preloaded. E0.3 only checks **10 CodeWalker-measured wall samples** if preloaded. If either dataset is missing, the suite writes a `BLOCKED` run and explicit reason; it does not manufacture material labels, wall thickness or a verified pass. You can still get useful E0.0/E0.1 logs while away from home. E0.4 manual/player shots and the optional separately authorized NPC-shooter run are outside this unattended suite.

**Evidence upload without hunting through files:** The GitHub CI download includes `pack-pre-shot.ps1`. On your home PC, run `powershell -ExecutionPolicy Bypass -File .\\pack-pre-shot.ps1 -GameRoot "C:\\PATH\\TO\\GTA V Enhanced" -OutputDirectory "$env:USERPROFILE\\Desktop"` from the extracted artifact folder. It packages the latest `.suite.json` and the specific JSONL/summary files listed in that manifest into one ZIP. The script never includes your config or unrelated game logs. Upload that ZIP here for review. The suite manifest is also readable on its own.\n\n**Remote session note:** GTA/RPH physics and fibers may stop advancing if GTA loses focus or the remote solution suspends its rendering/game loop. Use a streaming-control solution that leaves the game running on the host (e.g. Sunshine/Moonlight or Parsec) rather than assuming Windows RDP will preserve an active GTA session. The safe suite is frame-driven, not a Windows background job; logs and its `.suite.json` manifest show what actually completed.

## Evidence

Each probe run writes a timestamped JSONL and a readable `.summary.json` under `Plugins/LSA.WPS.Lab.Results`. Each unattended invocation additionally writes one `*-pre-shot-*.suite.json` manifest with per-probe statuses, reasons, log filenames and unmet ground-truth prerequisites; upload these files together for review. Every JSONL row is prefixed [WPS-LAB], includes experiment/run ID, game and RPH versions, frame and game/real timestamps and measurement details. The summary includes a plugin fingerprint and p50/p95/p99/max frame time. Optional OpenRPF/ScriptHook presence is recorded; manually note external CodeWalker version and local asset hashes.

To analyze a run:

    python tools/physics-e0/analyze.py "Plugins/LSA.WPS.Lab.Results/example.jsonl"

The analyzer requires valid JSON, monotonic measurements, start/cleanup and a terminal verdict. A crashed/incomplete run is NOT evidence of a pass.

Statuses: NOT_TESTED (never run), OFFLINE_READY (genuine build/test gates passed but no GTA test), GTA_VERIFIED (real measurements obtained, not necessarily positive), BLOCKED (required context or native missing), FAILED (exception, cleanup failure or tool failure). Separately judge each physics hypothesis as works, partial or no.

## Scope restrictions and known gaps

E0.4 records firing edges, ammo deltas, last-impact coordinate snapshots and bullet-area flags. These are not intrinsically unique per-round records, so a true independent shot count is required. The NPC arm creates and commands a separate lab-owned ped only after the explicit permitBullet opt-in and safe-site checks. It never tasks an Essential- or P2-managed ped; the native per-round impact evidence still needs GTA validation. E0.6 uses one native bullet per explicit offset against a lab-created target, but a definitive DamageTracker/World.PedShot attribution proof remains unimplemented. E0.5 collision and E0.8 fragment collision require attended traversal/bullet checks beyond the implemented shape probes. E0.9 measures bounded object budget, not RAGE's unbounded theoretical maximum. E0.10 includes passive detection and an opt-in zero-damage explosion plus attended grenade. E0.11 only uses a known operator-configured IPL, not an assumed swap. E0.12 time scaling measures clock ratios, while live debris/bullet behavior still needs visual testing.

No E1/E2 is included. See E0-ACCEPTANCE.md and ASTRA-001 doc 04 for the exact experiment acceptance gates.

For E0.9, use WPSE0Mode props or WPSE0Mode fragments, set an actual verified fragModel for the latter, then arm and start each run independently. For E0.10, config explosionType may be 0–14; repeat separate opt-in runs for each type and preserve all logs. Both variants remain disabled until explicitly started.
