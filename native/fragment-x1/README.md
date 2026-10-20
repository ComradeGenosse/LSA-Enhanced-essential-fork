# ASTRA-001 X1 native fragment lab

Isolated ScriptHookVDotNet Enhanced 3.9 experiment for GTA V Enhanced, offline Story Mode only. This is a lab script, not an LSA/Essential integration or a production destruction system. Originally implemented by Claude; resumed and measured by Codex on 2026-10-20.

## Run

1. Back up any existing `scripts/WpsBreachLab.3.cs` and `WpsBreachLab/` evidence directory.
2. Copy `WpsBreachLab.3.cs` into the installed game's `scripts` directory. Use the existing SHV/SHVDN installation. Do not start RAGE Plugin Hook or GTA Online for this experiment.
3. Start Story Mode using the existing Steam launch path. If already running, reload scripts using the configured SHVDN reload key (Insert on the tested installation).
4. Check `WpsBreachLab/status.json`: the loaded script SHA must match the installed file, with a fresh `loadedUtc`. File deployment alone does not prove loading.
5. Copy `panel-tests.txt` to `WpsBreachLab/command.txt`. The script consumes each batch once and writes a run directory containing `trials.jsonl` and `summary.jsonl`. Wait for `state=DONE`; inspect error rows too.
6. The batch deletes its disposable entities and restores the player's position and invincibility. Restore the backed-up script after testing. Keep raw evidence local; publish only reviewed, sanitized evidence.

No game assets, custom models, asset pipeline, physics engine, production LSA code, or mod configuration changes are required.

## What the panel experiment establishes

Five adjacent vanilla corrugated fence panels form a barrier. A native grenade explosion targets the middle panel. Bidirectional ray grids and swept spheres measure collision; a disposable lab-owned ped receives a straight-walk task through the opened panel and against an intact panel. This demonstrates ped traversal, not an attended human player throw-and-walk acceptance session.

The script's `blast` test labels complete single-panel removal `PANEL_REMOVED_ENTIRE` or, for some earlier cases, `BROKEN_NO_OPENING`. Read the raw measurements; those labels do not imply that collision remained. The `line` command separately tests a gap in a larger barrier.

## Measurement changes in X1-0.2

- `line` retains debris by default. `cleardebris=1` explicitly requests a cleanup-assisted measurement; use it only as a diagnostic and label it accordingly.
- Panel opening fractions count baseline root-blocked rays that become completely clear. Root collision removal and residual obstruction are recorded separately.
- Walking records maximum lateral displacement. A crossing over 0.6 m off the commanded lane is classified `crossed_off_lane`; a vertical gain over 0.35 m is classified `crossed_climbed`. Neither satisfies the line success verdict.
- The original X1-0.1 line test removed debris before measurements. Its evidence is retained with that limitation.

`detachedProps` includes new nearby props as well as explicit detached-parent flags. Prefer the raw `flaggedDetached` rows when assessing native detachment. A fragment group's count alone is not breakage evidence. Grid connected-component bounds are not guarantees that the whole bounding rectangle is clear; swept spheres and actual walking provide the additional checks.

## Local compile check

Compile as a library against the installed `ScriptHookVDotNet3.dll`, `System.Windows.Forms.dll`, and `System.Drawing.dll` using the existing .NET Framework C# compiler. Do not redistribute GTA/SHVDN binaries. The tested build has existing obsolete-API and unused-field warnings; the in-game SHVDN compiler and loaded SHA are the runtime authority.

See `docs/next-gen-gameplay/astra-001/07-X1-RESULTS-20261020.md` for evidence, scope, and verdicts.
