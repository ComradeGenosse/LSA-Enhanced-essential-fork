# E0 — Isolated WPS native capability census

This is an EXPERIMENTAL, opt-in, independently loaded GTA V Enhanced RAGE Plugin Hook lab. Nothing is activated on startup. It does not link to Essential, promoted characters, ACT, Memory K, Director, or any gameplay system. **GTA Online / FiveM are prohibited.**

## Genuine SDK build

Use Windows, Node 24, Python 3 and a .NET 8 SDK. From repository root run:

    node tools/native-sdk/compilePhysicsLab.mjs
    dotnet run --project native/physics-e0/tests/CoreTests.csproj -c Release
    python tools/physics-e0/analyze.py --self-test

The builder restores the real NuGet RagePluginHook 1.124.0 SDK, verifies its SHA-256 against the project's production pin, compiles the actual .NET Framework 4.8.1 plugin and produces **dist/physics-e0/LSA.WPS.Lab.dll** plus a build receipt. It does not distribute RagePluginHook.dll, RPH itself, or a fake SDK. The owner's installed RPH 1.132 / GTA 1.0.1158.16 still requires in-game verification; genuine SDK compilation is not a runtime compatibility test.

## Install, operate and roll back

1. Copy only the built LSA.WPS.Lab.dll into your game's **Plugins** directory.
2. Copy LSA.WPS.Lab.example.json to Plugins/LSA.WPS.Lab.json. Set enabled=true only after specifying known isolated single-player test coordinates for x,y,z and targetX,targetY,targetZ. No tests start automatically.
3. For material/thickness experiments, copy LSA.WPS.Lab.samples.example.json to Plugins/LSA.WPS.Lab.samples.json and provide precise CodeWalker-observed surfaces (at least 30 for E0.2, 10 for E0.3). Sample fields: label, ax, ay, az, bx, by, bz, expectedMaterial, materialIndex, expectedThicknessM. Never invent sample coordinates.
4. Load the plugin using RPH in story-mode free roam, then use its console commands.
5. For rollback, issue WPSE0Cancel; unload the plugin, close GTA, and remove the lab DLL/JSON. Logs can be archived separately. No base-game archives or GTA saves are modified.

Commands:

| Console command | Action |
| --- | --- |
| WPSE0Status | Show active test and verdicts |
| WPSE0Start E0.0 | Start exactly one selected probe (E0.0 through E0.12) |
| WPSE0Mode single | E0.4 sample mode: single, burst, auto, shotgun, or npc |
| WPSE0ArmBudget | Single-use arming required before E0.9 |
| WPSE0Cancel | Cancel active probe, delete owned entities, restore reversible mutations |
| WPSE0Reset | Cancel, clean up, clear only in-memory verdicts |

Dangerous operations require **separate explicit JSON opt-ins**: permitBullet, permitExplosion, permitHide, permitIpl and permitTimeScale. All default false. A capped entityLimit (1–2000) controls E0.9, max eight objects created per game frame, with an automatic frame-time watchdog. No test touches an already existing game/ped object. E0.7 requires mapModel and known coordinates; E0.8 requires verified fragModel and child 0–3; E0.11 requires a separately verified vanilla IPL identifier.

The plugin enforces single-player, no cutscene/loading/mission, and a 90-second watchdog. If GTA crashes during a time-scale or IPL test, restart to recover temporary session changes, and validate the original world with probe measurements; do not assume that restoration succeeded. Aggressive experiments are only safe in an empty area, away from civilian peds and vehicles.

## Evidence

Each run writes a timestamped JSONL and a readable .summary.json under Plugins/LSA.WPS.Lab.Results. Every JSONL row is prefixed [WPS-LAB], includes experiment/run ID, game and RPH versions, frame and game/real timestamps and measurement details. The summary includes a plugin fingerprint and p50/p95/p99/max frame time. Optional OpenRPF/ScriptHook presence is recorded; manually note external CodeWalker version and local asset hashes.

To analyze a run:

    python tools/physics-e0/analyze.py "Plugins/LSA.WPS.Lab.Results/example.jsonl"

The analyzer requires valid JSON, monotonic measurements, start/cleanup and a terminal verdict. A crashed/incomplete run is NOT evidence of a pass.

Statuses: NOT_TESTED (never run), OFFLINE_READY (genuine build/test gates passed but no GTA test), GTA_VERIFIED (real measurements obtained, not necessarily positive), BLOCKED (required context or native missing), FAILED (exception, cleanup failure or tool failure). Separately judge each physics hypothesis as works, partial or no.

## Scope restrictions and known gaps

E0.4 records firing edges, ammo deltas, last-impact coordinate snapshots and bullet-area flags. These are not intrinsically unique per-round records, so a true independent shot count is required. The NPC arm is intentionally blocked until an isolated lab-NPC trigger can be validated. E0.6 uses one native bullet per explicit offset against a lab-created target, but a definitive DamageTracker/World.PedShot attribution proof remains unimplemented. E0.5 collision and E0.8 fragment collision require attended traversal/bullet checks beyond the implemented shape probes. E0.9 measures bounded object budget, not RAGE's unbounded theoretical maximum. E0.10 includes passive detection and an opt-in zero-damage explosion plus attended grenade. E0.11 only uses a known operator-configured IPL, not an assumed swap. E0.12 time scaling measures clock ratios, while live debris/bullet behavior still needs visual testing.

No E1/E2 is included. See E0-ACCEPTANCE.md and ASTRA-001 doc 04 for the exact experiment acceptance gates.
