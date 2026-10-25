# VH1 — Vehicle Diagnostics HUD

Status: draft pending pinned Windows compilation and GTA V Enhanced runtime acceptance.

## Access

Drive an ordinary four-wheel car to show the lower-right diagnostic display.
Open **F11 → Vehicle Diagnostics** to select **Off**, **Minimal**, or **Full** (press Select to apply).

The mode is session-only in the menu. To persist it, set this in
`Plugins/LSA.Enhanced.json`:

```json
{ "version": 1, "vehicleHud": { "mode": "full" } }
```

Settings are strict-validated and hot-reloaded. Allowed values are `off`,
`minimal`, `full`. Full is the default. The overlay runs independently
of the character menu; no cheat action or vehicle repair is required.

## Direct, inferred, and unavailable signals

| Display | Source | Interpretation |
| --- | --- | --- |
| Engine | RPH `Vehicle.EngineHealth` | True engine health, /1000 |
| Body | `GET_VEHICLE_BODY_HEALTH` | True aggregate body-health value, /1000; NOT a part-by-part deformation map |
| Fuel tank | RPH `Vehicle.FuelTankHealth` | True tank health, /1000 |
| Four tire blocks | GTA `IS_VEHICLE_TYRE_BURST` IDs 0, 1, 4, 5 | Burst/not-burst on ordinary four-wheel cars; an intact tire does NOT prove the rim or axle is sound |
| Possible left/right drift | RPH velocity + vehicle right vector + steering angle + ground state | Inferred lateral motion while mostly steering straight; NOT a measured alignment defect |
| Brakes, suspension and detached wheel health | N/A | No verified source from installed damage mods |

The lateral-motion hint requires at least 1.6s of sustained samples, forward
speed >=14 m/s, steering angle <=1.5 degrees and four-wheel ground contact. It
rejects very large slides, reversing and low speed. Road camber, wind, game
physics, drift and driving inputs can still cause false positives.

Damage history is a **five-entry, per-car session ring**, not persisted to NPC
memories or disk. It detects engine/body/tank health drops >=8 HP, repairs
>=40 HP, tire burst transitions and sustained lateral drift. Reset happens
on vehicle switch, exit, pause or feature disable.

## Code boundaries

- `VehicleDamageTimeline.cs`: pure game-API-free transition and drift logic;
  covered by UX offline tests.
- `VehicleHudController.cs`: 5 Hz vehicle sampling on the existing loader
  GameFiber; publishes snapshots; FrameRender paints the wireframe diagram.
- `EnhancedHost.cs`: feature lifecycle and settings hot-reload.
- `NativeMenu.cs`: F11 controls and event list.

The sampler **never writes** vehicle properties or handling data. Unexpected
native/draw failures disable only this feature; all other LSA services continue.
Requires the pinned real RPH/RNUI references for a production compile.

## GTA V Enhanced acceptance (not performed yet)

1. Start with a healthy ordinary 4-wheel car: panel appears in full mode;
   percentages reflect the car's current real values; no fake damage log.
2. Damage engine, body and tank independently: values drop and event entries
   appear once; verify color and labels at 1080p and 4K.
3. Puncture each wheel including both rear tires: matching corner changes
   color; repair resets it. Detached-wheel-only mods must not be mislabeled.
4. Drive straight on level pavement at >14 m/s: no hint normally. Apply an
   actual tire/alignment/physics effect: lateral-motion hint may appear only
   under stable conditions, labeled inferred. Cornering, braking, drift and
   reverse should not produce a confirmed alignment diagnosis.
5. F11 → Vehicle Diagnostics: Off, Minimal, Full modes update immediately
   when selected. Hot-reloaded configuration overrides session mode.
6. Exit vehicle, change cars, pause, reload plugins, then stop RPH: no stale
   reading, orphan event hook, or telemetry on pedestrians/passengers.
7. Test an add-on car, a six-wheel vehicle, a bike, and a wheel-detach mod:
   no crash; unknown mod-specific component damage stays unavailable.
8. Test alongside the separate cheat-menu branch, including vehicle repair:
   immediate state refresh without driving physics changes.

Offline: `dotnet run --project native/enhanced/input-tests/InputTests.csproj --configuration Release`.
Pinned production compile: `node tools/native-sdk/compileProductionNative.mjs`.
