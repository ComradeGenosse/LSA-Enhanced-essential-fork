# Radio Track Perception — Contracts and Code Map

Status: **research specification**  
Companion to: [radio-track-perception-implementation-plan.md](radio-track-perception-implementation-plan.md)

## 1. Design rule

Radio metadata has three distinct states and they must not be conflated:

1. **World fact** — GTA reports that a vehicle radio has station/track state.
2. **Observer fact** — PS2 establishes that a specific NPC could hear that source.
3. **Model context** — salience/knowledge selection decides the observer fact is useful for this turn.

Only state 3 is allowed to become Luna-visible narrative.

## 2. Raw signal contract

### 2.1 Producer

```text
producer = radio
```

### 2.2 Kinds

```text
radio_changed
radio_stopped
```

No `radio_started` kind is required in v1; off -> active is represented by `radio_changed`.

### 2.3 Fields

```ts
type RadioChangedSignal = {
  signalId: UUID;
  producer: "radio";
  producerSequence: PositiveSafeInteger;
  kind: "radio_changed";
  target: CaptureRef | null;   // current player vehicle when retained
  source: null;
  gameTick: UInt32;
  ageMs: Integer0To30000;
  facts: {
    station: StationKey;
    trackHash: UInt32;
  };
};

type RadioStoppedSignal = {
  signalId: UUID;
  producer: "radio";
  producerSequence: PositiveSafeInteger;
  kind: "radio_stopped";
  target: CaptureRef | null;
  source: null;
  gameTick: UInt32;
  ageMs: Integer0To30000;
  facts: {
    station: "";
    trackHash: 0;
  };
};
```

### 2.4 Validation grammar

Station keys:

```regex
^[A-Z0-9_]{1,64}$
```

Track hashes are unsigned 32-bit values.

The companion rejects:

- extra fields;
- negative hashes;
- hashes > `0xffffffff`;
- malformed station strings;
- non-null source;
- unknown producer/kind pair;
- radio-stopped with nonzero track;
- radio-changed with blank station;
- oversized frame;
- expired signal;
- duplicate/out-of-order producer sequence according to existing channel rules.

## 3. Native implementation shape

### 3.1 State

Add to `IntelligenceIntegration`:

```csharp
long nextRadio;
const long RadioSampleIntervalMs = 250;
```

Add to `SensorAdapters`:

```csharp
public sealed class RadioSample
{
    public string Vehicle;
    public string Station;
    public uint TrackHash;
}

RadioSample radioBaseline;
```

### 3.2 Sampler behavior

Pseudocode:

```text
if feature disabled:
    return

if no valid player:
    sample OFF
    return

if no current vehicle:
    sample OFF
    return

station = GET_PLAYER_RADIO_STATION_NAME()

if station invalid/blank:
    sample OFF
    return

trackHash = GET_CURRENT_TRACK_SOUND_NAME(station)

vehicleRef = current retained vehicle captureRef, if available

sample (vehicleRef, station, trackHash)
```

The sampler must not:

- enumerate vehicles;
- enumerate observers;
- query LOS;
- hydrate characters;
- touch model/provider state;
- create P2 identities;
- allocate a dialogue session;
- persist anything.

### 3.3 Baseline transition table

| Previous | Current | Emit |
| --- | --- | --- |
| none | any | no; establish baseline |
| off | off | no |
| off | station A / track X | `radio_changed` |
| A/X | A/X | no |
| A/X | A/Y | `radio_changed` |
| A/X | B/Z | `radio_changed` |
| A/X | off | `radio_stopped` |
| vehicle V1 A/X | vehicle V2 A/X | `radio_changed` because source changed |
| reset | any | no until fresh baseline |

Source vehicle change is material even if station/hash are identical because observer audibility changes.

### 3.4 Queue priority

Radio is always routine:

```csharp
Critical = false;
```

It may be dropped before critical injury/death/danger work.

## 4. Track catalog contract

### 4.1 File

`lsa-essential-e1-candidate/data/radioTracks.v1.json`

### 4.2 Schema

```ts
type RadioTrackCatalogV1 = {
  version: 1;
  game: "gta-v-enhanced";
  generatedFrom?: string;
  tracks: Record<HexUInt32, {
    station: StationKey;
    stationName: string;
    artist: string;
    title: string;
  }>;
};
```

Runtime should deep-freeze or otherwise treat parsed entries as immutable.

### 4.3 Resolver output

```ts
type ResolvedRadioTrack =
  | {
      station: StationKey;
      stationName?: string;
      trackHash: UInt32;
      trackKey: HexUInt32;
      trackKnown: false;
      catalogMismatch?: true;
    }
  | {
      station: StationKey;
      stationName: string;
      trackHash: UInt32;
      trackKey: HexUInt32;
      trackKnown: true;
      artist: string;
      title: string;
    };
```

### 4.4 Catalog guarantees

Verifier must assert:

- exactly `version: 1`;
- deterministic lexical ordering;
- valid uppercase 8-char hex keys;
- no blank station/stationName/artist/title;
- valid station grammar;
- no exact duplicate track key;
- no entry outside explicit size bounds;
- valid UTF-8;
- total catalog size below a configured build-time ceiling;
- runtime load failure degrades to unknown-track behavior.

## 5. Normalized event

The raw signal is transport-oriented. The companion should normalize it before PS2 correlation.

```ts
type NormalizedRadioEvent = {
  eventSignalId: UUID;
  kind: "radio_audio";
  soundKind: "radio";
  gameTick: UInt32;
  sourceVehicleCaptureRef: CaptureRef | null;
  station: StationKey;
  stationName?: string;
  trackHash: UInt32;
  trackKey: HexUInt32;
  trackKnown: boolean;
  artist?: string;
  title?: string;
};
```

Normalization must be pure and deterministic.

## 6. PS2 auditory evidence contract

### 6.1 Minimum supported v1

The safest first PS2 implementation is **same-vehicle hearing only**.

Required evidence:

```ts
type RadioAudibilitySampleV1 = {
  gameTick: UInt32;
  observerCaptureRef: CaptureRef;
  sourceVehicleCaptureRef: CaptureRef;
  observerVehicleCaptureRef: CaptureRef | null;
};
```

Decision:

```js
if (observerVehicleCaptureRef === sourceVehicleCaptureRef)
  return witnessed("same_vehicle_radio");

return unknown("radio_exterior_not_supported");
```

This is deliberately conservative and is preferable to pretending a generic distance check accurately models a closed car stereo.

### 6.2 Optional v2 exterior hearing

Only add exterior hearing when source-time evidence can distinguish enough of:

- observer/source positions;
- same interior/acoustic space;
- observer/source vehicle enclosure state;
- acoustic path or a validated conservative substitute;
- distance.

Then a bounded radius may be used as a final gate.

Do not infer windows/open doors unless a specific tested seam exists.

### 6.3 Evidence representation

Reuse the PS2 auditory evidence model:

```json
{
  "channel": "auditory",
  "basis": "audibility_model",
  "sampledGameTick": 19384811
}
```

Add a controlled reason code such as:

```text
same_vehicle_radio
radio_exterior_not_supported
radio_source_vehicle_unknown
radio_observer_vehicle_unknown
radio_out_of_range
radio_acoustic_blocked
```

If adding reason codes to a closed enum, update tests and protocol version assumptions together.

## 7. Observation contract

### 7.1 Event type

Add:

```text
radio_heard
```

### 7.2 Severity

Always:

```text
routine
```

unless a future system defines a separate emergency broadcast concept. A normal song never becomes danger/critical merely because it is radio.

### 7.3 Claim

Preferred claim remains `kind: sound`.

Bound details with a closed schema:

```ts
type RadioSoundDetails = {
  soundType: "radio";
  eventSignalId: UUID;
  station: StationKey;
  stationName?: string;
  trackHash: UInt32;
  trackKnown: boolean;
  artist?: string;
  title?: string;
};
```

Rules:

- `artist` and `title` allowed iff `trackKnown === true`.
- `trackKnown === true` requires both.
- `stationName` may be absent if station display mapping is unknown.
- strings are length-bounded.
- no lyrics.
- no arbitrary metadata blob.
- no cover art/image URLs.
- no web links.

Example:

```json
{
  "version": 1,
  "observationId": "<uuid>",
  "episodeId": "<uuid>",
  "revision": 1,
  "observer": {
    "captureRef": "<ped-ref>",
    "kind": "ped"
  },
  "observedAt": {
    "nativeRun": "<uuid>",
    "gameTick": 19384811,
    "receivedUtc": "2026-10-04T21:00:00.000Z"
  },
  "expiresAtMonotonicMs": 123456,
  "eventType": "radio_heard",
  "severity": "routine",
  "claims": [
    {
      "claimId": "<uuid>",
      "kind": "sound",
      "certainty": "supported",
      "evidence": {
        "channel": "auditory",
        "basis": "audibility_model",
        "sampledGameTick": 19384811
      },
      "details": {
        "soundType": "radio",
        "eventSignalId": "<uuid>",
        "station": "RADIO_01_CLASS_ROCK",
        "stationName": "Los Santos Rock Radio",
        "trackHash": 2481236011,
        "trackKnown": true,
        "artist": "Example Artist",
        "title": "Example Track"
      }
    }
  ],
  "recognizedCharacterIds": []
}
```

## 8. Episode correlation contract

Recommended key:

```text
observerCaptureRef | "radio" | sourceVehicleCaptureRef
```

Material revision if any of these change:

- source vehicle;
- station;
- track hash;
- trackKnown from false -> true due to catalog availability inside the same runtime;
- stop/off state.

Do not revise because only play time changes.

Suggested expiry:

```text
active episode freshness: 30 s
post-stop retention: 30-120 s
```

Exact TTL belongs in one constant and must be covered by fake-clock tests.

## 9. PS3 mapping

Add `radio_heard` to routine events.

Default deterministic decision:

```json
{
  "context": "low",
  "memory": "none",
  "response": "none"
}
```

Do not add `radio_heard` to harm or safety families.

Potential controlled reasons:

```text
routine_low_relevance
situation_conversation
prior_memory
```

Avoid a special "music cool" trait. Music taste belongs in an explicit future character-preference schema, not ad-hoc prompt inference.

## 10. Knowledge projection contract

The selector should render at most one current radio fact.

Priority:

1. directly relevant current turn asks about music/radio/song;
2. currently audible same-vehicle track;
3. recently changed track if still within observation freshness;
4. otherwise omit.

Render known:

```text
Audible environment: "TITLE" by ARTIST is playing on STATION.
```

Render unknown:

```text
Audible environment: STATION is playing; the track is not identified.
```

Never render:

- internal hash unless diagnostics/debug;
- captureRef;
- evidence reason;
- native names;
- catalog confidence mechanics.

## 11. Suggested implementation API

### Companion resolver

```js
export class RadioTrackCatalog {
  constructor(rawCatalog) {}
  resolve(station, trackHash) {}
}
```

### Event normalizer

```js
export function normalizeRadioSignal(signal, catalog) {}
```

### PS2 helper

```js
export function evaluateRadioAudibility({
  observerCaptureRef,
  observerVehicleCaptureRef,
  sourceVehicleCaptureRef,
  sampledGameTick,
}) {}
```

Keep these pure where possible so they can be fuzzed without GTA.

## 12. Suggested file-level patch order

1. `SensorAdapters.cs`
2. native tests for edge behavior
3. `IntelligenceIntegration.cs`
4. native integration serialization test
5. `contracts.mjs`
6. companion contract tests
7. `radioTrackCatalog.mjs`
8. catalog verifier + tests
9. shadow runtime normalization
10. GTA native probe
11. PS2 witness/correlation integration
12. PS2 tests
13. PS3 classification
14. PS3 tests
15. knowledge projection when that phase exists

Do not build all layers before the runtime probe proves the track native.

## 13. Compatibility strategy

The initial raw producer can remain inside protocol version 1 if:

- both native and companion are shipped together;
- strict producer/kind validators are updated together;
- old binaries fail closed on the new kind;
- no mixed-version deployment is supported.

If mixed native/companion package versions become a supported scenario, add an explicit radio capability/version gate instead of relying on closed-schema rejection.

## 14. Security/privacy

Radio track metadata is game content, but the same transport/privacy rules still apply:

- no raw audio;
- no microphone data;
- no prompts;
- no transcripts;
- no provider responses;
- no user filesystem path;
- no arbitrary URLs;
- no external lookup query logs;
- no native entity address/handle in persisted data.

The raw station/hash and bounded counters may exist transiently in RAM and sanitized diagnostics.

## 15. Implementation review checklist

Before code review approval:

- [ ] polling is independent of actor-count loops;
- [ ] stable track produces zero repeat signals;
- [ ] first baseline does not create fake history;
- [ ] reset clears baseline;
- [ ] vehicle source lifetime is not retargeted;
- [ ] radio signals cannot consume critical reserve;
- [ ] companion validator remains closed;
- [ ] catalog failures remain unknown rather than guessed;
- [ ] same-vehicle hearing is source-time evidence;
- [ ] non-hearing NPC receives no observation;
- [ ] PS3 does not grant initiative;
- [ ] no direct Luna prompt injection exists;
- [ ] all strings and arrays are bounded;
- [ ] diagnostics contain no dialogue/audio/user content;
- [ ] GTA V Enhanced probe evidence is attached before enabling context.
