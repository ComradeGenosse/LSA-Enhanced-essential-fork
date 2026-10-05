# Radio track perception R0–R2

Status: **implemented on `feature/radio-track-perception-r0-r2`; not merged to `main`**.  
Tip: `58d8c77732e1a5e08ec85e0ac82233069e7d2a29`  
Branch: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/tree/feature/radio-track-perception-r0-r2

Radio is a raw world fact. It does not create a PS2 observation, a memory, or any Luna prompt text.

## Behavior

It stays off unless both intelligence configs set `mode` and `radio` to `shadow`. Then the native sampler runs on its own 250 ms clock, outside the ped and observer loops:

- The first sample only sets a baseline. It does not invent a historical change.
- A stable station and track produces no further signal.
- A station change, track change, radio coming back on, or a different player vehicle emits one `radio_changed`.
- Leaving the vehicle, a blank station, or a station string that fails `^[A-Z0-9_]{1,64}$` emits one `radio_stopped` with `station: ""` and `trackHash: 0`.
- A game-clock reset clears that baseline.
- These signals are routine. They cannot use the 64-slot critical reserve.
- The wire carries the station key and the unsigned track hash only. Artist and title are resolved only by the companion catalog.
- Unknown hashes, station mismatches, a missing catalog, and hash `0` stay unknown. There is no runtime network lookup and no raw audio capture.

The probe line, written only when that sanitized sample changes, looks like:

```text
[RADIO_PROBE] vehicle=1 station=RADIO_01_CLASS_ROCK track=93E4A82B play_ms=42113
```

`vehicle` is `1` or `0`. If the station string fails the grammar, the log says `rejected=station_grammar` with a length and a character-class token, and it does not print the string.

## Files changed against current `main`

- `native/intelligence/IntelligenceIntegration.cs`
- `native/intelligence/SensorAdapters.cs`
- `native/intelligence/tests/Program.cs`
- `native/intelligence/integration-tests/GameStub.cs`
- `native/intelligence/integration-tests/Program.cs`
- `native/promoted-characters/RuntimeEntry.cs`
- `native/promoted-characters/runtime-tests/RuntimeStubs.cs`
- `native/promoted-characters/lifecycle-tests/GameStubs.cs`
- `native/promoted-characters/ps-host-tests/Program.cs`
- `native/promoted-characters/LSA.PromotedCharacters.example.json`
- `lsa-essential-e1-candidate/src/perception/contracts.mjs`
- `lsa-essential-e1-candidate/src/perception/shadowRuntime.mjs`
- `lsa-essential-e1-candidate/src/perception/intelligenceClient.mjs`
- `lsa-essential-e1-candidate/src/perception/radioTrackCatalog.mjs`
- `lsa-essential-e1-candidate/data/radioTracks.v1.json`
- `lsa-essential-e1-candidate/e1.config.example.json`
- `lsa-essential-e1-candidate/tests/perception-contract.test.mjs`
- `lsa-essential-e1-candidate/tests/radio-track-catalog.test.mjs`
- `lsa-essential-e1-candidate/tests/fixtures/radio-tracks.v1.json`
- `lsa-essential-e1-candidate/tools/buildCandidate.mjs`
- `lsa-essential-e1-candidate/tools/buildRadioTrackCatalog.mjs`
- `lsa-essential-e1-candidate/tools/verifyRadioTrackCatalog.mjs`
- `docs/research/radio-track-catalog-provenance.md`

## Tests

Fresh results on the pushed tip:

| Suite | Result |
| --- | --- |
| `node tools/runTests.mjs` | 378 passed, 0 failed, 0 skipped |
| `native/intelligence/tests` | PASS 493 |
| `native/intelligence/integration-tests` | PASS 61 |
| `node tools/testPerceptionInterop.mjs` | 1 passed |
| `ps-host-tests` `stop` | PASS 7 |
| `runtime-tests` | 34 passed |

The companion suite’s candidate build check passed, so the empty catalog is copied into the staged package. The RPH characters-addon package build was not run, and nothing was deployed to GTA.

## Still shadow-only

Native radio calls run only after opt-in. Offline tests use a fake native seam. They do not prove `GET_PLAYER_RADIO_STATION_NAME`, `GET_CURRENT_TRACK_SOUND_NAME`, or `GET_CURRENT_TRACK_PLAY_TIME` in GTA V Enhanced. A bad native can still crash the process; the managed catch only covers managed exceptions.

The committed catalog has zero tracks (`generatedFrom: "unavailable"`). Every real hash stays unknown until local Rockstar radio metadata is supplied. That requirement is in `docs/research/radio-track-catalog-provenance.md`.

PS2 hearing, PS3 salience, memory, and Luna context are not implemented. Radio signals are stored as raw facts and are not passed to the PS2 correlator.

## Differences from the research plan

The branch started at `bc3b202`, the research baseline. `main` then moved to `8c63b20` and gained PS2 witness correlation plus the player-speech gate. This branch was merged forward onto that `main`. PS2 behavior is unchanged. Radio was not added as `radio_heard`.

Sampling is not always on. `intelligence.radio` defaults to `off`, which matches rollout mode 0. The 250 ms sampler runs only in `shadow`.

No new `radio` capability key was added. PS2 already extended the hello capabilities with `playerSpeech`. Radio is gated by the config flag so that schema stays as PS2 defined it. If the native side sends radio while the companion flag is off, those frames are dropped and are not stored.

Play time is read only when a probe line will be written. It is not part of track identity and it is not on the signal.

The runtime admission harness stubs `EssentialInputInterception` so it still compiles after `main` started releasing that lease on host stop. That harness does not load Harmony.

## GTA validation

Rebuild and install this branch with the usual package steps first. The running game will not see the probe until that native build is loaded.

Then set both of these, and leave every other intelligence mode alone:

- Promoted-characters config: `"intelligence": { "mode": "shadow", "pipeName": "LSA.Intelligence.v1", "radio": "shadow" }`
- Companion `e1.config.json`: the same `mode` and `radio` values

In a non-mission free-roam session, watch `RagePluginHook.log` for `[PS] radio_shadow` and `[RADIO_PROBE]` lines. Do one step at a time and record the audible result next to the probe line:

1. Stand outside any vehicle.
2. Enter a normal vehicle and turn the radio on. The first in-vehicle sample after load is a baseline, so it should log and should not increment `radio_changed`.
3. Stay on one station through one full song change.
4. Retune to another station, then retune back.
5. Turn the radio off, then on.
6. Exit while it is playing, re-enter the same vehicle, then enter a different vehicle.
7. Try one talk or news station, and one ad or DJ segment if one is available.
8. Pause and unpause, then reload the addon, then restart GTA. The first sample after each restart should be a baseline again.

Also check the 10-second `[PS] shadow` line. `radio=` is three integers: samples, edges, native failures. It should not contain a station name, artist, or title.

Stop the gate if any of these happen: no `[PS] radio_shadow` after the opt-in, `radio` native-failure count climbing, `rejected=station_grammar`, a track hash that changes during a single song, or a hash that does not change when the song does. Do not ask Luna what song is playing. This build cannot put that fact in her context.
