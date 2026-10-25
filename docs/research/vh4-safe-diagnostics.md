# VH4 — Gameplay-safe vehicle diagnostics

**Everything new defaults OFF each session.** No graphics/physics hooks, memory writes or scans during ordinary gameplay.

## Crash flight recorder (5 Hz)

Use F11 / L4+R4 → All tools & settings → Cheat Menu → Vehicle Options → Vehicle Diagnostics → **Crash flight recorder (5Hz)**.

The recorder uses existing HUD readings at 5 Hz: the 10 seconds before a detected body-health fall of 20+, engine-health fall of 25+, or a known native puncture transition, plus 8 seconds afterward. A bounded ring retains at most 110 records per incident and at most 10 incidents per plugin session, with a 12-second cooldown. No extra dense deformation calls are performed while driving. Each row includes relative and UTC timestamps, model, engine/body/tank status, raw wheel/tire slots and validity masks, the four ordinary fixed deformation probes, verified tire bursts, speed, steering and lateral motion.

Completed incidents queue in memory (maximum two), and are written ONLY when the car is parked at 0.5 m/s or less or when the driver exits. Any excess event is dropped rather than expanding memory or interfering with play. Files: Plugins/LSA/Logs/VH3/flight-*.csv. File writes are capped at 120 KiB each, 10 files and approximately 1.2 MiB per plugin session. No existing files are overwritten. On I/O error, only flight logging stops.

Three consecutive optional health reads over 8 ms disable optional loggers. A single incident write over 15 ms disables further flight recording. Game/RPH messages have VH4 prefix. These are safeguards, NOT guarantees of hitch-free performance.

## Dense parked VH3 scans

The separate **VH3 deformation experiment** still collects the full 48 local XYZ vectors plus forensic diagnostics sidecar from each paired before/after snapshot. It now cancels when speed is above 0.5 m/s or unknown, never probes while driving, limits each existing 200 ms tick to six calls AND roughly 2.5 ms of sampling work, and disables itself if an individual call exceeds 8 ms or a full sweep exceeds 20 seconds. Each capture pair is limited to 96 KiB output and new data to around 2 MiB per session. Errors remain isolated.

## Suggested first test

1. Enable Crash flight recorder while driving a stock undamaged car.
2. Park and enable VH3; capture undamaged baseline while stopped.
3. Crash one corner visibly, then park. The flight recorder will save its history.
4. Capture damaged VH3 snapshot while stopped.
5. Share both 48-point CSVs, both diagnostics sidecars, the flight CSV, GTA screenshots and VH3/VH4 log messages.

Use tools/vehicle-deformation/audit_capture.py to assess paired probe reliability.

**Limitations:** Flight logs are ordinary telemetry surrounding a collision, not 48-point scans during impact. All-zero native vectors remain ambiguous. This does not expose every rendered vertex, exact car panels, mod-specific damage internals or verified live mesh deformation. Actual in-game Enhanced runtime testing is still required.
