# X2 anchored native concrete wall lab

Experimental continuation of X1, offline Story Mode only. This is not production LSA integration. Read `ACCEPTANCE.md` before testing. A successful export or loaded fragment is not a destruction pass.

## Build and deploy

1. Run Blender 5.2.2 with Sollumz 2.9 enabled: `blender.exe -b --python native/fragment-x2/build_wall.py`.
2. Run `convert_xml.ps1 -CodeWalker <existing CodeWalker30_dev48 directory>` to import the original Sollumz XML, convert to GEN9 and reload-check the binary; then run `build_pack.ps1 -CodeWalker <existing CodeWalker30_dev48 directory>` in PowerShell. It writes an OPEN RPF containing only original generated assets and package metadata. Old builds are retained locally as `.previous-*`, excluded from Git.
3. Close GTA with `tools/gt4_stop.ps1`. This is Claude's existing shutdown helper, copied without changing its behavior.
4. Run `deploy.ps1 -GameRoot <installed Enhanced root> -BackupRoot <private local backup directory>`. It preserves the original SHVDN lab script and DLC list once, copies the pack/script, and adds one Onigiri line. Never modify a running game's archive.
5. Use `tools/launch-shvdn.ps1 -GameRoot <root>`. This adapts Claude's GT4 loaded-hash check to the existing X1 Steam/SHVDN path. The original RPH launcher expects a private GT4 DLL; starting that would not validate this SHVDN experiment. Keep GTA focused while loading. If Steam is still stopping the previous session, let it finish before relaunching.
6. Verify a fresh `WpsBreachLab/status.json` with the installed source SHA and X2 version. Copy a command batch to `WpsBreachLab/command.txt`. First run `anchored explosive=none variant=physical hold=20`; proceed only after a fully solid baseline.
7. Run `smoke-tests.txt`, then expand only when its controls and repeated blasts meet the preregistered criteria. Allowed parameters: `variant=physical|frozen|static`, `explosive=none|grenade|sticky|rocket`, `du` (wall-local horizontal meters), `height` (meters), `dx` (front offset), `scale` (native damage scale), `hold` (seconds per screenshot hold).
8. Collect evidence with `tools/collect-evidence.ps1`. Review results and preserve failed/crashed runs. The collector removes process IDs, absolute error stacks and private site rows; it does not turn partial measurements into passes.

The X2 script extends the existing X1 class and file bridge, transport gate, native explosion calls, debris parent checks, shape tests, cleanup and ped walking. `NativeRay` uses map+object flags 17 and option 0, forward and reverse. Swept spheres retain X1's radius .30, four heights, unresolved-as-blocked policy. A scripted camera observes the test; it is deleted during cleanup.

The wall is 30 original box chunks, each .5 × .5 × .2 m, each 120 kg at concrete density 2400 kg/m³. It has one root, one bound per bone, a concrete collision material, an embedded original flat diffuse texture, native GEN9 YFT version 171, and a Dynamic YTYP. Outer columns and the root are reinforced; group force transmission uses the Sollumz default .25. The current physical variant uses a native fixed joint to a frozen, invisible stock concrete barrier with collision disabled. It preserves wall dynamics; static and frozen variants remain diagnostics. Frozen entities suppressed breakage in the stock fence control. Only native fragment physics may release chunks. There is no script-side deletion to make a hole, custom damage solver, replacement framework, persistence or vanilla wall excision.

To roll back, stop GTA and restore the backed-up script and DLC list, and leave the generated pack unreferenced. The original X1 files remain available under `native/fragment-x1`.

## Sources

- Approved repo plan: `docs/next-gen-gameplay/astra-001/06-MASTER-PLAN-explosion-destruction-20261020.md`, Task 2.
- X1 source and evidence: parent commit `3fa135c4`.
- Installed Sollumz 2.9 source for fragment grouping, physics-child drawables, collider flags, archetype flags and exporter APIs.
- https://docs.sollumz.org/2.6/documentation/fragments.yft/prop-setup
- https://docs.sollumz.org/documentation/archetype-definition.ytyp/archetype-flags
- Existing installed NVE content/setup structure used as a local packaging reference; no NVE asset or archive is redistributed.




## Current result

QUALIFICATION IN PROGRESS. X2-0.10 produced a measured native rocket breach with anchored outer columns, native wall debris, a 1.5 m swept opening and direct ped crossing. Full repeatability/locality gates remain open. Earlier static tests moved the whole wall and were rejected. See `docs/next-gen-gameplay/astra-001/09-X2-CONTINUATION-20261021.md` (and the historical 08 checkpoint) and the adjacent evidence directory. No fundamental engine limitation has been established.
