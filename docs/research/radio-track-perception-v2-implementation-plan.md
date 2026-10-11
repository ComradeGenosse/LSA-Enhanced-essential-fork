# Radio Track Perception v2 — Full Implementation Plan

Status: **implementation-ready research plan**  
Date: **2026-10-04**  
Planning branch: `research/radio-public-catalog-v2-20261004`  
Baseline feature: `feature/radio-track-perception-r0-r2@41604c715ec16cdcaccf0096274ae3dc7da47481`  
Primary research source: `HintSystem/GTA-V-Radio-Dumps@d85fa6d9a63a2bc0d75109a6a8a3f9f26228e0cc`  
Secondary station-label source: `DurtyFree/gta-v-data-dumps@b65684e00f689fdec405c5f1055322c802d3c895`

Related research:

- [Public metadata source analysis](radio-public-data-source-analysis.md)
- [Candidate v2 track-text catalog](../../lsa-essential-e1-candidate/data/radioTrackTextIds.v2.json)
- [Deterministic converter](../../lsa-essential-e1-candidate/tools/buildRadioTrackTextCatalog.mjs)

## 1. Executive decision

The original R0-R2 architecture remains valid, but the **song identity key must be refined before merge**.

The original implementation assumed:

```text
GET_CURRENT_TRACK_SOUND_NAME(station)
    -> uint sound hash
    -> artist/title
```

The public GTA-derived metadata shows that this cannot uniquely identify every song because a single audio container can contain many song markers. Across the inspected HintSystem data:

- 1,709 audio/container records;
- 1,226 track-marker occurrences;
- 1,058 unique track text IDs;
- 67 containers with multiple unique song markers;
- as many as 22 songs inside one container;
- zero conflicting artist/title mappings for the same text ID.

Therefore v2 uses:

```text
GET_PLAYER_RADIO_STATION_NAME()
    -> station key

GET_CURRENT_TRACK_SOUND_NAME(station)
    -> sound/container hash (secondary evidence)

GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()
    -> per-song text ID (candidate primary song identity)

trackTextId
    -> companion v2 catalog
    -> artist/title/kind
```

The **GTA runtime value is authoritative**. The static catalog is only a metadata resolver.

## 2. Architectural invariants

This plan does not change the core perception architecture.

```text
GTA world state
  -> native radio sampler
  -> raw bounded radio fact
  -> LSA.Intelligence.v1
  -> companion metadata resolution
  -> [later] PS2 auditory witness attribution
  -> [later] PS3 salience
  -> [later] bounded Luna context
```

Non-negotiable rules:

1. `GTA fact != NPC knowledge`.
2. Radio remains raw/shadow-only through this implementation.
3. No direct Luna prompt text.
4. No memory creation.
5. No autonomous speech.
6. No runtime web/API lookup.
7. No raw GTA audio capture.
8. No per-observer radio polling.
9. No catalog row is treated as proof that a song is currently available in the user's GTA build.
10. Unknown or future IDs remain explicitly unknown.

## 3. Source strategy

### 3.1 Track metadata — HintSystem

Use HintSystem's processed GTA radio dump as the **reference source for the mapping model**.

The useful shape is:

```text
Markers.Track[].Id
Markers.Track[].Title
Markers.Track[].Artist
```

The parser demonstrates that each integer marker ID is used to retrieve title/artist strings from GTA's extracted `trackid.gxt2`.

Example:

```json
{
  "Id": 1004,
  "Title": "Hollywood Nights",
  "Artist": "BOB SEGER"
}
```

### 3.2 Station labels — DurtyFree

Use DurtyFree's `radioStations.json` only to enrich internal station keys with a current human-readable English label where available.

Do not use it as the song identity database.

### 3.3 Runtime authority

The live GTA native result is authoritative:

```text
GTA emits text ID X
        ↓
catalog[X] may resolve metadata
```

Never reverse the implication:

```text
catalog contains X
        ↓
X must still exist in current Enhanced rotation  [INVALID]
```

This matters because public dump freshness can lag current GTA V Enhanced content.

## 4. Why soundHash remains

Do not remove `GET_CURRENT_TRACK_SOUND_NAME`.

It remains valuable as:

- enclosing sound/container identity;
- diagnostic evidence;
- transition debugging;
- proof that multiple text IDs may occur inside one sound container;
- fallback telemetry when text ID is absent or unsupported.

But **soundHash must not resolve artist/title in v2**.

Rename the conceptual field from `trackHash` to `soundHash` wherever practical before merge so its semantics are not misleading.

Because the radio branch is still unmerged, this is the right time to make that breaking cleanup.

## 5. Implementation phases

The implementation is split so no code claims the text-ID mapping before GTA proves it.

```text
V2-R0A  Extend probe only
V2-R0B  GTA acceptance of text ID
V2-R1   Upgrade raw wire/event semantics
V2-R2   Replace hash catalog with text-ID resolver
V2-R2B  Catalog provenance / packaging policy
V2-R3   PS2 hearing attribution [later]
V2-R4   PS3/context selection [later]
```

Only V2-R0A through V2-R2B are in scope for the next feature implementation.

---

# V2-R0A — Extend the shadow probe

## 6. Add `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID`

Native:

```text
GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()
hash: 0x50B196FC9ED6545B
return: int
```

Do not initially change the production signal contract.

Extend the existing radio shadow probe so a changed sanitized radio sample can log:

```text
[RADIO_PROBE] vehicle=1 station=RADIO_01_CLASS_ROCK sound=93E4A82B text_id=1004 play_ms=42113
```

The text ID must be printed as a signed decimal integer because the native returns `int`.

Do not clamp negative values in the probe. We need to learn their actual semantics.

### 6.1 Probe call order

Recommended:

```text
1. resolve player/current vehicle
2. GET_PLAYER_RADIO_STATION_NAME
3. validate station grammar
4. GET_CURRENT_TRACK_SOUND_NAME(station)
5. GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()
6. only if probe output is needed:
   GET_CURRENT_TRACK_PLAY_TIME(station)
```

Each native call must retain the current managed-exception containment.

Do not convert a native failure into a fabricated radio-off value.

### 6.2 Probe-only sample

Temporary internal probe sample:

```csharp
sealed class RadioProbeSample
{
    public string Vehicle;
    public string Station;
    public uint SoundHash;
    public int TrackTextId;
}
```

The v2 probe line changes when any of these change:

- source vehicle;
- station;
- sound hash;
- text ID;
- radio on/off state.

Play time never drives an edge.

---

# V2-R0B — GTA acceptance gate

## 7. Required proof before wire migration

Do not change production song resolution until this gate passes.

### 7.1 Ordinary one-file song

Use a normal music station and identify the audible song manually.

Candidate known example:

```text
Los Santos Rock Radio
Hollywood Nights — BOB SEGER
candidate trackTextId: 1004
```

The exact song does not need to be this one. Any candidate row is acceptable.

Pass:

```text
audible song == candidate title/artist
probe text_id == candidate catalog key
```

### 7.2 Continuous/multi-song mix

Use a station/container known from the dump to contain many song markers:

- FlyLo FM;
- Soulwax FM;
- East Los FM;
- a Music Locker/Media Player mix where practical.

Critical expected behavior:

```text
song A -> song B

soundHash may remain unchanged
trackTextId changes
candidate catalog follows audible title
```

This is the decisive proof that text ID is the correct semantic song key.

### 7.3 Non-song content

Capture at least:

- commercial;
- DJ chatter/transition;
- news or talk;
- radio off.

Record the exact `trackTextId` behavior.

Possible outcomes include:

- a cataloged commercial ID;
- zero;
- negative value;
- previous music ID;
- another positive value.

Do not assign meaning until observed.

### 7.4 Stop conditions

Do not proceed to V2-R1 if:

- text ID does not match known catalog tracks;
- text ID stays constant across multi-song mix transitions;
- the native throws/crashes under normal use;
- semantics are unstable enough that a bounded normalization cannot be defined.

If the text-ID native fails, preserve the current raw soundHash producer and revisit song identification separately.

---

# V2-R1 — Upgrade the raw radio signal

## 8. Raw sample after acceptance

Once V2-R0B passes:

```csharp
public sealed class RadioSample
{
    public string Vehicle;
    public string Station;
    public uint SoundHash;
    public int TrackTextId;
}
```

The sampler remains:

- independent;
- 250 ms;
- outside entity/observer loops;
- enabled only under radio shadow mode.

## 9. Baseline semantics

First sample establishes the baseline and emits nothing.

Material tuple:

```text
(vehicle, station, soundHash, trackTextId)
```

Transition table:

| Previous | Current | Emit |
| --- | --- | --- |
| none | any | no; establish baseline |
| off | off | no |
| off | active | `radio_changed` |
| same tuple | same tuple | no |
| same station/hash, new text ID | `radio_changed` |
| same station/text ID, new soundHash | `radio_changed` |
| station change | `radio_changed` |
| source vehicle change | `radio_changed` |
| active | off | `radio_stopped` |
| reset | any | no; establish fresh baseline |

A text-ID transition inside the same soundHash is explicitly a material radio change.

## 10. Wire contract v2

Because the feature branch is not merged, cleanly replace the misleading `trackHash` field.

Preferred `radio_changed` facts:

```json
{
  "station": "RADIO_01_CLASS_ROCK",
  "soundHash": 2481236011,
  "trackTextId": 1004
}
```

Preferred `radio_stopped` facts:

```json
{
  "station": "",
  "soundHash": 0,
  "trackTextId": 0
}
```

Validation:

```js
station:
  /^[A-Z0-9_]{1,64}$/

soundHash:
  integer 0..0xffffffff

trackTextId:
  signed int32 during raw transport
```

Use the full signed int32 range initially:

```text
-2147483648 .. 2147483647
```

Reason: R0B must define real negative/zero semantics before the companion assumes all nonpositive values are equivalent.

For a stopped event, normalize to exactly zero.

## 11. Source vehicle on stop

Refine the existing implementation so `radio_stopped` preserves the previous radio source vehicle when the previous captureRef is still valid.

Preferred:

```json
{
  "kind": "radio_stopped",
  "target": "<previous-vehicle-captureRef>",
  "facts": {
    "station": "",
    "soundHash": 0,
    "trackTextId": 0
  }
}
```

This makes later PS2 episode closure deterministic.

If the previous vehicle anchor has already retired, `target:null` is acceptable. Never retarget to a replacement vehicle.

## 12. Queue semantics

Unchanged:

- radio is routine;
- never critical;
- cannot consume the 64-slot critical reserve;
- existing bounded drop accounting applies.

## 13. Diagnostics

Retain numeric production counters only:

```text
radio.samples
radio.edges
radio.nativeFailures
```

Optional bounded additions after v2:

```text
radio.unknownTextIds
radio.catalogMismatches
```

Do not put station/title/artist into the 10-second production summary.

---

# V2-R2 — Text-ID catalog resolver

## 14. Replace hash lookup as the title resolver

Current research artifact:

`lsa-essential-e1-candidate/data/radioTrackTextIds.v2.json`

Current counts:

```text
entries:     1058
music:        951
commercial:   106
off:            1
stations:       26 with tagged content
```

The runtime resolver must be keyed by `trackTextId`, not `soundHash`.

## 15. Catalog schema

Recommended production schema:

```ts
type RadioTrackTextCatalogV2 = {
  version: 2;
  game: "gta-v-enhanced";
  key: "trackTextId";

  generatedFrom: {
    trackMetadata: {
      repository: string;
      commit: string;
    };
    stationLabels: {
      repository: string;
      commit: string;
    };
  };

  counts: {
    entries: number;
    music: number;
    commercial: number;
    off: number;
    stations: number;
  };

  stations: Record<StationKey, {
    name: string;
  }>;

  tracks: Record<DecimalTrackTextId, {
    title: string;
    artist: string;
    kind: "music" | "commercial" | "off";
    stations: StationKey[];
  }>;
};
```

## 16. Resolver behavior

Input:

```js
resolveRadioTrack({
  station,
  soundHash,
  trackTextId
})
```

Output for known ID:

```js
{
  station,
  stationName,
  soundHash,
  trackTextId,
  trackKnown: true,
  kind: 'music',
  artist,
  title
}
```

Unknown/nonpositive/unmapped:

```js
{
  station,
  stationName,
  soundHash,
  trackTextId,
  trackKnown: false
}
```

### 16.1 Station membership

If a known text ID contains the current station in `entry.stations`:

```text
normal resolution
```

If the text ID is known but the station is not in its known station list:

```text
trackKnown = false
catalogMismatch = true
```

Do not silently resolve it.

Exception: if GTA acceptance proves some station context is intentionally absent or aliases exist, add an explicit alias table rather than weakening this rule globally.

### 16.2 Multi-station IDs

The data legitimately contains IDs used on more than one station.

This is expected, especially:

- commercials;
- some music shared between Radio Los Santos and Media Player.

Therefore `stations` is an array, not a single field.

## 17. Content kind

Preserve:

```text
music
commercial
off
```

Do not collapse commercials into music.

Later PS2/PS3 can use this distinction:

```text
music       -> low-priority environmental audio
commercial  -> low-priority non-music broadcast
off         -> no current content
```

Talk/news/DJ behavior must remain runtime-unknown until the native probe establishes their text-ID semantics.

## 18. Text validation

The original v1 sanitizer is too strict.

Real GTA metadata legitimately contains ordinary slash characters, including:

- `MONO/POLY AND THUNDERCAT`;
- `JESSE JOHNSON / MOODYMANN`;
- `Abolish Government/Silent Majority`;
- `One Girl/One Boy`.

Therefore allow ordinary `/`.

Still reject:

- malformed UTF-16;
- NUL/control characters;
- CR/LF;
- excessive length;
- structurally invalid JSON/schema.

Do not attempt to detect URLs by banning all slash characters.

If arbitrary URL-like metadata must be forbidden, detect an actual URL scheme pattern rather than slash itself.

Existing measured source maxima:

```text
title max:  69 chars
artist max: 75 chars
```

Existing 160/120 bounds are sufficient.

## 19. Catalog freshness model

The public reference dump predates the current October 2026 Enhanced build.

Therefore:

```text
runtime ID = truth
catalog = resolver
```

A stale extra row is harmless because it is unused unless GTA emits that ID.

A new runtime ID missing from the catalog becomes:

```text
trackKnown=false
```

and increments a bounded unknown-ID diagnostic.

Do not use catalog presence to infer that a song still exists in the live rotation.

## 20. Converter

Existing research tool:

`tools/buildRadioTrackTextCatalog.mjs`

Productionize it rather than hand-editing the JSON.

Requirements:

- input is local files;
- no runtime network calls;
- source commits supplied explicitly;
- deterministic numeric-ID ordering;
- fail on conflicting ID -> title/artist;
- preserve multi-station memberships;
- controlled content-kind classification;
- safe bounded strings;
- same input yields byte-identical output.

Add a verifier equivalent to the existing v1 catalog verifier.

Suggested:

`tools/verifyRadioTrackTextCatalog.mjs`

## 21. Licensing / provenance boundary

Important: HintSystem and DurtyFree are public repositories but currently do not expose explicit GitHub license declarations.

Therefore separate:

### Research use

The candidate derived catalog can remain on the research branch for:

- validation;
- design;
- GTA spot checks;
- schema/test development.

### Public production merge

Before vendoring the generated catalog into a public production branch, choose one:

1. obtain permission/license clarification from the source maintainers; or
2. regenerate the same metadata from the user's locally owned GTA V Enhanced files and use the public dump only as a research cross-check.

Do not make runtime behavior depend on downloading either public repository.

## 22. Existing v1 artifacts

After v2 GTA acceptance passes:

### Replace

- `data/radioTracks.v1.json`
- hash-keyed runtime resolution
- `trackHash` naming

with:

- `data/radioTrackTextIds.v2.json`
- text-ID runtime resolution
- `soundHash` + `trackTextId`

### Preserve if useful only as historical tooling

The v1 generator/verifier may be deleted if nothing uses it.

Avoid retaining two active catalog paths that disagree on song identity.

---

# Code touch map

## 23. Native

### `native/intelligence/IntelligenceIntegration.cs`

Change:

- call `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()`;
- include text ID in probe state;
- preserve 250 ms independent cadence;
- rename internal track hash terminology to sound hash where feasible;
- pass accepted v2 sample into `SensorAdapters.Radio` after R0B passes;
- read play time only for probe output.

### `native/intelligence/SensorAdapters.cs`

Change after R0B:

- `RadioSample.TrackHash -> SoundHash`;
- add `TrackTextId`;
- compare full material tuple;
- preserve previous source vehicle for stop when valid;
- serialize `soundHash` and `trackTextId`;
- reset all radio baseline state.

### Native tests

Update:

- baseline;
- stable tuple;
- text-ID-only transition;
- soundHash-only transition;
- station transition;
- vehicle transition;
- off/on;
- negative/zero text-ID transport;
- reset;
- invalid station;
- queue storm / critical reserve;
- source vehicle on stop.

## 24. Companion

### `lsa-essential-e1-candidate/src/perception/contracts.mjs`

Change:

- replace `trackHash` with `soundHash`;
- require `trackTextId`;
- strict signed-int32 validation;
- stopped event fixed at zeros.

No PS2 observation type yet.

### `src/perception/shadowRuntime.mjs`

Keep current core behavior:

```text
radio signal -> bounded raw store -> return
```

Do not send radio to PS2 yet.

Optional: load/resolve catalog only in a dedicated diagnostics/research path. Do not make catalog resolution imply observation creation.

### New/renamed catalog module

Preferred:

`src/perception/radioTrackTextCatalog.mjs`

Responsibilities:

- validate v2 catalog;
- load once;
- resolve positive text IDs;
- validate station membership;
- expose bounded counters;
- never call network;
- never touch prompts/memory.

### Data

Research candidate:

`data/radioTrackTextIds.v2.json`

Production inclusion depends on the provenance/licensing choice above.

## 25. Package/build integration

Verify:

- candidate package copies v2 catalog if included;
- production addon compiles with the new native invocation;
- no source-list omission;
- no stale v1 catalog is accidentally preferred;
- example configs remain default-off;
- no hello capability change is required unless mixed-version support demands it.

Because radio remains opt-in shadow and native+companion ship together, a new capability key is not required for this slice.

If mixed-version deployment becomes supported, add a versioned radio capability rather than relying on strict rejection.

---

# Tests

## 26. Offline unit tests

### Native

Required fresh assertions:

```text
first sample -> baseline only
same station/hash/text ID -> no edge
same hash + changed text ID -> one radio_changed
changed hash + same text ID -> one radio_changed
station change -> one radio_changed
source vehicle change -> one radio_changed
active -> off -> one radio_stopped
off -> active -> one radio_changed
reset -> fresh baseline
routine storm preserves critical reserve
native text-ID exception does not tear down intelligence
```

### Contract

Accept:

- signed int32 minimum/maximum if raw contract allows full range;
- uint32 sound hash maximum;
- valid station;
- null target if contract still permits missing source.

Reject:

- extra artist/title fields;
- text ID outside signed int32;
- sound hash outside uint32;
- malformed station;
- non-null `source`;
- invalid stop values;
- oversized frame.

### Catalog

Required:

- text ID 1004 resolves to expected fixture metadata;
- unknown ID remains unknown;
- known ID on wrong station fails closed;
- multi-station ID resolves on each listed station;
- slash in artist/title is valid;
- control/newline text rejected;
- duplicate conflicting ID rejected;
- deterministic serialization;
- source commit metadata retained;
- stale extra catalog row has no runtime effect.

Do not make tests depend on every production song row. Keep a small synthetic fixture for behavior tests and separately verify the generated research catalog.

## 27. Integration tests

Use the fake native seam to vary independently:

```text
station
soundHash
trackTextId
playTime
```

Prove:

- text-ID-only transition reaches the serialized wire;
- no artist/title crosses native wire;
- radio-off path normalizes to zero;
- vehicle captureRef remains correct;
- radio sampling independent of observer count;
- PS2 observations remain zero;
- no model/actor state created;
- config off performs no radio native calls.

## 28. Regression

Run fresh:

- companion full suite;
- native intelligence tests;
- native intelligence integration tests;
- real .NET -> Node perception interop;
- PS host/lifecycle tests;
- runtime tests;
- candidate build;
- actual RPH characters-addon/package build.

Do not reuse old pass counts.

---

# Deployment and acceptance

## 29. Rollout modes

### Mode 0 — off

Default.

No radio native calls.

### Mode 1 — probe shadow

Extended v2 probe active.

No wire contract change required until R0B accepted.

### Mode 2 — raw v2 shadow

After acceptance:

```text
station + soundHash + trackTextId
```

crosses the bounded raw perception channel.

No PS2/Luna behavior.

### Mode 3 — future PS2 hearing

Not part of this implementation.

## 30. Final GTA acceptance before merge

Minimum:

1. one ordinary known song resolves to the expected text ID;
2. one multi-song mix demonstrates text ID tracking the audible song;
3. station retune behaves correctly;
4. radio off/on behaves correctly;
5. vehicle exit/re-entry behaves correctly;
6. ad/DJ/news behavior recorded;
7. no native failure counter growth;
8. no crashes;
9. first sample after restart remains baseline-only;
10. production diagnostics remain content-free.

## 31. Merge gate

V2 R0-R2 is mergeable only when:

- `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()` is proven useful in GTA V Enhanced;
- wire field names reflect actual semantics;
- text-ID-only song changes emit edges;
- soundHash no longer claims to uniquely identify songs;
- catalog resolver is text-ID keyed;
- real metadata slash characters are accepted;
- RPH/package build passes;
- all relevant regression tests pass;
- radio remains completely outside PS2/Luna;
- the catalog redistribution/provenance choice is explicit.

---

# Later PS2 / PS3 integration

## 32. PS2

After v2 raw facts are merged, PS2 should consume normalized current content.

Safest first hearing rule remains:

```text
observer is in same source vehicle
        -> supported auditory evidence

otherwise
        -> unknown until exterior acoustic evidence exists
```

Potential observation:

```text
radio_heard
```

with details:

```json
{
  "station": "RADIO_01_CLASS_ROCK",
  "stationName": "Los Santos Rock Radio",
  "soundHash": 2481236011,
  "trackTextId": 1004,
  "trackKnown": true,
  "kind": "music",
  "artist": "BOB SEGER",
  "title": "Hollywood Nights"
}
```

## 33. PS3 / PS4 context integration

Radio does not own a separate prompt selector or context vocabulary.

The live radio sampler produces only a raw PS fact. It becomes NPC knowledge **only after PS2 auditory witness attribution**. PS3 then ranks the resulting observer-specific observation using the normal salience vocabulary (`omit | candidate | must_include`, `none | stage`, `none | eligible | urgent`). A radio event by itself grants no initiative.

If a witnessed/relevant radio fact is eventually shown to Luna, it is rendered only by the **PS4 TurnKnowledgeFrame** assembler in the normal PERCEIVED/SITUATION lanes. The radio subsystem never appends its own prompt block.

An eventual PS4 rendering may look like:

```text
Audible environment: "Hollywood Nights" by Bob Seger is playing on Los Santos Rock Radio.
```

That sentence is a PS4 projection of witnessed evidence, not output from the radio producer.

---

# Implementation handoff

## 34. Recommended next coding task

A coding model should begin with **V2-R0A only**, push it, and stop at the GTA acceptance gate.

Prompt-level scope:

```text
Extend the existing R0 shadow probe with GET_AUDIBLE_MUSIC_TRACK_TEXT_ID().
Do not change the radio wire schema yet.
Do not add PS2 or Luna behavior.
Add fake-native coverage and build/package validation.
Push the branch and provide exact GTA probe steps.
```

After the GTA result confirms the mapping, implement V2-R1 and V2-R2 together.

This prevents us from hardening another incorrect identifier assumption into the protocol.

## 35. Definition of done

The finished R0-R2 v2 feature answers exactly:

```text
What radio source is the player currently hearing?
What station is it?
What underlying sound/container is active?
What per-song text ID is currently audible?
Can that text ID be safely resolved to known artist/title/content kind?
```

It still does **not** answer:

```text
Which NPC heard it?
Does the NPC care?
Should Luna mention it?
Should it become memory?
```

Those remain PS2 witness → PS3 salience → PS4 TurnKnowledgeFrame responsibilities.
