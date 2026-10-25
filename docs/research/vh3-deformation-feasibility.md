# VH3-A — Live vehicle deformation capture feasibility

**Status:** Implementation candidate only. No GTA runtime capture has occurred. **VH3-B is NO-GO pending actual game data**, even if Windows compilation and offline tests pass.

## Hypothesis

`GET_VEHICLE_DEFORMATION_AT_POS` returns a local-space Vector3 at offsets near a car's visible damaged surface. A model-scaled probe set might reveal *where* its appearance changes. This does **not** prove access to the rendered vehicle mesh, individual drawable vertices, detached panels, or ImmersiveSantos's internal state.

The previous HUD implementation measured only four fixed magnitudes, and screenshots showed zero max deformation despite decreased body health. Therefore even a plausible-looking sample must be compared against a physical GTA crash before committing to mesh reconstruction.

## Isolation and capabilities

- Experimental branch: `experiment/vh3-deformation-census`, stacked on combined PR #327.
- The normal full/minimal/off HUD, vehicle search, cheats, and NPC quick menu remain unchanged.
- `VehicleDeformationGrid.Build` creates **48 model-relative offsets** from `Rage.Model.GetDimensions(out min,out max)`: 9 front, 9 rear, 12 left, 12 right and 6 roof, on a narrow inset exterior shell. These are **approximate sample zones**, not authenticated panels.
- Dimensions are rejected if nonfinite, degenerate or unreasonable. The lab never falls back to made-up size values.
- `VehicleDeformationLab` samples **six offsets per existing 200ms loader tick** (eight batches total). This bounds per-tick game-native work; profiling is still required. Each native call has its own exception guard.
- It records **full dx/dy/dz vectors**, magnitude, validity and source offset. Nonfinite and implausibly large values are invalid, while a real returned zero vector is preserved as a valid zero. A valid zero does **not** prove a region is undamaged.
- **No continuous deformation polling**, vehicle changes or memory writes; only explicit snapshot requests while the experiment is enabled.
- Each full capture writes one bounded 48-row CSV to `Plugins/LSA/Logs/VH3/`. The session allows at most 20 captures; files are not overwritten or rotated. Failures show a message and never alter GTA physics or the production HUD.
- Baseline and damaged captures must originate from the same **vehicle handle** and session capture ID; leaving the vehicle or changing cars while capture runs cancels the sweep.

## How to capture inside GTA Enhanced

Use an ordinary car in **Story Mode**, ideally in a safe empty location. Do not test multiplayer or use RPH/graphics hooks outside the installed supported APIs.

1. With LSA experimental DLL installed, open **F11 / controller L4+R4 → Quick Controls → All tools & settings → Cheat Menu → Vehicle Options → Vehicle Diagnostics**.
2. Toggle **VH3 deformation experiment** ON. It is OFF every session.
3. Park, leave the car intact, and select **Capture undamaged baseline**. Do not move or damage the car during the eight incremental probe batches. Wait for `SAVED baseline 48/48 VALID` (or inspect any lower count).
4. Save a top-down, side and front/rear screenshot of the undamaged model. Keep them outside the repository or with explicit consent.
5. Drive the same car into a wall so that **one specific body region clearly crumples**, without destroying the vehicle. Stop and select **Capture after impact**. Wait for `SAVED damaged …`.
6. Copy the two CSV paths announced in `RagePluginHook.log`, marked `[VH3] saved`. Preserve the original pair.
7. Repeat **new baseline + damaged** pairs for front-left, front-right, front center, rear, left and right impacts; use a repaired or fresh car as appropriate. Repeat at least three controlled impacts for each claimed signal.
8. Also test **body HP loss without obvious deformation**, **strong visible deformation with low body HP change**, and **vanilla repair**. Do not infer mesh state from GTA's aggregate health counters.

Make sure the game is not paused during the capture itself. The feature does not move cars, trigger impacts, or repair anything.

## Offline visual comparison

Using Python 3 on your local machine, with no packages or installation required:

```powershell
python tools/vehicle-deformation/compare_capture.py "C:\...\baseline.csv" "C:\...\damaged.csv" --out "C:\...\vh3-comparison.svg"
```

The tool checks capture ID, vehicle handle, model and probe positions and produces an **SVG top-down displacement map**: teal small change, amber moderate change, red larger change, gray unknown. Displacement arrows are magnified 37× for readability and are **not a geometric reconstruction**. Roof points may overlap in projection. The color thresholds (0.05/0.15 native units) are **provisional research thresholds**, not calibrated severity bands.

## Evidence and decision gate

For each trial record game version, RPH version, model, image of visible damage, before/after engine and body health, capture validity, 48 raw vectors, per-region change statistics, and approximate probe overhead. Note a signal as **unavailable**, **zero/unchanged**, or **changes reproducibly**. Avoid labeling unverified returned vectors as a car crash location.

**Candidate GO for VH3-B only if ALL hold:**
- At least 40/48 usable before/after matching probes for typical four-wheel stock cars across trials.
- Repeatable localized displacement changes in visibly crushed zones, differing from intact zones and from unaffected controls.
- Measured changes survive parking and can be distinguished from ordinary motion/suspension displacement.
- No crashes, instability, interference with Essential/LSA, or unacceptable frame spikes during eight short capture batches.
- Successful repair/reset interpretation (which may legitimately not erase all mod-specific damage).
- Physical GTA validation completed and logged.

**NO-GO / investigate render or fragment model instead if:**
- Deformation remains zero or essentially uniform despite unmistakable localized visual crushing.
- Readings appear in wrong regions or vary strongly with vehicle motion alone.
- Calls or vector decoding fail on the actual Enhanced build.
- Probe cost causes unacceptable hitching, or model types cannot be sampled reliably.

If the native approach is insufficient, investigate offline `.yft` fragment mesh extraction and controlled DX12 frame capture **as a separate research proposal**, with read-only experiments and no unverified engine memory offsets.

## Implementation boundaries and references

- `native/enhanced/VehicleHud/VehicleDeformationExperiment.cs` — pure model bounds, 48-point grid, validation and CSV formatting.
- `native/enhanced/VehicleHud/VehicleDeformationLab.cs` — opt-in game-fiber sampler with six calls per tick and one-shot export.
- `native/enhanced/VehicleHud/VehicleHudController.cs` — existing host integration, no edits to HUD visuals.
- `tools/vehicle-deformation/compare_capture.py` — offline CSV pair comparison and SVG.
- `native/enhanced/input-tests/Program.VehicleHud.cs` — RPH-independent grid/export coverage.

Native API references: https://docs.ragepluginhook.net/html/M_Rage_Model_GetDimensions.htm and https://github.com/citizenfx/natives/blob/master/VEHICLE/GetVehicleDeformationAtPos.md . Both establish documented interfaces, not compatibility with this installed Enhanced build.

**Runtime results:** NOT RUN. **Performance timings:** NOT MEASURED. **Decision:** VH3-B NOT AUTHORIZED until actual GTA evidence meets the gate.
