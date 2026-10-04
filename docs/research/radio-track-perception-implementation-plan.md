# Radio Track Perception — Implementation Plan

Status: **research / implementation-ready design**  
Date: **2026-10-04**  
Baseline: `main@bc3b2027b0b2eb6a3c1a7dcb326587f9af781696`  
Research branch: `research/radio-track-perception-20261004`

## 1. Purpose

Add radio awareness to LSA so an NPC can know what station and track are audibly playing **only when that NPC has defensible hearing evidence**, without turning radio metadata into global omniscient prompt context.

This is intentionally designed as a small reference implementation for future environmental-audio producers such as horns, sirens, screams, explosions and ambient NPC speech.

The pipeline is:

```text
GTA audio state
  -> native radio sampler
  -> bounded raw radio signal
  -> LSA.Intelligence.v1
  -> companion track catalog normalization
  -> PS2 auditory witness attribution
  -> per-NPC observation
  -> PS3 deterministic salience
  -> later knowledge projection / Luna
```

The core epistemic rule is unchanged from PS0/PS1: **a backend/native fact is not automatically an NPC fact**.

## 2. Current repo constraints

Current `main` already provides:

- PS0/PS1 bounded native facts, anchors, transport and immutable observation primitives.
- `SensorAdapters.cs` edge/baseline patterns.
- `IntelligenceIntegration.Update()` with independent sampling cadences.
- `LSA.Intelligence.v1` output-only transport.
- strict companion-side signal validation.

Current feature branches provide, but `main` does not yet contain:

- PS2 witness/episode correlation on `feature/ps2-witness-rules-episode-correlation`.
- PS3 deterministic salience on `feature/ps3-deterministic-salience`.

Therefore this feature must be implementable in two slices:

1. **Raw producer slice**: safe to build on PS0/PS1.
2. **Knowledge slice**: added after PS2/PS3 are reconciled/merged.

Do not bypass PS2 by directly appending radio text to Luna prompts.

## 3. Goals

### Required

- Detect active player vehicle radio station.
- Detect track change using Rockstar audio natives.
- Emit only state edges, not per-tick samples.
- Resolve internal track identifier to station/artist/title through a versioned companion catalog.
- Preserve unknown tracks without inventing metadata.
- Attribute audible radio only to observers with valid source-time hearing evidence.
- Allow later salience/context selection to decide whether the observation reaches Luna.
- Keep the feature default-off/shadow-compatible until GTA V Enhanced runtime validation passes.
- Keep telemetry bounded and free of dialogue, prompts, audio, credentials and arbitrary user content.

### Explicit non-goals

- No lyric recognition or lyric injection.
- No audio recording of GTA output.
- No Shazam/external network lookup during gameplay.
- No assumption that every nearby NPC hears a car radio.
- No permanent memory solely because a song was playing.
- No NPC preference generation in the native/perception layer.
- No direct radio-driven autonomous speech.
- No replacement of Rockstar audio state with screen/OCR/vision.
- No broad audio-engine reverse engineering in this phase.

## 4. Native seams to use

Candidate Rockstar AUDIO natives:

| Native | Hash | Expected result |
| --- | --- | --- |
| `GET_PLAYER_RADIO_STATION_NAME()` | `0xF6D733C32076AD03` | station internal name |
| `GET_CURRENT_TRACK_SOUND_NAME(const char*)` | `0x34D66BC058019CE0` | track sound hash |
| `GET_CURRENT_TRACK_PLAY_TIME(const char*)` | `0x3E65CDE5215832C1` | current track play time |

The implementation may use the named native form if available through the pinned RPH/native layer, otherwise the stable hash through the existing native invocation mechanism.

**Important:** these signatures are research inputs, not GTA V Enhanced acceptance proof. The first implementation must log sanitized values in shadow mode and verify that they follow the actually audible station/track.

`GET_CURRENT_TRACK_PLAY_TIME` is diagnostic/optional for v1. Do not use it as the track identity.

## 5. Proposed raw producer

### 5.1 Sampling cadence

Add an independent radio cadence to `native/intelligence/IntelligenceIntegration.cs`:

```csharp
long nextRadio;

...

if (now >= nextRadio)
{
    nextRadio = now + 250;
    SampleRadio(tick, now);
}
```

250 ms is the initial target. It is fast enough for track/station changes while avoiding frame-level polling.

Do not place radio polling inside the observer/entity loops.

### 5.2 Source vehicle

For v1, radio state is scoped to the **player's current vehicle**.

```csharp
void SampleRadio(uint tick, long now)
{
    var player = Game.LocalPlayer.Character;
    if (player == null || !player.Exists())
    {
        sensors.Radio(null, null, 0, tick, now);
        return;
    }

    var vehicle = player.CurrentVehicle;
    if (vehicle == null || !vehicle.Exists())
    {
        sensors.Radio(null, null, 0, tick, now);
        return;
    }

    var station = NativeFunction.CallByName<string>(
        "GET_PLAYER_RADIO_STATION_NAME");

    uint trackHash = 0;
    if (!String.IsNullOrEmpty(station))
    {
        trackHash = unchecked((uint)NativeFunction.CallByName<int>(
            "GET_CURRENT_TRACK_SOUND_NAME",
            station));
    }

    var vehicleAnchor = RetainOrResolveCurrentVehicle(vehicle);

    sensors.Radio(
        vehicleAnchor?.CaptureRef,
        station,
        trackHash,
        tick,
        now);
}
```

The actual implementation must reuse the existing anchor/lifetime helper rather than inventing `RetainOrResolveCurrentVehicle` literally.

### 5.3 Edge detector

Add a dedicated baseline to `SensorAdapters.cs`:

```csharp
public sealed class RadioSample
{
    public string Vehicle;
    public string Station;
    public uint TrackHash;
}

RadioSample radioBaseline;

public void Radio(
    string vehicle,
    string station,
    uint trackHash,
    uint tick,
    long now)
{
    if (!Enabled) return;

    var current = new RadioSample
    {
        Vehicle = vehicle,
        Station = station,
        TrackHash = trackHash
    };

    if (radioBaseline == null)
    {
        radioBaseline = current;
        return;
    }

    if (radioBaseline.Vehicle == current.Vehicle &&
        radioBaseline.Station == current.Station &&
        radioBaseline.TrackHash == current.TrackHash)
        return;

    var kind = String.IsNullOrEmpty(station)
        ? "radio_stopped"
        : "radio_changed";

    Enqueue(new RawSignal
    {
        producer = "radio",
        kind = kind,
        target = vehicle,
        source = null,
        gameTick = tick,
        receivedMs = now,
        facts = new Dictionary<string, object>
        {
            { "station", station ?? "" },
            { "trackHash", trackHash }
        }
    });

    radioBaseline = current;
}
```

Reset/clock-regression must clear the radio baseline.

Vehicle exit/off -> `radio_stopped`.

Re-entering a vehicle establishes a fresh transition, but the implementation should suppress a fake historical change on the first-ever baseline after process start.

## 6. Raw wire contract

Extend the strict producer set:

```js
export const PRODUCERS = new Set([
  'ped_damage',
  'player_damage',
  'vehicle_damage',
  'shooting',
  'state',
  'action',
  'playback',
  'radio',
]);
```

Add exact validation:

```js
if (s.kind === 'radio_changed') {
  return s.producer === 'radio' &&
    optionalRef(s.target) &&
    keys(f, ['station', 'trackHash']) &&
    typeof f.station === 'string' &&
    /^[A-Z0-9_]{1,64}$/.test(f.station) &&
    integer(f.trackHash, 0xffffffff);
}

if (s.kind === 'radio_stopped') {
  return s.producer === 'radio' &&
    optionalRef(s.target) &&
    keys(f, ['station', 'trackHash']) &&
    f.station === '' &&
    f.trackHash === 0;
}
```

Recommended v1 raw event:

```json
{
  "signalId": "<uuid>",
  "producer": "radio",
  "producerSequence": 17,
  "kind": "radio_changed",
  "target": "<vehicle-captureRef>",
  "source": null,
  "gameTick": 19384811,
  "ageMs": 6,
  "facts": {
    "station": "RADIO_01_CLASS_ROCK",
    "trackHash": 2481236011
  }
}
```

Do **not** transmit human-readable artist/title from native code.

## 7. Track catalog

### 7.1 Location

Add:

```text
lsa-essential-e1-candidate/
  data/
    radioTracks.v1.json
  src/
    perception/
      radioTrackCatalog.mjs
```

### 7.2 Catalog schema

```json
{
  "version": 1,
  "game": "gta-v-enhanced",
  "tracks": {
    "93E4A82B": {
      "station": "RADIO_01_CLASS_ROCK",
      "stationName": "Los Santos Rock Radio",
      "artist": "Example Artist",
      "title": "Example Track"
    }
  }
}
```

Use an uppercase eight-digit hexadecimal key for deterministic lookup.

### 7.3 Resolver contract

```js
export function resolveRadioTrack({ station, trackHash }) {
  const key = trackHash.toString(16).padStart(8, '0').toUpperCase();
  const entry = catalog.tracks[key];

  if (!entry) {
    return Object.freeze({
      station,
      trackHash,
      trackKey: key,
      trackKnown: false,
    });
  }

  if (entry.station !== station) {
    return Object.freeze({
      station,
      trackHash,
      trackKey: key,
      trackKnown: false,
      catalogMismatch: true,
    });
  }

  return Object.freeze({
    station,
    stationName: entry.stationName,
    trackHash,
    trackKey: key,
    trackKnown: true,
    artist: entry.artist,
    title: entry.title,
  });
}
```

A hash/station mismatch must fail closed rather than silently assign the title.

## 8. How to build the catalog

Preferred order:

1. Extract Rockstar radio metadata from the locally owned game data / known metadata formats.
2. Build a deterministic generator that outputs `radioTracks.v1.json`.
3. Commit the generated catalog plus a provenance note/hash of inputs.
4. Keep manual overrides explicit and reviewable.
5. Never perform web/API lookup during runtime.

Suggested tooling:

```text
tools/
  buildRadioTrackCatalog.mjs
  verifyRadioTrackCatalog.mjs
docs/research/
  radio-track-catalog-provenance.md   # optional implementation artifact
```

The generator should:

- normalize station keys;
- normalize track sound hashes;
- reject duplicate hash mappings unless station-qualified behavior is explicitly proven;
- reject blank artist/title;
- sort output deterministically;
- emit counts by station;
- emit an unknown/duplicate report;
- reproduce byte-for-byte from the same inputs.

Do not make the runtime depend on third-party community JSON.

## 9. PS2 integration

Once PS2 is the baseline, radio becomes an **auditory event**.

The raw signal should be normalized into an event conceptually equivalent to:

```js
{
  kind: 'radio_audio',
  soundKind: 'radio',
  sourceVehicleCaptureRef: signal.target,
  station: resolved.station,
  stationName: resolved.stationName,
  trackKnown: resolved.trackKnown,
  artist: resolved.artist,
  title: resolved.title,
}
```

### 9.1 Witness policy

Do not give radio a simple global radius alone.

Preferred decision order:

1. observer is inside source vehicle -> witnessed, strong auditory evidence;
2. observer outside source vehicle -> require verified source vehicle + acoustic sample;
3. missing vehicle/interior/acoustic evidence -> unknown;
4. different blocked acoustic space -> did_not_witness;
5. beyond configured radius -> did_not_witness.

Suggested initial rule:

```js
const AUDITORY_RANGE = Object.freeze({
  gunshot: 60,
  siren: 60,
  speech: 12,
  impact: 25,
  radio: 8,
});
```

But same-vehicle occupancy should be a first-class positive seam and should not depend on an arbitrary 8 m radius.

Do not infer that closed windows are open/closed unless a tested native seam exists. If v1 only knows `sourceVehicle === observerVehicle`, support same-vehicle hearing first and keep exterior hearing disabled/unknown.

### 9.2 Observation vocabulary

Preferred new observation event:

```text
eventType: radio_heard
```

Preferred claim kind:

```text
kind: sound
```

Use existing auditory evidence semantics:

```json
{
  "channel": "auditory",
  "basis": "audibility_model",
  "sampledGameTick": 19384811
}
```

Track metadata belongs in bounded claim details, not in identity fields.

Example:

```json
{
  "eventType": "radio_heard",
  "severity": "routine",
  "claims": [
    {
      "kind": "sound",
      "certainty": "supported",
      "evidence": {
        "channel": "auditory",
        "basis": "audibility_model",
        "sampledGameTick": 19384811
      },
      "details": {
        "soundType": "radio",
        "station": "RADIO_01_CLASS_ROCK",
        "stationName": "Los Santos Rock Radio",
        "trackKnown": true,
        "artist": "Example Artist",
        "title": "Example Track"
      }
    }
  ]
}
```

Do not overload `speech_heard`.

## 10. Episode correlation

Radio changes should not create long-lived noisy episodes.

Recommended correlation:

- episode family: `radio`;
- participant key: source vehicle captureRef;
- a station/track change revises/replaces the current short radio episode;
- `radio_stopped` closes or expires it;
- TTL target: 30-120 seconds after the track is no longer audible;
- do not create one episode every 250 ms;
- do not persist routine radio observations as P2 experiential memory by default.

A station change and a track change are materially different revisions but belong to the same local radio family while the source vehicle remains the same.

## 11. PS3 salience

Radio should start low priority.

Suggested policy:

```text
severity: routine
context: low by default
memory: none by default
response: none by default
```

Boost context eligibility when any of these are true:

- current player utterance semantically references song/music/radio/station/artist;
- the NPC explicitly asked about the music in the current conversation;
- the current observation is a material track/station change during otherwise low-load context;
- later character preference systems contain a supported music preference;
- a prior memory is directly about this track/artist and is independently eligible.

Radio alone must not grant initiative permission.

A first PS3 implementation can simply classify `radio_heard` as routine and context-eligible only when the turn context explicitly requests environmental/audio context. Rich semantic query matching can remain a later selector concern.

## 12. Context projection

Once PS4-style knowledge projection exists, the model-visible form should be compact.

Known track:

```text
Audible environment: the vehicle radio is playing "Hollywood Nights" by Bob Seger & The Silver Bullet Band on Los Santos Rock Radio.
```

Unknown track:

```text
Audible environment: Los Santos Rock Radio is playing, but the track is not identified.
```

Never say the NPC "likes", "recognizes", "remembers", or "knows" the artist unless another system supports that claim.

## 13. Code touch map

### Raw producer slice

Modify:

- `native/intelligence/IntelligenceIntegration.cs`
  - add radio cadence state;
  - call radio natives;
  - resolve current vehicle anchor;
  - call `sensors.Radio(...)`.
- `native/intelligence/SensorAdapters.cs`
  - add `RadioSample`;
  - add baseline/edge method;
  - reset baseline;
  - preserve queue bounds.
- `lsa-essential-e1-candidate/src/perception/contracts.mjs`
  - add producer;
  - add two signal kinds;
  - extend diagnostic signal allowlist.
- `native/intelligence/tests/Program.cs`
  - radio edge/reset/bounds tests.
- `native/intelligence/integration-tests/Program.cs`
  - integration/serialization tests.
- `lsa-essential-e1-candidate/tests/perception-contract.test.mjs`
  - strict contract cases.

Add:

- `lsa-essential-e1-candidate/data/radioTracks.v1.json`
- `lsa-essential-e1-candidate/src/perception/radioTrackCatalog.mjs`
- `lsa-essential-e1-candidate/tests/radio-track-catalog.test.mjs`
- `lsa-essential-e1-candidate/tools/verifyRadioTrackCatalog.mjs`

### PS2 slice

Modify after PS2 reconciliation:

- `native/intelligence/WitnessPolicy.cs` if source-time same-vehicle/acoustic receipts are computed natively.
- `src/perception/witnessPolicy.mjs` if companion policy consumes the required receipt fields.
- `src/perception/contracts.mjs`
  - `radio_heard` event type;
  - bounded sound details.
- `src/perception/episodeCorrelator.mjs`
  - radio family/revision/expiry.
- `src/perception/shadowRuntime.mjs`
  - normalize raw radio signal and resolve catalog before observation creation.
- PS2 witness/correlation tests.

### PS3 slice

Modify after PS3 reconciliation:

- `src/perception/salienceEngine.mjs`
  - classify `radio_heard` as routine;
  - keep response non-urgent/non-autonomous;
  - add deterministic reason only if needed.
- `tests/salience-engine.test.mjs`
  - low priority default;
  - explicit-turn relevance;
  - no initiative entitlement.

## 14. Diagnostics

Add bounded counters, not content logs:

```text
radio_samples
radio_edges
radio_unknown_tracks
radio_catalog_mismatches
radio_native_failures
radio_witnessed
radio_witness_unknown
```

Do not log full arbitrary station strings unless validated against the station grammar.

A temporary shadow-only debug line may print:

```text
[PS] radio station=RADIO_01_CLASS_ROCK track=93E4A82B known=1
```

Do not print artist/title continuously in production diagnostics.

## 15. Failure policy

| Failure | Behavior |
| --- | --- |
| station native unavailable | feature unavailable; ordinary perception continues |
| track native returns zero/unknown | keep station, trackKnown=false |
| catalog missing | keep raw station/hash; no title invention |
| catalog hash mismatch | mark unknown + diagnostic |
| source vehicle anchor missing | keep event backend-only or drop per strict contract; do not assign to another vehicle |
| PS2 evidence incomplete | observer status unknown |
| queue full | use existing bounded drop policy; radio is routine/noncritical |
| native restart/game clock regression | clear baseline/catalog runtime cache |
| feature disabled | zero behavior change |

Radio must never take critical queue reserve from injury/death/threat signals.

## 16. Implementation phases

### R0 — Runtime probe

Implement a minimal temporary shadow probe or test-only branch instrumentation to record station, track hash and optional play time while manually changing stations/tracks in GTA V Enhanced.

Exit:

- station matches audible station;
- track hash changes at real song boundary;
- talk/news/advert segments behavior is documented;
- radio-off and vehicle-exit behavior is known;
- no crash or invalid string lifetime behavior.

### R1 — Raw producer

Implement native sampling, edge detection, contract validation and counters.

Exit:

- no repeated edge for stable song;
- correct station/track/off transitions;
- queue remains bounded;
- restart/clock reset safe;
- no model/context effects.

### R2 — Catalog

Implement deterministic catalog generation/verification and runtime resolver.

Exit:

- reproducible catalog;
- duplicate/mismatch behavior explicit;
- unknown track remains safe;
- no network dependency.

### R3 — PS2 hearing

Integrate radio into auditory witness rules.

Exit:

- same-vehicle observer receives supported `radio_heard`;
- non-observer receives none;
- exterior hearing remains conservative unless source-time acoustic evidence is proven;
- no global knowledge.

### R4 — PS3 salience

Add deterministic low-priority classification.

Exit:

- radio does not become urgent;
- radio does not authorize speech;
- explicit music-related turn can make it context-eligible;
- repeated same track is suppressed.

### R5 — Context projection

Once bounded knowledge projection is available, expose a one-line audible environment fact to Luna when selected.

Exit:

- NPC correctly answers "what song is this?";
- unrelated turns do not always pay the token cost;
- unknown track is described as unknown;
- no false preference/recognition claim.

## 17. Merge sequencing

Preferred:

```text
current main
  -> PS2 reconciliation/merge
  -> PS3 reconciliation/merge
  -> radio R0/R1/R2
  -> radio R3/R4
  -> later PS4 context projection
```

It is also safe to implement R0/R1/R2 before PS2 merges as long as all radio behavior remains shadow-only and no Luna/context path consumes raw signals.

When rebasing this plan onto later main, re-check:

- producer/event closed enums;
- diagnostics schema;
- witness receipt fields;
- episode event vocabulary;
- salience event families;
- native Update budgets;
- package/build source lists.

## 18. Definition of done

Radio perception is complete only when all are true:

- GTA V Enhanced runtime proves the station/track native behavior.
- Raw producer is bounded, edge-based and restart-safe.
- Track catalog is deterministic and verified.
- PS2 proves which NPC heard the radio.
- PS3 prevents routine music from crowding out important context.
- Luna receives track context only through bounded knowledge selection.
- Unknown/missing metadata remains explicitly unknown.
- No radio fact causes automatic durable memory or initiative by itself.
- Existing P0/P1/P2/PS0/PS1 and later PS2/PS3 tests remain green.
- A GTA smoke test demonstrates a passenger can answer a track question while a non-hearing NPC cannot.
