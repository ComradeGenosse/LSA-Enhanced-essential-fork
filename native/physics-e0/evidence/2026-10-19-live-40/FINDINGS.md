# E0 live GTA run — 19 October 2026

The current PR #285 Windows artifact executed E0.0–E0.3 in GTA V Enhanced single-player on RPH 1.132. All 40 physics samples were evaluated. The suite completed and restored the player and original-area collision. Runtime execution succeeded; the complete geometry/material hypotheses are **not accepted**.

## Provenance and deployment

- PR head: `aa7eb3672ba83a2aa9622c5d61f66daabe3b9939`.
- Successful Windows CI: [run 39251170076](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39251170076), artifact `12186111063`.
- ZIP SHA-256: `2af4cede5621e5cf0fca7dce1449e8b2cf15e01380338294cfe35ab05aca85d5`, matching GitHub's artifact digest.
- DLL SHA-256: `4fe24f25173397dfde0ec17b591b88a0d5f13b8e6f5bb5cd35fdc40fc24a5618`, matching BUILD-RECEIPT.json and the installed DLL before and after the run.
- Artifact installer used against the actual Steam Enhanced installation. `enabled`, `autoRunPreShot`, `autoTeleportForSamples` are true; `permitExplosion`, `permitBullet`, `permitIpl`, `permitHide`, `permitTimeScale` are false.
- Previous private sample ZIP supplied 30 surfaces and 10 walls. Regeneration from local CodeWalker candidates and offline ray verification produced semantically identical samples. Byte hashes differ only in serialization. The sample JSON and provenance remain private.
- Runtime: GTA Enhanced `1.0.1158.16`, RPH `1.132.1428.17748`. Existing `ReloadAllPlugins` loaded the current DLL. No gameplay code, existing LSA systems, main, or online mode was changed.
- Suite `300c6937234f4d999e43c53a59e31d2a`, 08:30:45–08:30:51 EDT (12:30 UTC).

## Verdicts

| Probe | Runtime verdict | Interpretation |
|---|---|---|
| E0.0 | GTA_VERIFIED | Current DLL/environment and no-op native observation captured. |
| E0.1 | GTA_VERIFIED | All 10 read-only native/API matrix entries callable, zero reported exceptions; local fallback ray is uncalibrated. |
| E0.2 | GTA_VERIFIED | 30 evaluations: 28 indexed material matches, 2 misses, 0 hit-but-mismatched materials. |
| E0.3 | GTA_VERIFIED | 10 paired measurements; 8 agree within an explicitly selected 0.01 m diagnostic tolerance, 2 disagree. |

`GTA_VERIFIED` is the plugin's observation-captured status, not hypothesis acceptance. The 1 cm threshold is an analysis criterion for this report, not an asserted pre-registered acceptance gate.

## All 40 measurements

[measurements.csv](measurements.csv) records every evaluation, native and reference-derived material hashes, wall references, measured thickness, signed error, inside-ray hit, and entity consistency. IDs are positional sample ordinals, with private names/coordinates removed.

Materials: all shape tests returned completed state 2. Samples 2 and 6 missed (hash 0); the remaining 28 hit and matched `joaat(material_name + '_' + material_index)`. Bare material-name hashes matched 0/30. This supports indexed hash naming for the observed samples; the two misses do not demonstrate a wrong material mapping. The full 30/30 material hypothesis remains unaccepted.

Walls: all 10 forward and all 10 reverse tests completed and hit. Nine wall pairs matched the expected indexed material on both sides. Wall 3's reverse hit had a different material. Walls 3 and 4 hit different entities in forward and reverse directions; the other eight pairs hit the same entity.

| Wall | Reference m | Measured m | Signed error m | Interpretation |
|---|---:|---:|---:|---|
| 1 | 0.61987305 | 0.619873046875 | -0.000000003125 | agrees |
| 2 | 0.72848266 | 0.728495835350 | +0.000013175350 | agrees |
| 3 | 0.50262451 | 0.597717285156 | +0.095092775156 | different entities/materials |
| 4 | 0.50387573 | 0.758605957031 | +0.254730227031 | different entities |
| 5 | 0.50387573 | 0.503906250000 | +0.000030520000 | agrees |
| 6 | 0.35870361 | 0.358703613281 | +0.000000003281 | agrees |
| 7 | 0.39819336 | 0.398193359375 | -0.000000000625 | agrees |
| 8 | 0.73986906 | 0.739868657500 | -0.000000402500 | agrees |
| 9 | 0.05496216 | 0.054992675781 | +0.000030515781 | agrees |
| 10 | 0.11083984 | 0.110839843750 | +0.000000003750 | agrees |

Across all ten valid measurements, mean absolute thickness error is **0.034989762660 m (3.499 cm)**; maximum absolute error is **0.254730227031 m (25.473 cm)**. Thus 10/10 produced numbers, but only 8/10 agree within 1 cm. Different entities suggest intervening/overlapping streamed collision rather than a single primitive thickness; causality is not established.

All 10 midpoint-to-end inside-solid rays completed with **no hit**. This does not support reliable exit detection from inside these solids. Forward/reverse exterior rays worked, but the complete wall/inside-exit hypothesis remains unaccepted.

## Teleport and streaming

RPH logged relocation to safe pavement at 08:30:48.147, E0.2 began at 08:30:49.730, and original player position plus streamed collision were restored at 08:30:51.182. The manifest reports `restoredOriginalPosition=true`; post-run visual inspection showed the player back in story-mode free roam with the original interior rendered.

**Destination collision gating limitation:** inspection of the exact PR source (`PrepareAutoPosition` in Probes.cs) shows `autoSite.IsNearby(...)` is checked before the `teleportedPlayer` collision-wait branch. After relocation, that nearby check can set `siteReady` and return before checking `HAS_COLLISION_LOADED_AROUND_ENTITY` at the destination. The observed final status `already_within_100m_of_samples_return_streaming_original_position_restored`, and absence of the “Sample area streaming loaded” message, are consistent with this path. Relocation and return worked; destination collision readiness was **not independently verified**. The return gate separately checks collision and proximity (under 5 m); no independent exact-coordinate/heading delta was logged. These limits prevent claiming fully verified transport/streaming acceptance or attributing both material misses to geometry alone.

## Frame timing

| Probe | Recorded intervals | p50 ms | p95 ms | p99 ms | max ms |
|---|---:|---:|---:|---:|---:|
| E0.0 | 0 | 0 | 0 | 0 | 0 |
| E0.1 | 0 | 0 | 0 | 0 | 0 |
| E0.2 | 29 | 25 | 29 | 30.44 | 31 |
| E0.3 | 9 | 26 | 27 | 27 | 27 |

E0.0/E0.1 zero values mean no sampled intervals, not zero cost. These are short plugin tick intervals under the existing full mod/graphics setup, not isolated native durations or a baseline performance comparison. No native microtiming, transport frame-time series, or sufficient long-run tail data was recorded. No performance acceptance conclusion follows.

## Errors and recovery

First launch used the previously working unrestricted RPH method but crashed before plugins loaded: `0xc0000005 (EXCEPTION_ACCESS_VIOLATION)` at `0x00007ffb14e793d2` in `socialclub.dll`, with `SocialClubD3D12Renderer.dll` on the unmanaged stack. RPH's last startup phase was DX12 loading; its crash report lists no loaded plugins. One retry with Rockstar initialized succeeded. This is evidence of a startup failure and recovery, not proof of its root cause. No restricted-shell CLR20r3 launch was repeated.

The artifact installer put an old lab DLL backup alongside Plugins. `ReloadAllPlugins` attempted to load that backup and logged `System.ArgumentException: The specified file is not a valid CLR assembly`; it skipped the backup while successfully loading the current DLL. The backup was subsequently moved into the local workspace, away from plugin discovery. No further game restart was needed. No E0 native exceptions or cleanup failures were recorded in the successful suite.

## Evidence and next experiment

The four sanitized JSONL logs, four summaries, suite manifest, RPH excerpts, crash excerpt, receipt, fingerprints and per-sample CSV accompany this report. All four sanitized logs passed the repository's current strict analyzer. Original raw package is retained privately in the workspace. Coordinates, sample labels/material names, configs containing positions, GTA assets, XML exports, materials.dat, private provenance, screenshots and unrelated logs are excluded from publication.

Recommended next experiment: fix the isolated lab's destination gate ordering and add measured destination collision readiness plus exact return deltas; repeat E0.0–E0.3 with the same private references and a settled streaming interval. Independently inspect the two missing surfaces and the two multi-entity wall pairs against the actually streamed collision/patch precedence. Keep all destructive permits false. This report makes no gameplay-code changes and does not merge PR #285.
